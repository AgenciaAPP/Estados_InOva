import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { crearApp, serviciosDemo } from '../backend/app.ts'
import { AlmacenSupervisorVercel, type AlmacenSupervisor, type SesionVercel } from '../backend/supervisor/almacen-vercel.ts'
import { configurarPanel } from '../backend/supervisor/config.ts'
import { generarHash } from '../backend/supervisor/cuenta.ts'
import { rutasSupervisorVercel } from '../backend/supervisor/rutas-vercel.ts'
import { leerPaginaPanelDemo, listarActivosDemo } from '../backend/mock/adaptadores.ts'
import type { LoteGuardado } from '../backend/supervisor/lote.ts'
import type { ListarActivos } from '../backend/supervisor/contratos.ts'

const clave = randomBytes(24).toString('base64url')

class AlmacenCompartidoFalso implements AlmacenSupervisor {
  sesion: SesionVercel | null = null
  intentos = 0
  turnoLogin: string | null = null
  turnoTrabajo: string | null = null

  async reservarLogin(turno: string) {
    if (this.turnoLogin) return 'ocupado' as const
    if (this.intentos >= 5) return 'limite' as const
    this.turnoLogin = turno
    this.intentos++
    return 'reservado' as const
  }

  async completarLogin(turno: string, sesion: SesionVercel | null) {
    if (this.turnoLogin !== turno) return false
    if (sesion) {
      this.sesion = sesion
      this.intentos = 0
    }
    this.turnoLogin = null
    return true
  }

  async renovarSesion(id: string) {
    if (!this.sesion || this.sesion.id !== id || this.sesion.vence <= Date.now()) return null
    this.sesion = { ...this.sesion, vence: Date.now() + 30 * 60_000 }
    return this.sesion
  }

  async guardarLote(id: string, lote: LoteGuardado) {
    if (!this.sesion || this.sesion.id !== id) return false
    this.sesion = { ...this.sesion, lote }
    return true
  }

  async revocarSesion(id: string) {
    if (!this.sesion || this.sesion.id !== id) return false
    this.sesion = null
    return true
  }

  async adquirirTrabajo(turno: string) {
    if (this.turnoTrabajo) return false
    this.turnoTrabajo = turno
    return true
  }

  async liberarTrabajo(turno: string) {
    if (this.turnoTrabajo === turno) this.turnoTrabajo = null
  }
}

async function servidor(store: AlmacenSupervisor, hash: string, listar: ListarActivos = listarActivosDemo) {
  const app = crearApp(serviciosDemo, 'mock')
  const panel = configurarPanel({ SUPERVISOR_ORIGIN: 'https://vercel.test' }, 'mock')
  app.use('/api/supervisor', rutasSupervisorVercel(
    panel,
    hash,
    listar,
    { ...serviciosDemo, leerPagina: leerPaginaPanelDemo },
    { contratos: 'mock', informes: 'mock' },
    store,
  ))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  return {
    base,
    cerrar: () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())),
  }
}

