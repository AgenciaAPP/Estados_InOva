import { envioSinEstado, type Informe, type TipoInforme } from '../../shared/consulta.ts'
import type { ModalidadConsulta } from '../services/consulta.ts'
import type { OpcionesInova } from './config.ts'
import { clasificarEstado } from './estados.ts'
import { abrirAnswers, clienteInova, codigoFallo, ErrorProveedor, objeto } from './cliente.ts'

const MAX_PAGINAS = 20
const MAX_ENTIDADES = 10
export const PLAZO_MS = 10000

// La ruta debe referirse al número de contrato documentado para ESTE formulario.
function contratoDe(fila: unknown, ruta: string[]) {
  let valor: unknown = fila
  for (const campo of ruta) {
    if (!valor || typeof valor !== 'object' || !Object.hasOwn(valor, campo)) throw new ErrorProveedor('CONTRATO_NO_VERIFICABLE')
    valor = (valor as Record<string, unknown>)[campo]
    if (campo === 'answers') valor = abrirAnswers(valor)
  }
  if (typeof valor !== 'string' || !valor.trim()) throw new ErrorProveedor('CONTRATO_NO_VERIFICABLE')
  return valor
}

function instante(valor: unknown) {
  const partes = typeof valor === 'string' && /^(\d{4}-\d\d-\d\d)T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(valor)
  if (!partes) throw new ErrorProveedor('FECHA_NO_VERIFICABLE')
  const [, dia, hora, minuto, segundo, fraccion = '', zona] = partes
  const medianoche = new Date(dia + 'T00:00:00Z')
  const ms = Date.parse(dia + 'T' + hora + ':' + minuto + ':' + segundo + zona)
  if (!Number.isFinite(ms) || !Number.isFinite(medianoche.getTime()) || !medianoche.toISOString().startsWith(dia + 'T')) {
    throw new ErrorProveedor('FECHA_NO_VERIFICABLE')
  }
  return BigInt(ms) * 1000000n + BigInt(fraccion.padEnd(9, '0'))
}

type Candidato = { fecha: unknown; estado: unknown }
export function seleccionarEnvio(filas: Candidato[]) {
  if (filas.length <= 1) return filas[0]
  let mayor: bigint | undefined
  let reciente: Candidato | undefined
  for (const fila of filas) {
    const fecha = instante(fila.fecha)
    if (mayor === undefined || fecha > mayor) {
      mayor = fecha
      reciente = fila
    } else if (fecha === mayor) reciente = undefined
  }
  if (!reciente) throw new ErrorProveedor('FECHA_AMBIGUA')
  return reciente
}

// Un recorrido por formulario. El CLI y la web usan la misma comparación,
// límites y selección. Los observadores solo reciben categorías, nunca datos del contrato.
export async function revisarRegistros(opciones: OpcionesInova, tipo: TipoInforme, contrato: string,
  cliente: ReturnType<typeof clienteInova>, observar?: (exacto: boolean, clase: ReturnType<typeof clasificarEstado>['clase']) => void) {
  const entidades = new Map<string, boolean>()
  let idsCorroborados = 0
  async function coincide(fila: Record<string, unknown>) {
    if (tipo !== 'cobro' && opciones.rutaContrato[tipo].length) return contratoDe(fila, opciones.rutaContrato[tipo]) === contrato
    if (!opciones.rutaEntidad.length) throw new ErrorProveedor('CONTRATO_NO_VERIFICABLE')
    const id = fila.entity_id
    if (typeof id !== 'string') throw new ErrorProveedor('ENTIDAD_NO_VERIFICABLE')
    const anterior = entidades.get(id)
    if (anterior !== undefined) return anterior
    if (entidades.size >= MAX_ENTIDADES) throw new ErrorProveedor('LIMITE_ENTIDADES')
    const entidad = await cliente.entidad(id)
    if (!objeto(entidad)) throw new ErrorProveedor('ENTIDAD_NO_VERIFICABLE')
    if (Object.hasOwn(entidad, 'id')) {
      if (entidad.id !== id) throw new ErrorProveedor('ID_DE_ENTIDAD_NO_CORROBORADO')
      idsCorroborados++
    }
    const exacto = contratoDe(entidad, opciones.rutaEntidad) === contrato
    entidades.set(id, exacto)
    return exacto
  }

  const vistos = new Set<string>()
  const filas: Candidato[] = []
  let cursor: string | null = null
  for (let pagina = 1; ; pagina++) {
    const datos = await cliente.pagina(tipo, contrato, cursor)
    for (const fila of datos.filas) {
      const exacto = await coincide(fila)
      observar?.(exacto, clasificarEstado(fila.estado_id).clase)
      if (exacto) filas.push({ fecha: fila.date, estado: fila.estado_id })
    }
    cursor = datos.siguiente
    if (cursor === null) return {
      filas, paginas: pagina, entidades: entidades.size, idsCorroborados,
      entidadesExactas: [...entidades.values()].filter(Boolean).length,
    }
    if (pagina >= MAX_PAGINAS || vistos.has(cursor)) throw new ErrorProveedor('PAGINACION_INCOMPLETA')
    vistos.add(cursor)
  }
}

