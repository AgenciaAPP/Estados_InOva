/// <reference lib="es2024.promise" />
import assert from 'node:assert/strict'
import { execFile, fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import ExcelJS from 'exceljs'
import { crearDemo } from '../backend/demo/app.ts'
import { generarHash } from '../backend/supervisor/argon2.ts'
import { columnasPanel, textoCeldaPanel, type ColumnaPanel } from '../shared/supervisor.ts'

const host = 'ensayo-preview.example'
const origen = 'https://' + host
const tokenDb = randomBytes(24).toString('hex')
const clave = randomBytes(24).toString('hex')
const env = { VERCEL_ENV: 'preview', VERCEL_URL: host, TURSO_DATABASE_URL: 'libsql://prueba.turso.io',
  TURSO_AUTH_TOKEN: tokenDb, DEMO_SUPERVISOR_HASH: await generarHash(clave) }

test('La configuración solo habilita Preview y dirige /api a la función del mismo proyecto', async () => {
  const anterior = process.env.VERCEL_ENV
  try {
    for (const ambiente of ['production', 'preview', 'development']) {
      process.env.VERCEL_ENV = ambiente
      const { config } = await import(new URL('../vercel.ts?' + ambiente, import.meta.url).href)
      const [ruta] = config.routes
      assert.equal(config.outputDirectory, 'dist/client')
      assert.equal(config.functions['api/index.ts'].maxDuration, 30)
      if (ambiente === 'preview') {
        assert.equal('/api/supervisor/login'.replace(new RegExp(ruta.src), ruta.dest), '/api/index?__ruta=supervisor/login')
      } else assert.equal(ruta.status, 403)
    }
  } finally {
    if (anterior === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = anterior
  }
})

test('Preview rechaza fuentes reales, secretos institucionales o configuración insegura', () => {
  for (const ajuste of [{ VERCEL_ENV: 'production' }, { VERCEL_URL: '' }, { CONTRACT_SOURCE: 'mysql' }, { INOVA_SOURCE: 'real' },
    { DB_PASSWORD: 'sintetica' }, { DB_SSL_CA_FILE: 'prueba.pem' }, { INOVA_API_KEY: 'sintetica' },
    { DEMO_SUPERVISOR_HASH: 'invalido' }, { TURSO_DATABASE_URL: 'http://prueba.turso.io' }, { TURSO_AUTH_TOKEN: '' }]) {
    assert.throws(() => crearDemo({ ...env, ...ajuste }))
  }
})

async function instancia(t: TestContext, entrada: string, almacen: string) {
  const child = fork(new URL('./fixtures/instancia-preview.mjs', import.meta.url), [entrada, almacen], {
    execArgv: [], env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, ...env },
  })
  t.after(() => { if (child.connected) child.disconnect() })
  const [puerto] = await once(child, 'message', { signal: AbortSignal.timeout(10000) })
  return 'http://127.0.0.1:' + puerto
}

test('La función compilada funciona en dos procesos independientes con SQL compartido', async t => {
  await mkdir('dist', { recursive: true })
  const salida = await mkdtemp(resolve('dist/ensayo-preview-'))
  t.after(() => rm(salida, { recursive: true, force: true }))
  await promisify(execFile)(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'api/tsconfig.json', '--outDir', salida])
  const modulos = await readdir(join(salida, 'backend'))
  assert.ok(!modulos.includes('mysql') && !modulos.includes('inova') && !modulos.includes('index.js'))
  const entrada = pathToFileURL(join(salida, 'api/index.js')).href
  const db = new DatabaseSync(':memory:')
  let caido = false
  let antesDeSql: ((sql: string) => Promise<void>) | undefined
  const almacen = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v2/pipeline')
      assert.equal(req.headers.authorization, 'Bearer ' + tokenDb)
      if (caido) { res.writeHead(503).end(); return }
      const partes = []
      for await (const chunk of req) partes.push(chunk)
      const { requests } = JSON.parse(Buffer.concat(partes).toString())
      assert.equal(requests[0].type, 'execute')
      assert.deepEqual(requests[1], { type: 'close' })
      const { sql, args } = requests[0].stmt
      await antesDeSql?.(sql)
      const stmt = db.prepare(sql)
      stmt.setReturnArrays(true)
      const rows = stmt.all(...args.map((a: { type: string; value: string }) => {
        assert.equal(a.type, 'text')
        return a.value
      })).map(row => (row as unknown as (string | number | null)[]).map(value => value === null
        ? { type: 'null' } : { type: typeof value === 'number' ? 'integer' : 'text', value: String(value) }))
      res.end(JSON.stringify({ results: [{ type: 'ok', response: { type: 'execute', result: { rows } } },
        { type: 'ok', response: { type: 'close' } }] }))
    } catch (err) { res.writeHead(500).end(); console.error(err) }
  }).listen(0, '127.0.0.1')
  await once(almacen, 'listening')
  t.after(async () => {
    await new Promise<void>(r => { almacen.close(() => r()); almacen.closeAllConnections() })
    db.close()
  })
  const urlDb = 'http://127.0.0.1:' + (almacen.address() as AddressInfo).port
  const a = await instancia(t, entrada, urlDb)
  const b = await instancia(t, entrada, urlDb)
  const get = (base: string, path: string, cookie = '') => fetch(base + '/api/' + path, { headers: { host, cookie } })
  const post = (base: string, ruta: string, body: object, cookie = '', csrf = '', origin = origen) =>
    fetch(base + '/api/supervisor/' + ruta, { method: 'POST', body: JSON.stringify(body),
      headers: { host, origin, cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } })
  const acceder = (base: string, password = clave) => post(base, 'login', { usuario: 'supervisor_demo', clave: password })
  async function login(base: string) {
    const r = await acceder(base)
    assert.equal(r.status, 200)
    const cookie = r.headers.get('set-cookie')!
    for (const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/api/supervisor']) assert.ok(cookie.includes(flag))
    return { cookie: cookie.split(';')[0], csrf: (await r.json()).csrf as string }
  }

  await t.test('Contratista, tres estados ficticios y panel protegido sin sesión', async () => {
    assert.deepEqual((await (await get(a, 'configuracion')).json()).fuentes, { contratos: 'mock', informes: 'mock' })
    const r = await get(b, 'consulta-informes?cedula=00000001')
    assert.equal(r.headers.get('cache-control'), 'no-store')
    const datos = await r.json()
    assert.equal(datos.numeroContrato, 'DEMO-001')
    assert.deepEqual(Object.keys(datos.informes).sort(), ['cobro', 'gestion', 'supervision'])
    const reescrita = await get(b, 'index?__ruta=consulta-informes&cedula=00000001')
    assert.deepEqual(await reescrita.json(), datos)
    assert.equal((await get(a, 'consulta-informes?cedula=00000003')).status, 404)
    assert.equal((await get(a, 'supervisor/consulta')).status, 401)
    assert.equal((await get(a, 'index?__ruta=supervisor/consulta')).status, 401)
    assert.equal((await post(b, 'exportar-excel', {})).status, 401)
  })
  await t.test('Cookie compartida, CSRF, indicadores, dos páginas y Excel de todas las coincidencias', async () => {
    const s = await login(a)
    assert.equal((await (await get(b, 'supervisor/sesion', s.cookie)).json()).csrf, s.csrf)
    assert.equal((await post(b, 'consulta', {}, s.cookie)).status, 403)
    assert.equal((await post(b, 'consulta', {}, s.cookie, s.csrf, 'https://otro.example')).status, 403)
    const r = await post(b, 'consulta', {}, s.cookie, s.csrf)
    assert.equal(r.status, 200)
    const lote = await r.json()
    assert.deepEqual([lote.estado, lote.candidatos, lote.procesados, lote.excluidos, lote.incluidos, lote.paginas],
      ['completa', 4, 4, 1, 3, 2])
    const segunda = await (await get(a, 'supervisor/consulta?pagina=2', s.cookie)).json()
    assert.equal(segunda.fecha, lote.fecha)
    assert.equal(segunda.filas.length, 1)
    const cedula = segunda.filas[0].cedula
    const todas = [...lote.filas, ...segunda.filas]
    for (const columna of Object.keys(columnasPanel) as ColumnaPanel[]) {
      const texto = textoCeldaPanel(segunda.filas[0], columna)
      const pagina = await (await post(b, 'consulta/filtrar', { columna, texto }, s.cookie, s.csrf)).json()
      assert.equal(pagina.coincidencias, todas.filter(f => textoCeldaPanel(f, columna).includes(texto)).length)
    }
    const filtro = { columna: 'cedula', texto: cedula }
    const filtrada = await (await post(a, 'consulta/filtrar', filtro, s.cookie, s.csrf)).json()
    assert.equal(filtrada.coincidencias, 1)
    assert.equal(filtrada.filas[0].cedula, cedula)
    for (const [texto, esperadas] of [[cedula, [cedula]], ['', [...lote.filas, ...segunda.filas].map(f => f.cedula)]] as const) {
      const xlsx = await post(b, 'exportar-excel', { consulta: lote.fecha, columna: 'cedula', texto }, s.cookie, s.csrf)
      assert.equal(xlsx.status, 200)
      assert.match(xlsx.headers.get('Content-Disposition')!, /Estados_Contratos_PS_.*\.xlsx/)
      const bytes = await xlsx.arrayBuffer()
      assert.ok(bytes.byteLength < 4_500_000)
      const libro = new ExcelJS.Workbook()
      await libro.xlsx.load(bytes)
      const hoja = libro.worksheets[0]
      assert.equal(hoja.columnCount, 9)
      assert.deepEqual((hoja.getRow(1).values as string[]).slice(1), Object.values(columnasPanel))
      assert.deepEqual((hoja.getColumn(1).values as string[]).slice(2), esperadas)
    }
    await post(a, 'consulta', {}, s.cookie, s.csrf)
    assert.equal((await post(b, 'exportar-excel', { consulta: lote.fecha, ...filtro }, s.cookie, s.csrf)).status, 409)
    assert.equal((await post(b, 'logout', {}, s.cookie, s.csrf)).status, 200)
    assert.equal((await get(a, 'supervisor/consulta', s.cookie)).status, 401)
    assert.equal((await post(a, 'exportar-excel', {}, s.cookie, s.csrf)).status, 401)
  })
  await t.test('Un nuevo login reemplaza al anterior y la expiración del servidor impide renovar la cookie', async () => {
    const vieja = await login(b), nueva = await login(a)
    assert.equal((await get(b, 'supervisor/consulta', vieja.cookie)).status, 401)
    const fila = db.prepare('SELECT vence, sesion FROM inova_demo').get()!
    assert.notEqual(fila.sesion, nueva.cookie.split('=')[1])
    assert.ok(Math.abs(Number(fila.vence) - Date.now()/1000 - 1800) < 5)
    db.exec('UPDATE inova_demo SET vence = unixepoch() - 1')
    assert.equal(await (await get(b, 'supervisor/sesion', nueva.cookie)).json(), null)
    assert.equal((await post(a, 'consulta', {}, nueva.cookie, nueva.csrf)).status, 401)
  })
  await t.test('Cinco fallos se acumulan entre instancias y el acceso vuelve tras diez minutos', async () => {
    for (const base of [a,b,a,b,a]) assert.equal((await acceder(base, 'incorrecta')).status, 401)
    assert.equal((await acceder(b)).status, 429)
    db.exec("UPDATE inova_demo SET intentos = json_array(unixepoch()-601)")
    await login(b)
  })
  await t.test('Un trabajo activo impide solapamiento y un logout durante el trabajo impide confirmarlo', async () => {
    const s = await login(a)
    const ocupado = Promise.withResolvers<void>(), continuar = Promise.withResolvers<void>()
    antesDeSql = async sql => {
      if (sql.includes('SET consulta = ?, trabajo = NULL')) { ocupado.resolve(); await continuar.promise }
    }
    const consulta = post(a, 'consulta', {}, s.cookie, s.csrf)
    try {
      await Promise.race([ocupado.promise, consulta.then(() => { throw Error('Consulta terminó antes de la reserva') })])
      assert.equal((await post(b, 'consulta', {}, s.cookie, s.csrf)).status, 409)
      assert.equal((await post(b, 'logout', {}, s.cookie, s.csrf)).status, 200)
    } finally { antesDeSql = undefined; continuar.resolve() }
    assert.equal((await consulta).status, 401)
    const nueva = await login(b)
    assert.equal(await (await get(a, 'supervisor/consulta', nueva.cookie)).json(), null)
  })
  await t.test('Una caída del almacenamiento cierra el acceso; el logout solo se confirma al persistir', async () => {
    const s = await login(b)
    caido = true
    try {
      assert.equal((await get(a, 'supervisor/consulta', s.cookie)).status, 503)
      const cierre = await post(a, 'logout', {}, s.cookie, s.csrf)
      assert.equal(cierre.status, 503)
      assert.equal(cierre.headers.get('Set-Cookie'), null)
    } finally { caido = false }
    assert.equal((await post(b, 'logout', {}, s.cookie, s.csrf)).status, 200)
    assert.equal((await get(a, 'supervisor/consulta', s.cookie)).status, 401)
  })
})