test('Las funciones del supervisor recuperan sesión, lote, filtro y Excel desde almacenamiento compartido', async t => {
  const hash = await generarHash(clave)
  const store = new AlmacenCompartidoFalso()
  const primero = await servidor(store, hash)
  const segundo = await servidor(store, hash)
  t.after(async () => { await Promise.all([primero.cerrar(), segundo.cerrar()]) })
  const origen = { origin: 'https://vercel.test' }
  const iniciarSesion = await fetch(primero.base + '/api/supervisor/login', {
    method: 'POST',
    headers: { ...origen, 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: 'supervisor_agencia_app', clave }),
  })
  assert.equal(iniciarSesion.status, 200)
  const cookie = iniciarSesion.headers.get('set-cookie')!.split(';')[0]
  const sesion = await iniciarSesion.json() as { csrf: string }
  const autorizacion = { cookie, 'x-csrf-token': sesion.csrf }

  const restaurada = await fetch(segundo.base + '/api/supervisor/sesion', { headers: { cookie } })
  assert.equal(restaurada.status, 200)
  assert.equal((await restaurada.json()).csrf, sesion.csrf)

  const lote = await fetch(segundo.base + '/api/supervisor/consulta', {
    method: 'POST',
    headers: { ...origen, ...autorizacion, 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(lote.status, 202)
  const pagina = await lote.json()
  assert.equal(pagina.estado, 'completa')
  assert.equal(pagina.total, 3)

  const filtro = await fetch(primero.base + '/api/supervisor/consulta/filtrar', {
    method: 'POST',
    headers: { ...origen, ...autorizacion, 'content-type': 'application/json' },
    body: JSON.stringify({ columna: 'cedula', texto: '00000005', pagina: 1 }),
  })
  assert.equal(filtro.status, 200)
  assert.equal((await filtro.json()).coincidencias, 1)

  const excel = await fetch(segundo.base + '/api/supervisor/exportar-excel', {
    method: 'POST',
    headers: { ...origen, ...autorizacion, 'content-type': 'application/json' },
    body: JSON.stringify({ consulta: pagina.fecha, columna: 'cedula', texto: '' }),
  })
  assert.equal(excel.status, 200)
  assert.match(excel.headers.get('content-disposition') ?? '', /\.xlsx/)

  const salir = await fetch(primero.base + '/api/supervisor/logout', {
    method: 'POST',
    headers: { ...origen, ...autorizacion, 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(salir.status, 200)
  assert.equal(await (await fetch(segundo.base + '/api/supervisor/sesion', { headers: { cookie } })).json(), null)
})

test('El cliente Upstash usa HTTPS, autenticación bearer y comandos Redis acotados', async () => {
  const llamadas: { url: string; args: string[]; authorization: string }[] = []
  const enviar: typeof fetch = async (input, init) => {
    const args = JSON.parse(String(init?.body)) as string[]
    llamadas.push({
      url: String(input),
      args,
      authorization: new Headers(init?.headers).get('authorization') ?? '',
    })
    const script = args[1] ?? ''
    const result = args[0] === 'SET' ? 'OK'
      : script.includes("INCR") ? 1
      : script.includes('sesion.vence') ? JSON.stringify({
          id: 'a'.repeat(64), csrf: 'b'.repeat(64), vence: Number(args[6]), lote: null,
        })
      : 1
    return new Response(JSON.stringify({ result }), { status: 200 })
  }
  const store = new AlmacenSupervisorVercel('https://redis.example', 'token-de-prueba', enviar)
  assert.equal(await store.reservarLogin('turno'), 'reservado')
  const sesion: SesionVercel = { id: 'a'.repeat(64), csrf: 'b'.repeat(64), vence: Date.now() + 1800000, lote: null }
  assert.equal(await store.completarLogin('turno', sesion), true)
  assert.equal((await store.renovarSesion(sesion.id))?.id, sesion.id)
  assert.equal(await store.guardarLote(sesion.id, {
    fecha: new Date().toISOString(), estado: 'completa', candidatos: 0,
    procesados: 0, incluidos: 0, filas: [],
  }), true)
  assert.equal(await store.revocarSesion(sesion.id), true)
  assert.equal(await store.adquirirTrabajo('trabajo', 60), true)
  await store.liberarTrabajo('trabajo')
  assert.equal(llamadas.length, 7)
  assert.ok(llamadas.every(llamada => llamada.authorization === 'Bearer token-de-prueba'))
})

test('El panel serverless rechaza lotes de más de diez filas antes de consultar informes', async t => {
  const hash = await generarHash(clave)
  const store = new AlmacenCompartidoFalso()
  const demo = await listarActivosDemo(null)
  const listar: ListarActivos = async () => [...demo, ...Array.from({ length: 7 }, () => demo[0])]
  const server = await servidor(store, hash, listar)
  t.after(server.cerrar)
  const origen = { origin: 'https://vercel.test', 'content-type': 'application/json' }
  const login = await fetch(server.base + '/api/supervisor/login', {
    method: 'POST',
    headers: origen,
    body: JSON.stringify({ usuario: 'supervisor_agencia_app', clave }),
  })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const { csrf } = await login.json() as { csrf: string }
  const respuesta = await fetch(server.base + '/api/supervisor/consulta', {
    method: 'POST',
    headers: { ...origen, cookie, 'x-csrf-token': csrf },
    body: '{}',
  })
  assert.equal(respuesta.status, 409)
  assert.match((await respuesta.json()).mensaje, /diez/)
  assert.equal(store.sesion?.lote, null)
})
