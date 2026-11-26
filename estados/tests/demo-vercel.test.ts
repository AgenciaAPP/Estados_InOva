import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { crearServidorDemo } from '../backend/demo-vercel.ts'
import { generarHash } from '../backend/supervisor/cuenta.ts'

const env = { DEMO_ORIGIN_SECRET: randomBytes(32).toString('hex'), SUPERVISOR_ORIGIN: 'https://portal.example', SUPERVISOR_USER: 'prueba' }

test('La demo externa rechaza fuentes reales o una protección incompleta antes de escuchar', () => {
  assert.throws(() => crearServidorDemo({ ...env, CONTRACT_SOURCE: 'mysql' }, null), /mock/)
  assert.throws(() => crearServidorDemo({ ...env, INOVA_SOURCE: 'real' }, null), /mock/)
  assert.throws(() => crearServidorDemo({ ...env, SUPERVISOR_ORIGIN: '' }, null), /SUPERVISOR_ORIGIN/)
  assert.throws(() => crearServidorDemo({ ...env, DEMO_ORIGIN_SECRET: '' }, null), /DEMO_ORIGIN_SECRET/)
  assert.throws(() => crearServidorDemo(env, null), /cuenta/)
})

test('El origen externo solo sirve la API ficticia al proxy y mantiene la sesión y CSRF del panel', async t => {
  const clave = randomBytes(24).toString('hex')
  const servidor = crearServidorDemo(env, await generarHash(clave)).listen(0, '127.0.0.1')
  await once(servidor, 'listening')
  t.after(() => new Promise<void>(resolve => servidor.close(() => resolve())))
  const base = 'http://127.0.0.1:' + (servidor.address() as AddressInfo).port
  const origen = base + '/demo/api'
  const headers = { 'x-inova-demo-secret': env.DEMO_ORIGIN_SECRET }
  assert.equal((await fetch(base + '/api/configuracion', { headers })).status, 404)
  for (const ruta of ['/configuracion', '/consulta-informes?cedula=00000001', '/supervisor/sesion']) {
    assert.equal((await fetch(origen + ruta)).status, 403)
    assert.equal((await fetch(origen + ruta, { headers: { 'x-inova-demo-secret': '0'.repeat(64) } })).status, 403)
  }
  const individual = await fetch(origen + '/consulta-informes?cedula=00000001', { headers })
  assert.deepEqual((await individual.json()).fuentes, { contratos: 'mock', informes: 'mock' })
  assert.equal(individual.headers.get('Cache-Control'), 'no-store')
  assert.equal((await fetch(origen + '/supervisor/consulta', { headers })).status, 401)
  const login = await fetch(origen + '/supervisor/login', {
    method: 'POST', headers: { ...headers, origin: env.SUPERVISOR_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: env.SUPERVISOR_USER, clave }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('Set-Cookie')!
  for (const atributo of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/supervisor']) assert.ok(cookie.includes(atributo))
  const sesion = await login.json()
  const opciones = { ...headers, origin: env.SUPERVISOR_ORIGIN, cookie: cookie.split(';')[0], 'Content-Type': 'application/json' }
  const post = (cabeceras: HeadersInit) => fetch(origen + '/supervisor/consulta', { method: 'POST', headers: cabeceras, body: '{}' })
  assert.equal((await post(opciones)).status, 403)
  assert.equal((await post({ ...opciones, origin: 'https://otro.example', 'X-CSRF-Token': sesion.csrf })).status, 403)
  assert.equal((await post({ ...opciones, 'X-CSRF-Token': sesion.csrf })).status, 202)
})
