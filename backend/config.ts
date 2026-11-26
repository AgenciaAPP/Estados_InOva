import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import type { PoolOptions } from 'mysql2/promise'
import { opcionesInova } from './inova/config.ts'

function puerto(valor: string, variable: string) {
  const numero = Number(valor)
  if (!/^\d+$/.test(valor) || !Number.isInteger(numero) || numero < 1 || numero > 65535) {
    throw new Error(`Puerto inválido en ${variable}.`)
  }
  return numero
}

function opcionesMysql(env: NodeJS.ProcessEnv): PoolOptions {
  const host = env.DB_HOST?.trim()
  const user = env.DB_USER?.trim()
  const database = env.DB_NAME?.trim()
  if (!host || !user || !database || !env.DB_PASSWORD) {
    throw new Error('MySQL requiere DB_HOST, DB_USER, DB_PASSWORD y DB_NAME.')
  }
  const espera = env.DB_CONNECT_TIMEOUT_MS ?? '15000'
  const connectTimeout = Number(espera)
  // Cero desactiva el plazo en mysql2. Node limita sus temporizadores a enteros de 32 bits con signo.
  if (!/^\d+$/.test(espera) || connectTimeout < 1 || connectTimeout > 2_147_483_647) {
    throw new Error('DB_CONNECT_TIMEOUT_MS debe ser un entero entre 1 y 2147483647 milisegundos.')
  }
  const tls = env.DB_TLS ?? 'true'
  if (!['true', 'false'].includes(tls)) throw new Error('DB_TLS debe ser true o false.')
  const modoTls = env.DB_TLS_MODE ?? 'VERIFY_IDENTITY'
  if (modoTls !== 'VERIFY_IDENTITY' && modoTls !== 'VERIFY_CA') {
    throw new Error('DB_TLS_MODE debe ser VERIFY_IDENTITY o VERIFY_CA.')
  }
  if (tls === 'false' && env.DB_TLS_MODE !== undefined) throw new Error('DB_TLS_MODE requiere DB_TLS=true.')
  if (modoTls === 'VERIFY_CA' && !env.DB_SSL_CA_FILE) throw new Error('VERIFY_CA requiere DB_SSL_CA_FILE en formato PEM.')
  if (tls === 'false' && env.DB_SSL_CA_FILE) throw new Error('DB_SSL_CA_FILE requiere DB_TLS=true.')
  const servername = env.DB_TLS_SERVERNAME?.trim() || undefined
  if (servername) {
    if (tls !== 'true') throw new Error('DB_TLS_SERVERNAME requiere DB_TLS=true.')
    const etiquetaDns = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i
    if (isIP(servername) || servername.length > 253 || !servername.split('.').every(parte => etiquetaDns.test(parte))) {
      throw new Error('DB_TLS_SERVERNAME debe ser el nombre DNS del servidor, sin puerto ni comodines.')
    }
  }
  let ca: string | undefined
  if (env.DB_SSL_CA_FILE) {
    try { ca = readFileSync(env.DB_SSL_CA_FILE, 'utf8') }
    catch { throw new Error('No se pudo leer DB_SSL_CA_FILE.') }
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('DB_SSL_CA_FILE debe contener una CA en formato PEM.')
  }
  const ssl = tls === 'true'
    ? { ca, servername, rejectUnauthorized: true, verifyIdentity: modoTls === 'VERIFY_IDENTITY', minVersion: 'TLSv1.2' }
    : undefined
  return {
    host, user, password: env.DB_PASSWORD, database,
    port: puerto(env.DB_PORT ?? '3306', 'DB_PORT'),
    ssl,
    connectionLimit: 3, maxIdle: 1, idleTimeout: 60000,
    waitForConnections: false, connectTimeout,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false,
  }
}

export function configurar(env: NodeJS.ProcessEnv) {
  const legado = env.DATA_MODE ?? 'mock'
  if (!['mock', 'real'].includes(legado)) throw new Error('DATA_MODE debe ser mock o real.')
  if (legado === 'real' && !env.CONTRACT_SOURCE) {
    throw new Error('El modo real global está deshabilitado. Selecciona CONTRACT_SOURCE explícitamente.')
  }
  const fuente = env.CONTRACT_SOURCE ?? 'mock'
  const informes = env.INOVA_SOURCE ?? 'mock'
  if (informes !== 'mock' && informes !== 'real') throw new Error('INOVA_SOURCE debe ser mock o real.')
  if (informes === 'real' && fuente !== 'mysql') throw new Error('INOVA_SOURCE=real requiere CONTRACT_SOURCE=mysql.')
  const port = puerto(env.PORT ?? '3001', 'PORT')
  if (fuente === 'mock') return { fuente, port } as const
  if (fuente === 'mysql') return { fuente, port, mysql: opcionesMysql(env), inova: informes === 'real' ? opcionesInova(env) : null } as const
  throw new Error('CONTRACT_SOURCE debe ser mock o mysql.')
}
