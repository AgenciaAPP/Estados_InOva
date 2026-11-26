import { contratos, registros, type RegistroDemo } from './datos.ts'
import { leerResponsables, type BuscarContrato } from '../services/contratos.ts'
import type { LeerPagina, Registro } from '../services/informes.ts'
import { createHash } from 'node:crypto'
import { camposDesempate, type ListarActivos } from '../supervisor/contratos.ts'

type FilaDemoPanel = Omit<(typeof contratos)[number], 'fechaActualizacion'> & { fechaActualizacion: string | null }

function compararBinario(a: string | null, b: string | null) {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return Buffer.compare(Buffer.from(a), Buffer.from(b))
}

function prioridadPanel(a: FilaDemoPanel, b: FilaDemoPanel) {
  // Las fechas ficticias usan el formato ISO de calendario, ordenable como texto.
  const porFecha = compararBinario(b.fechaActualizacion, a.fechaActualizacion)
  if (porFecha) return porFecha
  for (const campo of camposDesempate) {
    const orden = compararBinario(a[campo], b[campo])
    if (orden) return orden
  }
  return 0
}

export function seleccionarActivosDemo(filas: readonly FilaDemoPanel[], autorizados: readonly string[] | null) {
  const porCedula = new Map<string, FilaDemoPanel>()
  for (const fila of filas) {
    if (fila.estado !== 'EN EJECUCIÓN' || !fila.numeroContrato?.startsWith('PS')) continue
    if (autorizados && !autorizados.includes(fila.numeroContrato)) continue
    const anterior = porCedula.get(fila.nitCc)
    if (!anterior || prioridadPanel(fila, anterior) < 0) porCedula.set(fila.nitCc, fila)
  }
  const seleccionados = [...porCedula.values()].sort((a, b) => a.contratista.localeCompare(b.contratista) ||
    (a.numeroContrato ?? '').localeCompare(b.numeroContrato ?? '') || compararBinario(a.nitCc, b.nitCc))
  return seleccionados.map(fila => {
    const { supervisor, apoyoSupervision, apoyoLogistico } = leerResponsables(fila)
    return { cedula: fila.nitCc, contratista: fila.contratista, numeroContrato: fila.numeroContrato, supervisor, apoyoSupervision, apoyoLogistico }
  })
}

export const listarActivosDemo: ListarActivos = async autorizados => seleccionarActivosDemo(contratos, autorizados)

export const leerPaginaPanelDemo: LeerPagina = (tipo, contrato, cursor) => {
  if (tipo === 'gestion' && contrato === 'PS004') return Promise.reject(new Error('Fallo simulado de gestión.'))
  return leerPaginaDemo(tipo, contrato, cursor)
}

export const buscarContratoDemo: BuscarContrato = async cedula => {
  const fila = contratos.filter(fila => fila.nitCc === cedula)
    .sort((a, b) => b.fechaActualizacion.localeCompare(a.fechaActualizacion))[0]
  return fila ? { numeroContrato: fila.numeroContrato, contratista: fila.contratista, ...leerResponsables(fila) } : null
}

function normalizar(registro: RegistroDemo): Registro {
  return { contrato: registro.contratoDemo, fecha: registro.date, estadoId: registro.estado_id }
}

export const leerPaginaDemo: LeerPagina = async (tipo, contrato, cursor) => {
  const coincidentes = registros[tipo].filter(r => r.contratoDemo.toLowerCase().includes(contrato.toLowerCase()))
  const inicio = Number(cursor ?? 0)
  // Una fila por página para ejercer la paginación con pocos datos.
  return {
    registros: coincidentes.slice(inicio, inicio + 1).map(normalizar),
    siguiente: inicio + 1 < coincidentes.length ? String(inicio + 1) : null,
  }
}

// En modo mixto los registros son efímeros. Incluso un contrato con prefijo DEMO
// recibe estados de esta simulación, sin consultar el catálogo de ejemplos.
export const leerPaginaParaContratoMysql: LeerPagina = async (tipo, contrato) => {
  const estados = ['demo-pendiente', 'demo-revision', 'demo-aprobado', 'demo-ajustes']
  const desplazamiento = { gestion: 0, supervision: 1, cobro: 2 }
  const indice = createHash('sha256').update(contrato).digest()[0] + desplazamiento[tipo]
  return {
    registros: [{ contrato, estadoId: estados[indice % estados.length], fecha: '2026-01-01T00:00:00Z' }],
    siguiente: null,
  }
}
