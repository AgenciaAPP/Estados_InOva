import { connect, type Socket } from 'node:net'
import { createPool, type PoolConnection, type PoolOptions, type RowDataPacket } from 'mysql2/promise'
import { LIMITE_LECTURA_MS, verificarEsquema } from './contratos.ts'
import { diagnosticoDelCheck, identidadDelCheck } from './diagnostico-check.ts'
import { comprobarControladorTls } from './soporte-tls.ts'

const etapas = {
  tcp: 'conexión TCP',
  saludo: 'saludo MySQL completo',
  tls: 'negociación TLS después del SSLRequest',
  certificado: 'verificación del certificado',
  autenticacion: 'autenticación MySQL',
  estructura: 'estructura de contratos',
  permisos: 'permisos SELECT (LIMIT 0)',
}
type Etapa = keyof typeof etapas

// execute() prepara la sentencia antes de iniciar su timeout de ejecución.
// Este plazo del CLI comprende ambas fases; al vencer se cierra el transporte.
async function leerConPlazo(conexion: PoolConnection, sql: string, parametros: string[]) {
  let timer: NodeJS.Timeout | undefined
  const plazo = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' })), LIMITE_LECTURA_MS)
  })
  try {
    const [filas] = await Promise.race([conexion.execute<RowDataPacket[]>(sql, parametros), plazo])
    return filas
  } finally { clearTimeout(timer) }
}

export async function comprobarMysqlPorEtapas(opciones: PoolOptions) {
  const ssl = opciones.ssl
  if (!ssl || typeof ssl !== 'object' || ssl.rejectUnauthorized !== true || typeof ssl.verifyIdentity !== 'boolean') {
    throw new Error('db:check requiere TLS con verificación de confianza y un modo TLS válido.')
  }
  if (!ssl.verifyIdentity && !ssl.ca) throw new Error('VERIFY_CA requiere una CA configurada en DB_SSL_CA_FILE.')
  comprobarControladorTls('diagnosticar')
  const identidad = identidadDelCheck(opciones)
  const politica = ssl.verifyIdentity ? `VERIFY_IDENTITY (cadena e identidad por ${identidad})` : 'VERIFY_CA (cadena y vigencia, sin cotejar IP/DNS)'
  const tlsVerificado = ssl.verifyIdentity ? 'TLS e identidad verificados' : 'Cadena de CA y vigencia verificadas'
  const inicio = performance.now()
  let etapa: Etapa = 'tcp'
  let desde = inicio
  const informar = (texto: string) => console.log(`[db:check +${Math.round(performance.now() - inicio)} ms] ${texto}`)
  function avanzar(siguiente: Etapa, evidencia: string) {
    etapa = siguiente
    desde = performance.now()
    informar(`${evidencia} · En curso: ${etapas[etapa]}.`)
  }

  function informarTls(paso: 'tls' | 'certificado' | 'autenticacion') {
    const hitos = {
      tls: 'Saludo interpretado y SSLRequest escrito en el socket',
      certificado: `Cadena aceptada por Node. Comprobando identidad por ${identidad}`,
      autenticacion: tlsVerificado,
    }
    avanzar(paso, hitos[paso])
  }
  const sslConEtapas = { ...ssl, inovaEtapa: informarTls }
  let socket: Socket | undefined
  const pool = createPool({
    ...opciones, ssl: sslConEtapas,
    stream() {
      socket = connect({
        host: opciones.host, port: opciones.port ?? 3306, noDelay: true,
        keepAlive: opciones.enableKeepAlive !== false, keepAliveInitialDelay: opciones.keepAliveInitialDelay,
      })
      socket.once('connect', () => avanzar('saludo', 'TCP conectado'))
      socket.once('data', () => informar('Primeros bytes recibidos del servidor.'))
      return socket
    },
  })
  let conexion: PoolConnection | undefined
  let completada = false
  try {
    informar(`${politica}. En curso: conexión TCP. Límite compartido hasta la autenticación: ${opciones.connectTimeout} ms. Límite por lectura: ${LIMITE_LECTURA_MS} ms.`)
    const sesion = await pool.getConnection()
    conexion = sesion
    avanzar('estructura', 'Autenticación aceptada')
    await verificarEsquema((sql, parametros) => leerConPlazo(sesion, sql, parametros),
      () => avanzar('permisos', 'Estructura verificada'))
    completada = true
    informar('OK · Permisos de lectura verificados. Comprobación terminada.')
  } catch (error) {
    // OpenSSL puede rechazar la cadena antes de invocar checkServerIdentity.
    const falloCadena = error && typeof error === 'object' && 'nodeTlsCode' in error &&
      typeof error.nodeTlsCode === 'string' && /^(CERT_|UNABLE_TO_(GET_ISSUER|VERIFY_LEAF)|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT)/.test(error.nodeTlsCode)
    const fin = performance.now()
    const fallo = falloCadena ? etapas.certificado : etapas[etapa]
    throw new Error(`[db:check FALLO] Etapa: ${fallo}. Total: ${Math.round(fin - inicio)} ms. ${Math.round(fin - desde)} ms desde el inicio de ${etapas[etapa]}. ${diagnosticoDelCheck(error, identidad)}`)
  } finally {
    if (completada) conexion?.release()
    else {
      conexion?.destroy()
      socket?.destroy()
    }
    try { await pool.end() }
    finally { socket?.destroy() }
  }
}
