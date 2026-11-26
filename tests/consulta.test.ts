import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { crearApp, serviciosDemo } from '../backend/app.ts'
import { configurar } from '../backend/config.ts'
import { buscarEstadoReciente } from '../backend/services/informes.ts'
import { interpretarEstadoDemo } from '../backend/services/estados.ts'
import { consultar } from '../backend/services/consulta.ts'

let server: Server
let base: string
before(async () => {
  server = crearApp(serviciosDemo, 'mock').listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
})
after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())))

async function get(query: string) {
  const res = await fetch(base + '/api/consulta-informes?' + query)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  return { status: res.status, body: await res.json() }
}
test('Contrato vigente, última página y exclusión de contratos parcialmente coincidentes', async () => {
  const { status, body } = await get('cedula=00000001')
  assert.equal(status, 200)
  assert.deepEqual(body, {
    fuentes: { contratos: 'mock', informes: 'mock' },
    cedula: '00000001', contratista: 'Contratista Alfa', numeroContrato: 'DEMO-001',
    supervisor: 'Supervisora ficticia del equipo Alfa', apoyoSupervision: 'Apoyo de supervisión de prueba Alfa',
    apoyoJuridico: 'Apoyo jurídico de prueba Alfa', apoyoLogistico: 'Apoyo logístico de prueba Alfa',
    informes: {
      gestion: { nombre: 'Aprobado', tono: 'aprobado' },
      supervision: { nombre: 'En revisión', tono: 'revision' },
      cobro: { nombre: 'Pendiente', tono: 'pendiente' },
    },
  })
})
test('La ausencia de supervisión conserva el estado de gestión', async () => {
  const { status, body } = await get('cedula=00000002')
  assert.equal(status, 200)
  assert.equal(body.supervisor, 'Supervisor de prueba Beta')
  for (const campo of ['apoyoSupervision', 'apoyoJuridico', 'apoyoLogistico']) assert.equal(body[campo], null)
  assert.equal(body.informes.gestion.nombre, 'Devuelto para ajustes')
  assert.equal(body.informes.supervision, null)
  assert.equal(body.informes.cobro, null)
})
test('La ausencia de gestión conserva el estado de supervisión', async () => {
  const { status, body } = await get('cedula=00000005')
  assert.equal(status, 200)
  assert.equal(body.supervisor, null)
  assert.equal(body.apoyoJuridico, 'Apoyo jurídico de prueba Épsilon')
  assert.equal(body.informes.gestion, null)
  assert.equal(body.informes.supervision.nombre, 'Aprobado')
})

test('Una excepción del proveedor de cobro conserva ambos informes en la demostración', async () => {
  const respuesta = await consultar('00000001', {
    ...serviciosDemo,
    leerPagina: (tipo, contrato, cursor) => {
      if (tipo === 'cobro') throw new Error('detalle privado')
      return serviciosDemo.leerPagina(tipo, contrato, cursor)
    },
  })
  assert.deepEqual(respuesta.datos?.informes, {
    gestion: { nombre: 'Aprobado', tono: 'aprobado' },
    supervision: { nombre: 'En revisión', tono: 'revision' },
    cobro: { aviso: 'No se pudo consultar la cuenta de cobro.' },
  })
})
test('Distingue una cédula desconocida de una fila sin número de contrato', async () => {
  assert.deepEqual(await get('cedula=00000003'), { status: 404, body: { mensaje: 'Cédula no encontrada.' } })
  assert.deepEqual(await get('cedula=00000004'), { status: 404, body: { mensaje: 'Contrato no encontrado.' } })
})
test('Rechaza cédulas ausentes, vacías, alfanuméricas, separadas y duplicadas', async () => {
  for (const query of ['', 'cedula=', 'cedula=abc', 'cedula=1%202', 'cedula=1.2', 'cedula=01&cedula=02']) {
    assert.equal((await get(query)).status, 400)
  }
})
test('La configuración pública indica el origen sin exponer secretos', async () => {
  assert.deepEqual(await (await fetch(base + '/api/configuracion')).json(), {
    demostracion: true, fuentes: { contratos: 'mock', informes: 'mock' },
  })
})
test('Bloquea el modo real y los modos desconocidos al arrancar', () => {
  assert.equal(configurar({}).fuente, 'mock')
  assert.throws(() => configurar({ DATA_MODE: 'real' }), /deshabilitado/)
  assert.throws(() => configurar({ DATA_MODE: 'desconocido' }), /DATA_MODE/)
})
test('Los estados sin equivalencia mantienen un mensaje propio', () => {
  assert.equal(interpretarEstadoDemo('sin-mapa').nombre, 'Estado sin equivalencia')
})
test('Interrumpe ciclos de paginación', async () => {
  await assert.rejects(buscarEstadoReciente(async () => ({ registros: [], siguiente: 'repetido' }), 'gestion', 'DEMO'), /Cursor repetido/)
})
test('Un error del proveedor devuelve un mensaje público genérico', async () => {
  const app = crearApp({ ...serviciosDemo, leerPagina: async () => { throw new Error('detalle interno') } }, 'mock')
  const local = app.listen(0, '127.0.0.1')
  await once(local, 'listening')
  try {
    const res = await fetch('http://127.0.0.1:' + (local.address() as AddressInfo).port + '/api/consulta-informes?cedula=00000001')
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { mensaje: 'Error durante la consulta. Inténtalo de nuevo.' })
  } finally {
    await new Promise<void>((resolve, reject) => local.close(err => err ? reject(err) : resolve()))
  }
})