export function crearConsultaInova(opciones: OpcionesInova, enviar: typeof fetch = fetch,
  diagnosticar: (mensaje: string) => void = console.warn, plazoMs = PLAZO_MS) {
  return async (tipo: TipoInforme, contrato: string, modalidad: ModalidadConsulta = 'individual'): Promise<Informe> => {
    const signal = AbortSignal.timeout(plazoMs)
    const cliente = clienteInova(opciones, enviar, signal)
    try {
      const { filas } = await revisarRegistros(opciones, tipo, contrato, cliente)
      const registro = seleccionarEnvio(filas)
      if (!registro) return null
      const estado = clasificarEstado(registro.estado)
      if (estado.clase === 'reconocido') return estado.estado
      // Un campo omitido deja la respuesta sin verificar. Solo un valor explícito confirma el envío sin estado.
      if (modalidad === 'supervisor' && (registro.estado === null || estado.clase === 'vacio')) return envioSinEstado
      if (estado.clase !== 'desconocido') throw new ErrorProveedor('ESTADO_AUSENTE')
      diagnosticar('[In-Ova] ' + tipo + ' ESTADO_DESCONOCIDO')
      return { nombre: 'Estado no identificado', tono: 'neutral' }
    } catch (error) {
      const codigo = codigoFallo(error, signal)
      diagnosticar('[In-Ova] ' + tipo + ' ' + codigo)
      const indisponible = codigo.startsWith('HTTP_') || codigo === 'TIEMPO_AGOTADO' || codigo === 'CONEXION_FALLIDA'
      if (tipo === 'cobro') {
        if (indisponible) return { aviso: 'No se pudo consultar la cuenta de cobro.' }
        switch (codigo) {
          case 'FECHA_AMBIGUA': return { aviso: 'Varios envíos de la cuenta de cobro comparten la fecha más reciente.' }
          case 'FECHA_NO_VERIFICABLE': return { aviso: 'Las fechas disponibles no permiten identificar el último envío de la cuenta de cobro.' }
          case 'ESTADO_AUSENTE': return { aviso: 'El envío seleccionado de la cuenta de cobro no tiene un estado válido.' }
          case 'CONTRATO_NO_VERIFICABLE':
          case 'ENTIDAD_NO_VERIFICABLE':
          case 'ID_DE_ENTIDAD_NO_CORROBORADO': return { aviso: 'No se pudo verificar el contrato de la cuenta de cobro.' }
          default: return { aviso: 'No se pudo verificar el registro de la cuenta de cobro.' }
        }
      }
      return { aviso: indisponible ? 'No se pudo consultar este informe.' : 'No se pudo verificar el registro de este informe.' }
    }
  }
}
