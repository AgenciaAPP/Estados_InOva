import { createPool, type PoolOptions, type RowDataPacket } from 'mysql2/promise'
import { leerResponsables, SQL_CONTRATO, type BuscarContrato } from '../services/contratos.ts'
import { comprobarControladorTls } from './soporte-tls.ts'
import { crearListadoMysql } from '../supervisor/contratos.ts'

type LeerFilas = (sql: string, parametros: string[]) => Promise<Record<string, unknown>[]>
export const LIMITE_LECTURA_MS = 6000
const columnasRequeridas = ['nitCc', 'contratista', 'numeroContrato', 'supervisor', 'apoyoSupervision', 'apoyoJuridico', 'apoyoLogistico', 'fechaActualizacion']

// DATABASE() corresponde a DB_NAME. Solo se inspeccionan metadatos del esquema elegido.
const SQL_COLUMNAS = `SELECT c.COLUMN_NAME AS columna, c.DATA_TYPE AS tipo,
  EXISTS (
    SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
    WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
      AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL
  ) AS referencia
FROM information_schema.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = 'contratos'
  AND c.COLUMN_NAME IN (${columnasRequeridas.map(() => '?').join(', ')})`

export class ErrorEsquema extends Error {}

export async function verificarEsquema(leer: LeerFilas, alVerificarPermisos?: () => void) {
  const filas = await leer(SQL_COLUMNAS, columnasRequeridas)
  const columnas = new Map(filas.map(fila => [String(fila.columna).toLowerCase(), fila]))
  for (const nombre of columnasRequeridas) {
    if (!columnas.has(nombre.toLowerCase())) {
      throw new ErrorEsquema(`Falta la columna visible contratos.${nombre}. Revisa DB_NAME y los permisos SELECT.`)
    }
  }
  const nombre = columnas.get('contratista')!
  const texto = ['char', 'varchar', 'text', 'tinytext', 'mediumtext', 'longtext']
  if (Number(nombre.referencia) !== 0 || !texto.includes(String(nombre.tipo))) {
    throw new ErrorEsquema('contratos.contratista es una referencia o tiene un tipo no textual. Confirma el origen del nombre.')
  }
  // Comprueba los permisos de columna sin recuperar datos personales.
  alVerificarPermisos?.()
  await leer(`SELECT ${columnasRequeridas.join(', ')} FROM contratos LIMIT 0`, [])
}

export function crearBuscadorMysql(leer: LeerFilas): BuscarContrato {
  return async cedula => {
    const [fila] = await leer(SQL_CONTRATO, [cedula])
    if (!fila) return null
    const valor = fila.numeroContrato
    if (valor != null && typeof valor !== 'string' && !(typeof valor === 'number' && Number.isSafeInteger(valor))) {
      throw new ErrorEsquema('Revisa el tipo de contratos.numeroContrato.')
    }
    const numeroContrato = valor == null ? null : String(valor).trim() || null
    const contratista = typeof fila.contratista === 'string' ? fila.contratista.trim() : ''
    if (numeroContrato && (!contratista || /^\d+$/.test(contratista))) {
      throw new ErrorEsquema('La fila carece de un nombre de contratista verificable.')
    }
    return { numeroContrato, contratista, ...leerResponsables(fila) }
  }
}

export function diagnosticoMysql(error: unknown) {
  if (error instanceof ErrorEsquema) return error.message
  const codigo = error && typeof error === 'object' && 'code' in error ? error.code : ''
  // mysql2 agrupa los errores del saludo TLS. Node conserva estos campos
  // cuando la cadena es válida y falla la comparación de la identidad.
  if (codigo === 'ERR_TLS_CERT_ALTNAME_INVALID' || (codigo === 'HANDSHAKE_SSL_ERROR' &&
      error && typeof error === 'object' && 'cert' in error && 'host' in error && 'reason' in error)) {
    return 'La identidad del certificado no coincide. Confirma el SAN de IP para DB_HOST o el DNS oficial para DB_TLS_SERVERNAME.'
  }
  switch (codigo) {
    case 'ER_ACCESS_DENIED_ERROR': return 'MySQL rechazó la autenticación del usuario.'
    case 'ER_BAD_DB_ERROR': return 'MySQL no reconoce DB_NAME.'
    case 'ER_DBACCESS_DENIED_ERROR':
    case 'ER_TABLEACCESS_DENIED_ERROR':
    case 'ER_COLUMNACCESS_DENIED_ERROR': return 'Revisa los permisos de lectura del usuario MySQL.'
    case 'ENOTFOUND':
    case 'ECONNREFUSED':
    case 'EHOSTUNREACH': return 'MySQL no es accesible. Revisa DB_HOST, DB_PORT y la red.'
    case 'ETIMEDOUT':
    case 'PROTOCOL_SEQUENCE_TIMEOUT': return 'Se agotó el tiempo de espera de MySQL.'
    case 'HANDSHAKE_SSL_ERROR':
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN': return 'Falló la verificación TLS. Comprueba la CA y la vigencia. Ejecuta npm run db:check para identificar la etapa y el código.'
    case 'HANDSHAKE_NO_SSL_SUPPORT': return 'El servicio MySQL no anuncia TLS. Confirma el endpoint seguro con el administrador.'
    case 'EACCES': return 'El entorno denegó la conexión TCP a MySQL. No se pudo comprobar el certificado.'
    default: return 'Falló la lectura MySQL. Revisa la conexión, TLS y la disponibilidad del pool.'
  }
}

export function abrirMysql(opciones: PoolOptions) {
  if (opciones.ssl) comprobarControladorTls()
  const pool = createPool(opciones)
  const leer: LeerFilas = async (sql, parametros) => {
    const [filas] = await pool.execute<RowDataPacket[]>({ sql, timeout: LIMITE_LECTURA_MS }, parametros)
    return filas
  }
  return {
    buscarContrato: crearBuscadorMysql(leer),
    listarActivos: crearListadoMysql(leer),
    verificar: () => verificarEsquema(leer),
    cerrar: () => pool.end(),
  }
}
