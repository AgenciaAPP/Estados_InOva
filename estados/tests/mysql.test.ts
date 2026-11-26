import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { test } from 'node:test'
import { configurar } from '../backend/config.ts'
import { abrirMysql, crearBuscadorMysql, diagnosticoMysql, verificarEsquema } from '../backend/mysql/contratos.ts'
import { leerPaginaParaContratoMysql } from '../backend/mock/adaptadores.ts'
import { crearApp, serviciosDemo } from '../backend/app.ts'
import { SQL_CONTRATO } from '../backend/services/contratos.ts'
import { diagnosticoDelCheck } from '../backend/mysql/diagnostico-check.ts'

const entornoPrueba = {
  CONTRACT_SOURCE: 'mysql', INOVA_SOURCE: 'mock', DB_HOST: 'servidor.invalid',
  DB_USER: 'prueba', DB_PASSWORD: 'ficticia', DB_NAME: 'esquema_ficticio',
}
const columnas = [
  { columna: 'nitCc', tipo: 'varchar', referencia: 0 },
  { columna: 'numeroContrato', tipo: 'varchar', referencia: 0 },
  { columna: 'fechaActualizacion', tipo: 'datetime', referencia: 0 },
  { columna: 'contratista', tipo: 'varchar', referencia: 0 },
  { columna: 'supervisor', tipo: 'varchar', referencia: 0 },
  { columna: 'apoyoSupervision', tipo: 'varchar', referencia: 0 },
  { columna: 'apoyoJuridico', tipo: 'varchar', referencia: 0 },
  { columna: 'apoyoLogistico', tipo: 'varchar', referencia: 0 },
]

test('db:check diferencia red, autenticación y permisos sin copiar detalles privados', () => {
  for (const [code, texto] of [
    ['EACCES', 'acceso de red'], ['ECONNREFUSED', 'conexión TCP'], ['ETIMEDOUT', 'tiempo de espera'],
    ['ER_ACCESS_DENIED_ERROR', 'autenticación'], ['ER_DBACCESS_DENIED_ERROR', 'acceso a la base'],
  ]) {
    const mensaje = diagnosticoDelCheck({ code, message: 'secreto-prueba', cert: 'secreto-prueba' }, 'IP')
    assert.ok(mensaje.includes('[' + code + ']') && mensaje.includes(texto))
    assert.doesNotMatch(mensaje, /secreto-prueba/)
  }
})

test('Las fuentes son independientes y TLS comprueba certificado e identidad por defecto', () => {
  const cfg = configurar({ ...entornoPrueba, DATA_MODE: 'real' })
  assert.ok(cfg.fuente === 'mysql')
  assert.equal(cfg.mysql.database, 'esquema_ficticio')
  assert.equal(cfg.mysql.port, 3306)
  assert.ok(typeof cfg.mysql.ssl === 'object')
  assert.equal(cfg.mysql.ssl.rejectUnauthorized, true)
  assert.equal(cfg.mysql.ssl.verifyIdentity, true)
  assert.equal(configurar({ DB_HOST: 'configurado' }).fuente, 'mock')
  assert.throws(() => configurar({ ...entornoPrueba, INOVA_SOURCE: 'real' }), /INOVA_SOURCE/)
  assert.throws(() => configurar({ CONTRACT_SOURCE: 'mysql' }), /DB_HOST/)
  assert.throws(() => configurar({ ...entornoPrueba, DB_NAME: '' }), /DB_NAME/)
  assert.throws(() => configurar({ ...entornoPrueba, DB_PORT: '65536' }), /DB_PORT/)
  assert.throws(() => configurar({ ...entornoPrueba, DB_TLS: 'typo' }), /DB_TLS/)
  assert.throws(() => configurar({ ...entornoPrueba, DB_TLS: 'false', DB_TLS_SERVERNAME: 'sql.test' }), /DB_TLS_SERVERNAME/)
  assert.throws(() => configurar({ ...entornoPrueba, DB_TLS_SERVERNAME: '*.test' }), /DB_TLS_SERVERNAME/)
  assert.throws(() => configurar({ ...entornoPrueba, DB_SSL_CA_FILE: 'no-existe.pem' }), /CA_FILE/)
})

test('VERIFY_CA exige TLS y una CA explícita. Un modo desconocido falla al configurar MySQL', () => {
  assert.throws(() => configurar({ ...entornoPrueba, DB_TLS_MODE: 'VERIFY_CA' }), /DB_SSL_CA_FILE/)
  assert.throws(() => configurar({ ...entornoPrueba, DB_TLS_MODE: 'VERIFY_CA', DB_TLS: 'false' }), /requiere DB_TLS=true/)
  for (const valor of ['', 'PREFERRED', 'VERIFY_CA ']) {
    assert.throws(() => configurar({ ...entornoPrueba, DB_TLS_MODE: valor }), /DB_TLS_MODE/)
  }
})

test('El plazo compartido de MySQL vale 15 s por defecto y solo acepta milisegundos válidos', () => {
  const porDefecto = configurar(entornoPrueba)
  assert.ok(porDefecto.fuente === 'mysql')
  assert.equal(porDefecto.mysql.connectTimeout, 15000)
  const personalizado = configurar({ ...entornoPrueba, DB_CONNECT_TIMEOUT_MS: '9000' })
  assert.ok(personalizado.fuente === 'mysql')
  assert.equal(personalizado.mysql.connectTimeout, 9000)
  for (const valor of ['', '0', '-1', '2.5', 'abc', '2147483648']) {
    assert.throws(() => configurar({ ...entornoPrueba, DB_CONNECT_TIMEOUT_MS: valor }), /DB_CONNECT_TIMEOUT_MS/)
  }
})

