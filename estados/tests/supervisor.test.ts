import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { before, test, type TestContext } from 'node:test'
import { crearApp, serviciosDemo } from '../backend/app.ts'
import { configurarPanel } from '../backend/supervisor/config.ts'
import ExcelJS from 'exceljs'
import { generarHash } from '../backend/supervisor/cuenta.ts'
import { rutasSupervisor } from '../backend/supervisor/rutas.ts'
import { crearListadoMysql, type ListarActivos } from '../backend/supervisor/contratos.ts'
import { Lote } from '../backend/supervisor/lote.ts'
import { leerPaginaPanelDemo, listarActivosDemo } from '../backend/mock/adaptadores.ts'
import type { Servicios } from '../backend/services/consulta.ts'
import type { ColumnaPanel, ContratoActivo, PaginaPanel } from '../shared/supervisor.ts'
import { crearConsultaInova } from '../backend/inova/informes.ts'
import { opcionesInova } from '../backend/inova/config.ts'

const clave = randomBytes(24).toString('base64url')
const config = configurarPanel({}, 'mock')
const fuentes = { contratos: 'mock', informes: 'mock' } as const
const servicios = { ...serviciosDemo, leerPagina: leerPaginaPanelDemo }
let hash: string
before(async () => { hash = await generarHash(clave) })

async function servidor(t: TestContext, listar: ListarActivos = listarActivosDemo, opciones = config, credencial: string | null = hash, proveedor: Servicios = servicios) {
  const app = crearApp(serviciosDemo, 'mock')
  app.use('/api/supervisor', rutasSupervisor(opciones, credencial, listar, proveedor, fuentes))
  const s = app.listen(0, '127.0.0.1')
  await once(s, 'listening')
  t.after(() => new Promise<void>((resolve, reject) => s.close(err => err ? reject(err) : resolve())))
  const base = 'http://127.0.0.1:' + (s.address() as AddressInfo).port
  const url = base + '/api/supervisor/'
  const post = (ruta: string, cuerpo: unknown, headers: Record<string, string> = {}) => fetch(url + ruta, {
    method: 'POST', headers: { origin: opciones.origen ?? base, 'content-type': 'application/json', ...headers }, body: JSON.stringify(cuerpo),
  })
  async function login() {
    const r = await post('login', { usuario: config.usuario, clave })
    assert.equal(r.status, 200)
    const cookie = r.headers.get('set-cookie')!
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Strict/)
    assert.match(cookie, /Path=\/api\/supervisor/)
    if (opciones.origen) assert.match(cookie, /; Secure/)
    const { csrf } = await r.json()
    assert.match(csrf, /^[0-9a-f]{64}$/)
    return { cookie: cookie.split(';')[0], 'x-csrf-token': csrf }
  }
  return { base, url, post, login }
}

test('El piloto exige contratos explícitos y limita volumen, concurrencia y origen', () => {
  assert.deepEqual(configurarPanel({}, 'mysql').autorizados, [])
  assert.equal(configurarPanel({ SUPERVISOR_SCOPE: 'all' }, 'mysql').autorizados, null)
  for (const lista of ['{}', '[1]', '[""]', JSON.stringify(Array(11).fill('01'))]) {
    assert.throws(() => configurarPanel({ SUPERVISOR_PILOT_CONTRACTS: lista }, 'mysql'))
  }
  for (const n of ['0', '1.2', '9']) assert.throws(() => configurarPanel({ SUPERVISOR_CONCURRENCY: n }, 'mock'))
  assert.throws(() => configurarPanel({ SUPERVISOR_ORIGIN: 'http://ejemplo.invalid' }, 'mysql'))
})

