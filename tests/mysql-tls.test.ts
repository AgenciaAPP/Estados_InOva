import assert from 'node:assert/strict'
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { test } from 'node:test'
import { createSecureContext, createServer as crearServidorTls } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createPool } from 'mysql2/promise'
import { configurar } from '../backend/config.ts'
import { comprobarControladorTls } from '../backend/mysql/soporte-tls.ts'
import { diagnosticoMysql } from '../backend/mysql/contratos.ts'
import { diagnosticoDelCheck, identidadDelCheck } from '../backend/mysql/diagnostico-check.ts'

const rutaCert = fileURLToPath(new URL('./fixtures/mysql-loopback.crt', import.meta.url))
const cert = readFileSync(rutaCert)
const rutaCa = fileURLToPath(new URL('./fixtures/mysql-ca.crt', import.meta.url))
const ca = readFileSync(rutaCa)
const firmado = readFileSync(new URL('./fixtures/mysql-firmado.crt', import.meta.url))
const vencido = readFileSync(new URL('./fixtures/mysql-vencido.crt', import.meta.url))
// Mismo certificado y misma CA de prueba, con una firma que ya no es válida.
const der = new X509Certificate(firmado).raw
der[der.length - 1] ^= 1
const firmaInvalida = new X509Certificate(der).toString()
// Material público de prueba: escalar P-256 igual a 1. Nunca se instala en el sistema.
const escalar = Buffer.alloc(32)
escalar[31] = 1
const jwk = new X509Certificate(cert).publicKey.export({ format: 'jwk' })
const key = createPrivateKey({ format: 'jwk', key: { ...jwk, d: escalar.toString('base64url') } })
  .export({ format: 'pem', type: 'pkcs8' })
// Saludo MySQL v10 con CLIENT_SSL. El servidor de prueba termina tras el login ficticio.
const saludo = Buffer.from(
  '4e0000000a382e302e302d746573740001000000414141414141414100018a2d020008001500000000000000000000' +
  '424242424242424242424242006d7973716c5f6e61746976655f70617373776f726400', 'hex')
const loginOk = Buffer.from('0700000300000002000000', 'hex')

function ofrecerTls(socket: Socket, empezar: () => void) {
  socket.write(saludo)
  function leerSolicitud() {
    const solicitud = socket.read(36) as Buffer | null
    if (!solicitud) return
    assert.equal(solicitud.readUIntLE(0, 3), 32)
    assert.equal(solicitud[3], 1)
    assert.ok(solicitud.readUInt32LE(4) & 0x0800) // CLIENT_SSL
    socket.off('readable', leerSolicitud)
    empezar()
  }
  socket.on('readable', leerSolicitud)
}

