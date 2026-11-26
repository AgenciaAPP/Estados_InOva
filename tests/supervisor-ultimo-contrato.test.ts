import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { seleccionarActivosDemo } from '../backend/mock/adaptadores.ts'
import { crearListadoMysql } from '../backend/supervisor/contratos.ts'
import { configurarPanel } from '../backend/supervisor/config.ts'
import { Lote } from '../backend/supervisor/lote.ts'

function contrato(nitCc: string, numeroContrato: string, fechaActualizacion: string | null) {
  return { nitCc, numeroContrato, fechaActualizacion, estado: 'EN EJECUCIÓN', contratista: 'Nombre compartido de prueba',
    supervisor: 'Supervisor de ' + numeroContrato, apoyoSupervision: 'Apoyo de ' + numeroContrato, apoyoLogistico: 'Logística de ' + numeroContrato,
    apoyoJuridico: null }
}
type Fila = ReturnType<typeof contrato>

function listadoLocal(t: TestContext, filas: Fila[]) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`PRAGMA case_sensitive_like = ON;
    CREATE TABLE contratos (nitCc TEXT, numeroContrato TEXT COLLATE NOCASE, fechaActualizacion TEXT, estado TEXT,
      contratista TEXT, supervisor TEXT, apoyoSupervision TEXT, apoyoLogistico TEXT)`)
  const guardar = db.prepare('INSERT INTO contratos VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const f of filas) guardar.run(f.nitCc, f.numeroContrato, f.fechaActualizacion, f.estado, f.contratista, f.supervisor, f.apoyoSupervision, f.apoyoLogistico)
  return crearListadoMysql(async (sql, parametros) => {
    // SQLite ejecuta la misma ventana con datos sintéticos. Solo se adapta el cotejo binario de MySQL.
    const local = sql.replace(/CAST\((\?|\w+) AS BINARY\)/g, '($1 COLLATE BINARY)')
    return db.prepare(local).all(...parametros)
  })
}

test('La ventana filtra antes de elegir, conserva ceros y toma todos los campos de la fila ganadora', async t => {
  const filas = [
    contrato('0007', 'PS999', '2024-01-01'),
    contrato('0007', 'PSAb', '2025-01-01'),
    contrato('0007', 'PSab', '2026-01-01'),
    contrato('0007', 'ps001', '2026-06-01'), contrato('0007', '123PS001', '2026-06-01'),
    { ...contrato('0007', 'PS777', '2026-06-01'), estado: 'TERMINADO' },
    contrato('7', 'PS007', '2024-01-01'),
  ]
  const listar = listadoLocal(t, filas)
  for (const autorizados of [null, ['PSAb', 'PS999', 'PS007', 'PS777', 'ps001']]) {
    const resultado = await listar(autorizados)
    assert.deepEqual(resultado, seleccionarActivosDemo(filas, autorizados))
    const ganador = autorizados ? 'PSAb' : 'PSab'
    assert.deepEqual(resultado.map(f => [f.cedula, f.numeroContrato]), [['7', 'PS007'], ['0007', ganador]])
    assert.deepEqual(resultado[1], { cedula: '0007', numeroContrato: ganador, contratista: 'Nombre compartido de prueba',
      supervisor: 'Supervisor de ' + ganador, apoyoSupervision: 'Apoyo de ' + ganador, apoyoLogistico: 'Logística de ' + ganador })
  }
})

test('Empates y fechas nulas dan la misma fila en ambos órdenes de inserción', async t => {
  const empate = contrato('0001', 'PSA', '2026-02-01')
  const filas = [
    contrato('0001', 'PS0', null), contrato('0001', 'PSB', empate.fechaActualizacion),
    { ...empate, apoyoLogistico: 'equipo' }, { ...empate, apoyoLogistico: 'Equipo' },
    contrato('0002', 'PSZ', null), contrato('0002', 'PSC', null),
  ]
  for (const orden of [filas, [...filas].reverse()]) {
    const resultado = await listadoLocal(t, orden)(null)
    assert.deepEqual(resultado, seleccionarActivosDemo(orden, null))
    assert.deepEqual(resultado.map(f => [f.cedula, f.numeroContrato, f.apoyoLogistico]), [
      ['0001', 'PSA', 'Equipo'], ['0002', 'PSC', 'Logística de PSC'],
    ])
  }
})

test('180 filas producen 150 contratos consultados y 130 visibles sin volver a un contrato anterior con estado', async t => {
  const actuales = Array.from({ length: 150 }, (_, i) => contrato(String(i).padStart(5, '0'), 'PS-A' + i, '2026-01-01'))
  const anteriores = actuales.slice(0, 30).map((f, i) => contrato(f.nitCc, 'PS-Z' + i, '2025-01-01'))
  const sinEstado = new Set(actuales.slice(0, 20).map(f => f.numeroContrato))
  const consultas: string[] = []
  const lote = new Lote()
  await lote.ejecutar(listadoLocal(t, [...anteriores, ...actuales]), {
    buscarContrato: async () => { throw new Error('Búsqueda individual inesperada') },
    async consultarInforme(tipo, numero) {
      consultas.push(tipo + '/' + numero)
      return sinEstado.has(numero) ? null : { nombre: 'Aprobado', tono: 'aprobado' }
    },
  }, configurarPanel({ SUPERVISOR_SCOPE: 'all' }, 'mysql'))
  assert.deepEqual(consultas.sort(), actuales.flatMap(f => ['gestion', 'supervision', 'cobro'].map(tipo => tipo + '/' + f.numeroContrato)).sort())
  const { estado, candidatos, procesados, excluidos, incluidos, total, paginas } = lote.pagina(1)
  assert.deepEqual({ estado, candidatos, procesados, excluidos, incluidos, total, paginas },
    { estado: 'completa', candidatos: 150, procesados: 150, excluidos: 20, incluidos: 130, total: 130, paginas: 6 })
  const visibles = Array.from({ length: paginas }, (_, i) => lote.pagina(i + 1).filas)
  assert.deepEqual(visibles.map(p => p.length), [25, 25, 25, 25, 25, 5])
  assert.deepEqual(visibles.flat().map(f => f.cedula).sort(), actuales.slice(20).map(f => f.nitCc))
})