test('El listado comprueba el esquema, ejecuta un SELECT parametrizado y conserva filas y ceros', async () => {
  const llamadas: { sql: string; params: string[] }[] = []
  const fila = { nitCc: '0002', contratista: 'Prueba', supervisor: 'Equipo de prueba', apoyoSupervision: ' ', apoyoLogistico: null }
  const listar = crearListadoMysql(async (sql, params) => {
    llamadas.push({ sql, params })
    return sql.includes('LIMIT 0') ? [] : ['PS00A', 'PS00B', 'PS00a'].map((numeroContrato, i) => ({
      ...fila, nitCc: String(i + 2).padStart(4, '0'), numeroContrato,
    }))
  })
  assert.deepEqual(await listar([]), [])
  assert.equal(llamadas.length, 0)
  const resultado = await listar(['PS00A', 'PS00B', 'AB001'])
  assert.deepEqual(resultado.map(f => f.numeroContrato), ['PS00A', 'PS00B'])
  assert.deepEqual(resultado[0], { cedula: '0002', numeroContrato: 'PS00A', contratista: 'Prueba', supervisor: 'Equipo de prueba', apoyoSupervision: null, apoyoLogistico: null })
  assert.match(llamadas[0].sql, /estado, fechaActualizacion FROM contratos LIMIT 0/)
  assert.match(llamadas[1].sql, /WHERE estado = \? AND numeroContrato LIKE CAST\(\? AS BINARY\) AND CAST\(numeroContrato AS BINARY\) IN \(\?, \?, \?\)/)
  assert.deepEqual(llamadas[1].params, ['EN EJECUCIÓN', 'PS%', 'PS00A', 'PS00B', 'AB001'])
  await listar(null)
  assert.equal(llamadas.length, 3)
  assert.match(llamadas[2].sql, /WHERE estado = \? AND numeroContrato LIKE CAST\(\? AS BINARY\)\s*\)/)
  assert.deepEqual(llamadas[2].params, ['EN EJECUCIÓN', 'PS%'])
})

test('La consulta individual permanece pública y las lecturas, escritura de sesión y lote están separadas', async t => {
  let lecturas = 0
  const { base, url, post, login } = await servidor(t, async a => { lecturas++; return listarActivosDemo(a) })
  assert.equal((await fetch(base + '/api/consulta-informes?cedula=00000001')).status, 200)
  const individual = await fetch(base + '/api/consulta-informes?cedula=00000006')
  assert.equal(individual.status, 200)
  const sinEnvios = await individual.json()
  assert.equal(sinEnvios.numeroContrato, 'PS005')
  assert.deepEqual(sinEnvios.informes, { gestion: null, supervision: null, cobro: null })
  assert.equal(await (await fetch(url + 'sesion')).json(), null)
  assert.equal((await fetch(url + 'consulta')).status, 401)
  assert.equal((await post('consulta', {})).status, 401)
  assert.equal((await post('login', { usuario: config.usuario, clave }, { origin: 'https://otro.invalid' })).status, 403)
  assert.equal((await post('login', { usuario: config.usuario, clave: '' })).status, 401)
  const h = await login()
  assert.equal(await (await fetch(url + 'consulta', { headers: h })).json(), null)
  assert.equal((await post('consulta', {}, { cookie: h.cookie })).status, 403)
  assert.equal((await post('consulta', {}, { ...h, origin: 'null' })).status, 403)
  assert.equal(lecturas, 0)
  assert.equal((await post('consulta', {}, h)).status, 202)
  const r = await fetch(url + 'consulta', { headers: h })
  assert.equal(r.headers.get('cache-control'), 'no-store')
  const datos: PaginaPanel = await r.json()
  assert.equal(lecturas, 1)
  assert.equal(datos.estado, 'completa')
  assert.equal(datos.total, 3)
  assert.equal(datos.candidatos, 4)
  assert.equal(datos.procesados, 4)
  assert.equal(datos.incluidos, 3)
  assert.equal(datos.excluidos, 1)
  assert.deepEqual(datos.filas.map(f => f.numeroContrato), ['PS001', 'PS003', 'PS004'])
  assert.deepEqual(datos.filas.filter(f => f.cedula === '00000001').map(f => f.numeroContrato), ['PS001'])
  assert.ok(datos.filas.every(f => f.cedula !== '00000004'))
  const [alfa, beta, conError] = datos.filas
  assert.deepEqual(Object.values(alfa.informes).map(i => i && 'nombre' in i && i.nombre), ['Aprobado', 'En revisión', 'Pendiente'])
  assert.equal(beta.apoyoSupervision, null)
  assert.equal(beta.informes.cobro, null)
  assert.ok(conError.informes.gestion && 'aviso' in conError.informes.gestion)
  assert.deepEqual(conError.informes.supervision, { nombre: 'Aprobado', tono: 'aprobado' })
  assert.equal((await post('logout', {}, { cookie: h.cookie })).status, 403)
  assert.equal((await post('logout', {}, h)).status, 200)
  assert.equal((await fetch(url + 'consulta', { headers: h })).status, 401)
})