test('La comprobación verifica metadatos y permisos sin recuperar filas de contratos', async () => {
  const consultas: string[] = []
  let inicioPermisos = -1
  await verificarEsquema(async (sql, params) => {
    consultas.push(sql)
    if (consultas.length === 1) assert.deepEqual([...params].sort(), columnas.map(c => c.columna).sort())
    else assert.deepEqual(params, [])
    return columnas
  }, () => { inicioPermisos = consultas.length })
  assert.equal(inicioPermisos, 1)
  assert.equal(consultas.length, 2)
  assert.match(consultas[0], /FROM information_schema.COLUMNS/)
  assert.doesNotMatch(consultas[0], /FROM contratos\b/i)
  assert.match(consultas[1], /FROM contratos LIMIT 0$/)
  for (const { columna } of columnas) {
    assert.ok(consultas[1].includes(columna))
    await assert.rejects(verificarEsquema(async () => columnas.filter(c => c.columna !== columna)), new RegExp(columna))
  }
  for (const cambio of [{ tipo: 'int' }, { referencia: 1 }]) {
    await assert.rejects(verificarEsquema(async () => columnas.map(c => c.columna === 'contratista' ? { ...c, ...cambio } : c)), /origen del nombre/)
  }
})

test('El buscador distingue ausencias, conserva identificadores y evita presentar una referencia como nombre', async () => {
  assert.equal(await crearBuscadorMysql(async () => [])('0001'), null)
  for (const numeroContrato of [null, '', '  ']) {
    const fila = await crearBuscadorMysql(async () => [{ numeroContrato, contratista: null }])('0001')
    assert.equal(fila?.numeroContrato, null)
  }
  for (const contratista of [null, 8, '0008']) {
    await assert.rejects(crearBuscadorMysql(async () => [{ numeroContrato: 'FIC-009', contratista }])('0001'), /nombre/)
  }
  const fila = await crearBuscadorMysql(async () => [{ numeroContrato: '00990000000000000001', contratista: 'Persona Ficticia' }])('0001')
  assert.equal(fila?.numeroContrato, '00990000000000000001')
})

test('HTTP mixto vincula la cédula como parámetro y produce estados ficticios para un contrato ajeno al catálogo', async () => {
  const consultas: string[][] = []
  const buscarContrato = crearBuscadorMysql(async (sql, parametros) => {
    assert.equal(sql, SQL_CONTRATO)
    assert.equal(sql.replace(/\s+/g, ' '), 'SELECT nitCc, contratista, numeroContrato, supervisor, apoyoSupervision, apoyoJuridico, apoyoLogistico FROM contratos WHERE nitCc = ? ORDER BY fechaActualizacion DESC LIMIT 1;')
    consultas.push(parametros)
    return [{ numeroContrato: 'PRUEBA-FUERA-CATALOGO', contratista: 'Persona Ficticia',
      supervisor: '  Supervisora  de prueba  ', apoyoSupervision: '  ', apoyoJuridico: null, apoyoLogistico: '' }]
  })
  const api = crearApp({ ...serviciosDemo, buscarContrato, leerPagina: leerPaginaParaContratoMysql }, 'mysql')
  const server = api.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
    const url = base + '/api/consulta-informes?cedula=00091'
    const fuentes = { contratos: 'mysql', informes: 'mock' }
    assert.deepEqual(await (await fetch(base + '/api/configuracion')).json(), { demostracion: false, fuentes })
    const res = await fetch(url)
    assert.equal(res.status, 200)
    const dato = await res.json()
    assert.deepEqual(consultas, [['00091']])
    assert.equal(dato.cedula, '00091')
    assert.equal(dato.numeroContrato, 'PRUEBA-FUERA-CATALOGO')
    assert.equal(dato.contratista, 'Persona Ficticia')
    assert.equal(dato.supervisor, '  Supervisora  de prueba  ')
    assert.equal(dato.apoyoSupervision, null)
    assert.equal(dato.apoyoJuridico, null)
    assert.equal(dato.apoyoLogistico, null)
    assert.deepEqual(dato.fuentes, fuentes)
    assert.ok(dato.informes.gestion.nombre)
    assert.ok(dato.informes.supervision.nombre)
    assert.ok(dato.informes.cobro.nombre)
    assert.deepEqual(dato, await (await fetch(url)).json())
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('El controlador maneja una interrupción local sin revelar los detalles del servidor', async () => {
  // Se corta el socket antes del saludo MySQL. Ninguna credencial sale del equipo.
  const local = createServer(socket => socket.destroy()).listen(0, '127.0.0.1')
  await once(local, 'listening')
  const cfg = configurar({
    ...entornoPrueba, DB_HOST: '127.0.0.1', DB_PORT: String((local.address() as AddressInfo).port), DB_TLS: 'false',
  })
  assert.ok(cfg.fuente === 'mysql')
  const db = abrirMysql(cfg.mysql)
  try {
    await assert.rejects(db.verificar(), error => {
      assert.doesNotMatch(diagnosticoMysql(error), /fictici|127\.0\.0\.1|prueba/)
      return true
    })
    assert.equal(diagnosticoMysql({ code: 'ER_ACCESS_DENIED_ERROR', message: 'detalle sensible' }), 'MySQL rechazó la autenticación del usuario.')
  } finally {
    await db.cerrar()
    await new Promise<void>(resolve => local.close(() => resolve()))
  }
})
