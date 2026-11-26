import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as esperar } from 'node:timers/promises'
import { opcionesInova } from '../backend/inova/config.ts'
import { crearConsultaInova } from '../backend/inova/informes.ts'
import { buscarContratoDemo, listarActivosDemo } from '../backend/mock/adaptadores.ts'
import { configurarPanel } from '../backend/supervisor/config.ts'
import { Lote } from '../backend/supervisor/lote.ts'
import type { Informe, TipoInforme } from '../shared/consulta.ts'

const opciones = opcionesInova({ INOVA_API_KEY: 'ficticia', INOVA_RUTA_CONTRATO_ENTIDAD: '/identification' })
const tipos: TipoInforme[] = ['gestion', 'supervision', 'cobro']
const aprobado = 'p81iCXmC1jZUwf_nmL3ROsdde9siZJggig4rH0rn'
const sinEstado = 'El último envío no tiene estado registrado.'
const errorLectura = 'No se pudo consultar este informe.'
const noVerificado = 'No se pudo verificar el registro de este informe.'

// Cada arreglo contiene los estado_id del primer al último envío. Un número representa un error HTTP.
type Respuesta = readonly unknown[] | number | 'timeout'
interface Caso {
  nombre: string
  documentos: [Respuesta, Respuesta, Respuesta]
  celdas: (string | null)[] | null
}
const casos: Caso[] = [
  { nombre: 'tres búsquedas sin registros', documentos: [[], [], []], celdas: null },
  { nombre: 'tres identificadores vacíos', documentos: [[''], ['  '], ['\t']], celdas: null },
  { nombre: 'tres identificadores nulos', documentos: [[null], [null], [null]], celdas: null },
  { nombre: 'último envío vacío después de uno aprobado', documentos: [[aprobado, ''], [null], []], celdas: null },
  { nombre: 'solo gestión aprobada', documentos: [[aprobado], [], []], celdas: ['Aprobado', null, null] },
  { nombre: 'solo supervisión aprobada', documentos: [[], [aprobado], []], celdas: [null, 'Aprobado', null] },
  { nombre: 'solo cuenta de cobro aprobada', documentos: [[], [], [aprobado]], celdas: [null, null, 'Aprobado'] },
  { nombre: 'tres estados reconocidos', documentos: [[aprobado], [aprobado], [aprobado]], celdas: Array(3).fill('Aprobado') },
  { nombre: 'estado desconocido y un envío vacío', documentos: [[], ['id-ficticio'], ['']], celdas: [null, 'Estado no identificado', sinEstado] },
  { nombre: 'HTTP 503', documentos: [503, [], [null]], celdas: [errorLectura, null, sinEstado] },
  { nombre: 'tiempo de espera agotado', documentos: [[], 'timeout', []], celdas: [null, errorLectura, null] },
  { nombre: 'autenticación y error HTTP', documentos: [401, 500, []], celdas: [errorLectura, errorLectura, null] },
  { nombre: 'campo omitido en el último envío', documentos: [[aprobado, undefined], [], []], celdas: [noVerificado, null, null] },
  { nombre: 'estado de tipo inválido', documentos: [[42], [], []], celdas: [noVerificado, null, null] },
]

function texto(informe: Informe) {
  if (informe === null) return null
  return 'aviso' in informe ? informe.aviso : informe.nombre
}

for (const caso of casos) {
  test('Filtro del supervisor en piloto y general · ' + caso.nombre, async () => {
    const leer: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/entities/entidad-prueba') return Response.json({ identification: 'PS001' })
      if (url.searchParams.get('identification') !== 'PS001') return Response.json({ results: [], next: null })
      const form_id = decodeURIComponent(url.pathname.split('/')[3])
      const indice = tipos.findIndex(tipo => opciones.formularios[tipo] === form_id)
      const respuesta = caso.documentos[indice]
      if (respuesta === 'timeout') {
        await esperar(2000, undefined, { signal: init?.signal ?? undefined })
        throw new Error('Se esperaba la cancelación de la lectura de prueba.')
      }
      if (typeof respuesta === 'number') return new Response(null, { status: respuesta })
      return Response.json({ next: null, results: respuesta.map((estado_id, i) => ({
        form_id, entity_id: 'entidad-prueba', estado_id, date: `2026-04-0${i + 1}T12:00:00Z`,
      })) })
    }
    const diagnostico: string[] = []
    const esperaCorta = caso.documentos.includes('timeout') ? 50 : undefined
    const servicios = { buscarContrato: buscarContratoDemo, consultarInforme: crearConsultaInova(opciones, leer, m => diagnostico.push(m), esperaCorta) }
    for (const modo of ['pilot', 'all']) {
      const config = configurarPanel({ SUPERVISOR_SCOPE: modo, SUPERVISOR_PILOT_CONTRACTS: '["PS001"]' }, 'mysql')
      const lote = new Lote()
      await lote.ejecutar(listarActivosDemo, servicios, config)
      const pagina = lote.pagina(1)
      assert.equal(pagina.estado, 'completa')
      assert.equal(pagina.procesados, modo === 'pilot' ? 1 : 4)
      assert.equal(pagina.candidatos, pagina.procesados)
      assert.equal(pagina.total, caso.celdas ? 1 : 0)
      assert.equal(pagina.incluidos, pagina.total)
      assert.equal(pagina.excluidos, pagina.procesados - (caso.celdas ? 1 : 0))
      assert.equal(pagina.paginas, caso.celdas ? 1 : 0)
      assert.deepEqual(pagina.filas.map(fila => fila.numeroContrato), caso.celdas ? ['PS001'] : [])
      if (caso.celdas) assert.deepEqual(tipos.map(tipo => texto(pagina.filas[0].informes[tipo])), caso.celdas)
    }
    if (esperaCorta) assert.deepEqual(diagnostico, Array(2).fill('[In-Ova] supervision TIEMPO_AGOTADO'))
  })
}