test('La búsqueda exige una sesión y CSRF, y valida la columna, el texto y la página', async t => {
  const { post, login } = await servidor(t)
  const ruta = 'consulta/filtrar'
  const cuerpo = { columna: 'cedula', texto: '000', pagina: 1 }
  assert.equal((await post(ruta, cuerpo)).status, 401)
  const h = await login()
  assert.equal((await post(ruta, cuerpo, { cookie: h.cookie })).status, 403)
  assert.equal((await post(ruta, cuerpo, { ...h, origin: 'https://otro.invalid' })).status, 403)
  assert.equal(await (await post(ruta, cuerpo, h)).json(), null)
  for (const cambio of [{ columna: '__proto__' }, { texto: 123 }, { texto: 'x'.repeat(513) }, { pagina: 0 }, { pagina: 1.5 }]) {
    assert.equal((await post(ruta, { ...cuerpo, ...cambio }, h)).status, 400)
  }
  await post('logout', {}, h)
  assert.equal((await post(ruta, cuerpo, h)).status, 401)
})

test('Filtra todo el resultado temporal y pagina las coincidencias sin repetir lecturas de los proveedores', async t => {
  const filas = Array.from({ length: 61 }, (_, i) => ({
    cedula: String(i).padStart(8, '0'), numeroContrato: 'PS' + String(i).padStart(5, '0'),
    contratista: i === 52 ? 'Contratista Ámbar' : 'Contratista ficticio',
    supervisor: i % 2 === 0 ? 'Equipo de Revisión' : 'Equipo auxiliar',
    apoyoSupervision: i === 52 ? 'Comisión Técnica' : null,
    apoyoLogistico: i === 52 ? 'Logística de Tránsito' : null,
  }))
  let listados = 0, documentos = 0
  const proveedor: Servicios = { ...serviciosDemo, async consultarInforme(tipo, contrato) {
    documentos++
    if (contrato === filas[60].numeroContrato) return null
    if (contrato === filas[52].numeroContrato) {
      const nombres = { gestion: 'Aprobado', supervision: 'Revisión Logística', cobro: 'Corrección por Supervisor' }
      return { nombre: nombres[tipo], tono: 'revision' }
    }
    if (tipo === 'gestion') return { nombre: 'Revisión Apoyo', tono: 'revision' }
    if (tipo === 'cobro' && contrato === filas[0].numeroContrato) throw new Error('Fallo simulado')
    if (tipo === 'supervision' && contrato === filas[1].numeroContrato) return { nombre: 'Estado no identificado', tono: 'neutral' }
    return null
  } }
  const { post, login } = await servidor(t, async () => { listados++; return filas }, config, hash, proveedor)
  const h = await login()
  assert.equal((await post('consulta', {}, h)).status, 202)
  async function buscar(columna: ColumnaPanel, texto: string, pagina = 1): Promise<PaginaPanel> {
    const r = await post('consulta/filtrar', { columna, texto, pagina }, h)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    const datos: PaginaPanel = await r.json()
    assert.equal(datos.estado, 'completa')
    assert.deepEqual([datos.candidatos, datos.procesados, datos.excluidos, datos.incluidos, datos.total], [61, 61, 1, 60, 60])
    return datos
  }
  const casos: [ColumnaPanel, string, number][] = [
    ['cedula', '00000052', 52], ['contratista', '  AMba  ', 52], ['numeroContrato', 's00052', 52],
    ['apoyoSupervision', 'MISION tec', 52], ['apoyoLogistico', 'TRANSITO', 52],
    ['gestion', 'proba', 52], ['supervision', 'ION LOGIS', 52], ['cobro', 'correccion POR', 52],
    ['supervision', 'NO identific', 1], ['cobro', 'no se pudo consultar', 0],
  ]
  for (const [columna, termino, indice] of casos) {
    const pagina = await buscar(columna, termino)
    assert.equal(pagina.coincidencias, 1, columna)
    assert.deepEqual(pagina.filas.map(f => f.cedula), [filas[indice].cedula])
  }
  assert.equal((await buscar('apoyoLogistico', 'No registrado')).coincidencias, 59)
  assert.equal((await buscar('supervision', 'sin registros')).coincidencias, 58)
  const pares = filas.filter((_, i) => i < 60 && i % 2 === 0).map(fila => fila.cedula)
  for (const numero of [1, 2]) {
    const pagina = await buscar('supervisor', '  REVISIÓN ', numero)
    assert.deepEqual([pagina.coincidencias, pagina.paginas, pagina.pagina], [30, 2, numero])
    assert.deepEqual(pagina.filas.map(f => f.cedula), pares.slice((numero - 1) * 25, numero * 25))
  }
  const otraColumna = await buscar('contratista', 'revisión')
  assert.deepEqual([otraColumna.coincidencias, otraColumna.paginas, otraColumna.filas], [0, 0, []])
  for (const texto of ['', '   ']) {
    const todo = await buscar('supervisor', texto)
    assert.deepEqual([todo.coincidencias, todo.paginas, todo.pagina], [60, 3, 1])
    assert.deepEqual(todo.filas.map(f => f.cedula), filas.slice(0, 25).map(f => f.cedula))
  }
  // El Excel y la página usan las mismas coincidencias, también fuera de la primera página.
  const consulta = (await buscar('cedula', '')).fecha
  for (const [columna, texto, esperadas] of [
    ...casos.map(([c, t, i]) => [c, t, [filas[i].cedula]] as const),
    ['supervisor', '  revision ', pares],
    ['cedula', '', filas.slice(0, 60).map(f => f.cedula)],
  ] as const) {
    const r = await post('exportar-excel', { consulta, columna, texto }, h)
    assert.equal(r.status, 200, columna)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.equal(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.match(r.headers.get('content-disposition')!, /^attachment; filename="?Estados_Contratos_PS_\d{4}-\d\d-\d\d_\d{4}\.xlsx"?$/)
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.load(await r.arrayBuffer())
    const hoja = libro.getWorksheet('Contratos activos')!
    assert.deepEqual(hoja.getColumn(1).values.slice(2), esperadas)
  }
  assert.equal((await post('exportar-excel', { consulta, columna: 'cedula', texto: 'sin coincidencias' }, h)).status, 409)
  assert.equal(listados, 1)
  assert.equal(documentos, 61 * 3)
})

test('Excel solo entrega el lote finalizado de la sesión vigente con origen y CSRF válidos', async t => {
  let entregar!: (filas: ContratoActivo[]) => void
  const { url, post, login } = await servidor(t, () => new Promise(resolve => { entregar = resolve }))
  const ruta = 'exportar-excel'
  const cuerpo = { columna: 'supervisor', texto: '', consulta: '' }
  assert.equal((await post(ruta, cuerpo)).status, 401)
  const h = await login()
  assert.equal((await post(ruta, cuerpo, { cookie: h.cookie })).status, 403)
  assert.equal((await post(ruta, cuerpo, { ...h, origin: 'https://otro.invalid' })).status, 403)
  assert.equal((await post(ruta, cuerpo, h)).status, 409)
  const inicio: PaginaPanel = await (await post('consulta', {}, h)).json()
  cuerpo.consulta = inicio.fecha
  assert.equal((await post(ruta, cuerpo, h)).status, 409)
  entregar(await listarActivosDemo(null))
  assert.equal((await (await fetch(url + 'consulta', { headers: h })).json()).estado, 'completa')
  for (const cambio of [{ filas: [{ cedula: '000' }] }, { columna: 'privada' }, { texto: 123 }, { texto: 'a'.repeat(513) }]) {
    assert.equal((await post(ruta, { ...cuerpo, ...cambio }, h)).status, 400)
  }
  assert.equal((await post(ruta, { ...cuerpo, consulta: 'resultado anterior' }, h)).status, 409)
  const segunda = await login()
  assert.equal((await post(ruta, cuerpo, h)).status, 401)
  assert.equal((await post(ruta, cuerpo, segunda)).status, 409)
  const siguiente: PaginaPanel = await (await post('consulta', {}, segunda)).json()
  entregar(await listarActivosDemo(null))
  const futuro = Date.now() + 31 * 60_000
  t.mock.method(Date, 'now', () => futuro)
  assert.equal((await post(ruta, { ...cuerpo, consulta: siguiente.fecha }, segunda)).status, 401)
})

test('Cuenta deshabilitada, piloto vacío y límite de intentos bloquean el acceso correspondiente', async t => {
  const sinCuenta = await servidor(t, listarActivosDemo, config, null)
  assert.equal((await sinCuenta.post('login', { usuario: config.usuario, clave })).status, 503)
  const { post, login } = await servidor(t, () => { throw new Error('No debe listar') },
    configurarPanel({ SUPERVISOR_ORIGIN: 'https://pruebas.invalid' }, 'mysql'))
  const h = await login()
  assert.equal((await post('consulta', {}, h)).status, 409)
  for (let i = 0; i < 5; i++) assert.equal((await post('login', { usuario: 'desconocido', clave })).status, 401)
  const bloqueada = await post('login', { usuario: config.usuario, clave })
  assert.equal(bloqueada.status, 429)
  assert.ok(bloqueada.headers.has('retry-after'))
})

test('Impide solapamientos y separa resultados entre sesiones incluso durante la lectura MySQL', async t => {
  let resolver!: (filas: ContratoActivo[]) => void
  const { post, login, url } = await servidor(t, () => new Promise(r => { resolver = r }))
  const inicial = await login()
  assert.equal((await post('consulta', {}, inicial)).status, 202)
  assert.equal((await post('consulta', {}, inicial)).status, 409)
  const nueva = await login()
  assert.equal((await fetch(url + 'consulta', { headers: inicial })).status, 401)
  assert.equal(await (await fetch(url + 'consulta', { headers: nueva })).json(), null)
  assert.equal((await post('consulta', {}, nueva)).status, 409)
  resolver(await listarActivosDemo(null))
  assert.equal((await post('consulta', {}, nueva)).status, 202)
  resolver([])
})

test('Procesa dos contratos simultáneos y entrega páginas progresivas en el orden original', async () => {
  const [base] = await listarActivosDemo(null)
  const filas = Array.from({ length: 30 }, (_, i) => ({ ...base, cedula: String(i).padStart(8, '0'), numeroContrato: String(i).padStart(3, '0') }))
  const sinEstado = new Set(['000', '007', '025', '029'])
  const esperas = new Map<string, () => void>()
  const llamadas = new Map<string, number>()
  const proveedor: Servicios = { buscarContrato: () => { throw new Error('No debe volver a buscar por cédula') },
    async consultarInforme(tipo, contrato) {
      llamadas.set(contrato, (llamadas.get(contrato) ?? 0) + 1)
      if (tipo === 'gestion') await new Promise<void>(r => esperas.set(contrato, r))
      return tipo === 'gestion' && !sinEstado.has(contrato) ? { nombre: 'Aprobado', tono: 'aprobado' } : null
    } }
  const lote = new Lote()
  const fin = lote.ejecutar(async () => filas, proveedor, config)
  const turno = () => new Promise<void>(r => setImmediate(r))
  await turno()
  assert.equal(esperas.size, 2)
  esperas.get('001')!()
  await turno()
  assert.equal(lote.pagina(1).filas.length, 0)
  assert.equal(lote.pagina(1).total, null)
  assert.equal(lote.pagina(1).incluidos, 1)
  assert.equal(lote.pagina(1).excluidos, 0)
  assert.equal(lote.pagina(1).procesados, 1)
  assert.equal(lote.pagina(1).candidatos, 30)
  esperas.get('000')!()
  await turno()
  assert.deepEqual(lote.pagina(1).filas.map(f => f.numeroContrato), ['001'])
  assert.equal(lote.pagina(1).excluidos, 1)
  for (let i = 2; i < 30; i++) {
    assert.ok(esperas.size <= i + 2)
    esperas.get(filas[i].numeroContrato)!()
    await turno()
  }
  await fin
  const incluidos = filas.map(f => f.numeroContrato).filter(n => !sinEstado.has(n))
  assert.deepEqual(lote.pagina(1).filas.map(f => f.numeroContrato), incluidos.slice(0, 25))
  assert.deepEqual(lote.pagina(2).filas.map(f => f.numeroContrato), incluidos.slice(25))
  assert.equal(lote.pagina(2).paginas, 2)
  assert.equal(lote.pagina(2).total, 26)
  assert.equal(lote.pagina(2).excluidos, 4)
  assert.ok([...llamadas.values()].every(n => n === 3))
  assert.equal(lote.pagina(2).procesados, 30)
})

test('Un fallo de lectura produce un resultado controlado que permite actualizar', async () => {
  const lote = new Lote()
  await lote.ejecutar(async () => { throw new Error('detalle privado') }, servicios, config)
  assert.equal(lote.pagina(1).estado, 'fallida')
  assert.equal(lote.pagina(1).total, null)
  assert.doesNotMatch(JSON.stringify(lote.pagina(1)), /detalle privado/)
})

test('El piloto consulta los tres formularios solo para el último PS activo autorizado de cada cédula', async () => {
  const opciones = opcionesInova({ INOVA_API_KEY: 'prueba', INOVA_RUTA_CONTRATO_ENTIDAD: '/identification' })
  const piloto = configurarPanel({ SUPERVISOR_SCOPE: 'pilot',
    SUPERVISOR_PILOT_CONTRACTS: '["PS001","PS0010","PS002","AB001","123PS001","ps001"]' }, 'mysql')
  const formularios = new Set<string>()
  const estados = ['p81iCXmC1jZUwf_nmL3ROsdde9siZJggig4rH0rn', 'texto-sin-equivalencia']
  const leer: typeof fetch = async (input, init) => {
    assert.equal(init?.method, 'GET')
    const url = new URL(String(input))
    if (url.pathname.startsWith('/api/entities/')) {
      const id = url.pathname.split('/').at(-1)
      return Response.json({ id, identification: id === 'entidad-A' ? 'PS001' : 'PS0010' })
    }
    assert.equal(url.searchParams.get('identification'), 'PS001')
    const form_id = decodeURIComponent(url.pathname.split('/')[3])
    formularios.add(form_id)
    const segunda = url.searchParams.has('cursor')
    return Response.json({ results: [{ form_id, entity_id: segunda ? 'entidad-B' : 'entidad-A',
      date: segunda ? '2026-05-02T00:00:00Z' : '2026-05-01T00:00:00Z', estado_id: estados[Number(segunda)] }],
      next: segunda ? null : 'siguiente' })
  }
  const lote = new Lote()
  await lote.ejecutar(listarActivosDemo, { ...serviciosDemo, consultarInforme: crearConsultaInova(opciones, leer, () => {}) }, piloto)
  const { total, filas } = lote.pagina(1)
  assert.equal(total, 1)
  assert.deepEqual(filas.map(f => f.numeroContrato), ['PS001'])
  assert.deepEqual(formularios, new Set(Object.values(opciones.formularios)))
  for (const estado of Object.values(filas[0].informes)) assert.deepEqual(estado, { nombre: 'Aprobado', tono: 'aprobado' })
})

test('Un piloto con solo contratos terminados o sin el prefijo PS exacto termina con total cero', async () => {
  const piloto = configurarPanel({ SUPERVISOR_SCOPE: 'pilot', SUPERVISOR_PILOT_CONTRACTS: '["PS002","AB001","123PS001","ps001"]' }, 'mysql')
  let consultas = 0
  const lote = new Lote()
  await lote.ejecutar(listarActivosDemo, { ...serviciosDemo, async consultarInforme() { consultas++; return null } }, piloto)
  const { estado, total, filas } = lote.pagina(1)
  assert.equal(estado, 'completa')
  assert.equal(total, 0)
  assert.deepEqual(filas, [])
  assert.equal(consultas, 0)
})

test('Al cancelar un lote se descartan las filas y no se encargan más contratos', async () => {
  let continuar!: () => void
  const pausa = new Promise<void>(r => { continuar = r })
  const llamados = new Set<string>()
  const lote = new Lote()
  const fin = lote.ejecutar(listarActivosDemo, { ...serviciosDemo, async consultarInforme(_tipo, numero) {
    llamados.add(numero)
    await pausa
    return null
  } }, config)
  await new Promise<void>(r => setImmediate(r))
  assert.equal(llamados.size, 2)
  lote.cancelar()
  continuar()
  await fin
  assert.equal(llamados.size, 2)
  assert.deepEqual(lote.pagina(1).filas, [])
})