const casos = [
  { titulo: 'IP en SAN', host: '127.0.0.2', dns: '', cert, ca: rutaCert },
  { titulo: 'DNS y SNI sobre IP', host: '127.0.0.1', dns: 'sql.example.invalid', cert, ca: rutaCert },
  { titulo: 'IP ausente del SAN aunque el certificado incluya localhost', host: '127.0.0.1', dns: '', cert, ca: rutaCert, fallo: 'ERR_TLS_CERT_ALTNAME_INVALID' },
  { titulo: 'DNS distinto al certificado', host: '127.0.0.2', dns: 'otro.example.invalid', cert, ca: rutaCert, fallo: 'ERR_TLS_CERT_ALTNAME_INVALID' },
  { titulo: 'certificado autofirmado', host: '127.0.0.2', dns: '', cert, ca: '', fallo: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
  { titulo: 'emisor ausente', host: '127.0.0.2', dns: '', cert: firmado, ca: '', fallo: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
  { titulo: 'raíz presentada sin confianza local', host: '127.0.0.2', dns: '', cert: Buffer.concat([firmado, ca]), ca: '', fallo: 'SELF_SIGNED_CERT_IN_CHAIN' },
  { titulo: 'certificado vencido', host: '127.0.0.2', dns: '', cert: vencido, ca: rutaCa, fallo: 'CERT_HAS_EXPIRED' },
  { titulo: 'VERIFY_CA acepta la CA configurada con una IP ausente del SAN', modo: 'VERIFY_CA', host: '127.0.0.1', dns: '', cert: firmado, ca: rutaCa },
  { titulo: 'VERIFY_IDENTITY rechaza la misma cadena para la IP ausente del SAN', modo: 'VERIFY_IDENTITY', host: '127.0.0.1', dns: '', cert: firmado, ca: rutaCa, fallo: 'ERR_TLS_CERT_ALTNAME_INVALID' },
  { titulo: 'VERIFY_CA rechaza una raíz desconocida', modo: 'VERIFY_CA', host: '127.0.0.1', dns: '', cert: Buffer.concat([firmado, ca]), ca: rutaCert, fallo: 'SELF_SIGNED_CERT_IN_CHAIN' },
  { titulo: 'VERIFY_CA rechaza una firma inválida con la CA correcta', modo: 'VERIFY_CA', host: '127.0.0.1', dns: '', cert: firmaInvalida, ca: rutaCa, fallo: 'CERT_SIGNATURE_FAILURE' },
  { titulo: 'VERIFY_CA rechaza un certificado vencido', modo: 'VERIFY_CA', host: '127.0.0.1', dns: '', cert: vencido, ca: rutaCa, fallo: 'CERT_HAS_EXPIRED' },
]
for (const caso of casos) {
  test('TLS MySQL · ' + caso.titulo, { timeout: 8000 }, async () => {
    comprobarControladorTls()
    let sni = ''
    let recibioLogin = false
    const contexto = createSecureContext({ cert: caso.cert, key })
    const tls = crearServidorTls({ cert: caso.cert, key, SNICallback(nombre, cb) { sni = nombre; cb(null, contexto) } }, cliente => {
      cliente.once('data', () => { recibioLogin = true; cliente.write(loginOk) })
    })
    const sockets = new Set<Socket>()
    const tcp = createServer(socket => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      ofrecerTls(socket, () => tls.emit('connection', socket))
    }).listen(0, caso.host)
    await once(tcp, 'listening')
    const entorno = {
      CONTRACT_SOURCE: 'mysql', INOVA_SOURCE: 'mock', DB_HOST: caso.host, DB_PORT: String((tcp.address() as AddressInfo).port),
      DB_USER: 'prueba', DB_PASSWORD: 'ficticia', DB_NAME: 'prueba', DB_TLS: 'true',
      DB_TLS_MODE: caso.modo, DB_TLS_SERVERNAME: caso.dns, DB_SSL_CA_FILE: caso.ca,
    }
    const cfg = configurar(entorno)
    assert.ok(cfg.fuente === 'mysql')
    const pool = createPool(cfg.mysql)
    try {
      if (!caso.fallo) (await pool.getConnection()).release()
      else await assert.rejects(pool.getConnection(), error => {
        assert.ok(error instanceof Error && 'code' in error && error.code === 'HANDSHAKE_SSL_ERROR')
        const esIdentidad = caso.fallo === 'ERR_TLS_CERT_ALTNAME_INVALID'
        assert.match(diagnosticoMysql(error), esIdentidad ? /identidad del certificado/ : /Comprueba la CA/)
        const detalle = diagnosticoDelCheck(error, identidadDelCheck(cfg.mysql))
        assert.ok(detalle.includes('[Node ' + caso.fallo + ']'))
        if (esIdentidad) assert.match(detalle, caso.dns ? /El DNS/ : /La IP/)
        assert.doesNotMatch(detalle, /127\.0\.0\.|example\.invalid|BEGIN CERTIFICATE/)
        return true
      })
      if (caso.fallo && (caso.modo === 'VERIFY_CA' || caso.fallo === 'CERT_HAS_EXPIRED' || caso.fallo === 'ERR_TLS_CERT_ALTNAME_INVALID')) {
        // Misma entrada de db:check con configuración sintética y sin cargar .env.
        await assert.rejects(promisify(execFile)(process.execPath, ['backend/index.ts', '--comprobar-mysql'], {
          env: { ...process.env, ...entorno }, timeout: 4000,
        }), error => {
          assert.ok(error instanceof Error && 'stderr' in error && typeof error.stderr === 'string')
          assert.ok(error.stderr.includes(`[MySQL2 HANDSHAKE_SSL_ERROR] [Node ${caso.fallo}]`))
          assert.match(error.stderr, /Etapa: verificación del certificado/)
          assert.ok('stdout' in error && typeof error.stdout === 'string')
          assert.ok(error.stdout.includes(caso.modo ?? 'VERIFY_IDENTITY'))
          assert.doesNotMatch(error.stdout, /En curso: autenticación MySQL/)
          assert.doesNotMatch(error.stderr, /ficticia|127\.0\.0\.|BEGIN CERTIFICATE/)
          return true
        })
      }
      assert.equal(recibioLogin, !caso.fallo)
      assert.equal(sni, caso.dns)
    } finally {
      for (const socket of sockets) socket.destroy()
      await pool.end()
      await new Promise<void>(resolve => tcp.close(() => resolve()))
    }
  })
}

test('db:check localiza esperas en la misma sesión y libera el socket al vencer el plazo', { concurrency: true }, async t => {
  const casosEspera = [
    ['saludo', 'saludo MySQL completo', 'ETIMEDOUT'],
    ['tls', 'negociación TLS después del SSLRequest', 'ETIMEDOUT'],
    ['login', 'autenticación MySQL', 'ETIMEDOUT'],
    ['lectura', 'estructura de contratos', 'PROTOCOL_SEQUENCE_TIMEOUT'],
  ]
  await Promise.all(casosEspera.map(([pausa, etapa, codigo]) => t.test(etapa, { timeout: 20000 }, async () => {
    let recibioLogin = false
    let recibioPrepare = false
    const soloCa = pausa === 'lectura'
    const host = soloCa ? '127.0.0.1' : '127.0.0.2'
    const tls = crearServidorTls({ cert: soloCa ? firmado : cert, key }, cliente => {
      cliente.once('data', () => {
        recibioLogin = true
        if (pausa === 'lectura') {
          cliente.write(loginOk)
          cliente.once('data', paquete => { recibioPrepare = paquete[4] === 0x16 })
        }
      })
    })
    const sockets = new Set<Socket>()
    const tcp = createServer(socket => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      if (pausa === 'saludo') socket.write(saludo.subarray(0, 8))
      else if (pausa === 'lectura') {
        // Reproduce un saludo que llega después del anterior límite de 5 s.
        const retraso = setTimeout(() => ofrecerTls(socket, () => tls.emit('connection', socket)), 5200)
        socket.once('close', () => clearTimeout(retraso))
      }
      else ofrecerTls(socket, () => {
        if (pausa !== 'tls') tls.emit('connection', socket)
        else socket.resume()
      })
    }).listen(0, host)
    await once(tcp, 'listening')
    try {
      const env = {
        ...process.env, CONTRACT_SOURCE: 'mysql', INOVA_SOURCE: 'mock', DB_HOST: host,
        DB_USER: 'usuario-sintetico', DB_PASSWORD: 'clave-sintetica', DB_NAME: 'base-sintetica',
        DB_PORT: String((tcp.address() as AddressInfo).port), DB_TLS: 'true', DB_TLS_SERVERNAME: '',
        DB_TLS_MODE: soloCa ? 'VERIFY_CA' : 'VERIFY_IDENTITY', DB_SSL_CA_FILE: soloCa ? rutaCa : rutaCert,
        DB_CONNECT_TIMEOUT_MS: pausa === 'lectura' ? '15000' : '2000',
      }
      await assert.rejects(promisify(execFile)(process.execPath, ['backend/index.ts', '--comprobar-mysql'], { env, timeout: 18000 }), error => {
        assert.ok(error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string')
        assert.ok('code' in error && error.code === 1)
        assert.ok(error.stderr.includes('Etapa: ' + etapa + '.') && error.stderr.includes('[' + codigo + ']'))
        assert.ok('stdout' in error && typeof error.stdout === 'string')
        assert.match(error.stdout, /TCP conectado.*\n.*Primeros bytes/)
        assert.ok(error.stdout.includes(`hasta la autenticación: ${env.DB_CONNECT_TIMEOUT_MS} ms. Límite por lectura: 6000 ms.`))
        assert.equal(error.stdout.includes('Autenticación aceptada'), pausa === 'lectura')
        assert.equal(error.stdout.includes('TLS e identidad verificados'), pausa === 'login')
        assert.equal(error.stdout.includes('Cadena de CA y vigencia verificadas · En curso: autenticación MySQL'), soloCa)
        assert.doesNotMatch(error.stdout + error.stderr, /usuario-sintetico|clave-sintetica|base-sintetica|127\.0\.0\.2|BEGIN CERTIFICATE/)
        return true
      })
      assert.equal(recibioLogin, pausa === 'login' || pausa === 'lectura')
      assert.equal(recibioPrepare, pausa === 'lectura')
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => tcp.close(() => resolve()))
    }
  })))
})
