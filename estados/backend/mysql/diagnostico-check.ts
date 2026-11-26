import { isIP } from 'node:net'
import type { PoolOptions } from 'mysql2/promise'
import { ErrorEsquema } from './contratos.ts'

// Solo db:check usa estos textos. Los mensajes del servidor pueden incluir
// nombres de cuentas, consultas y detalles del certificado.
const descripciones = new Map<string, string>([
  ['CERT_SIGNATURE_FAILURE', 'La firma de un certificado de la cadena es inválida. Confirma la cadena presentada y el PEM con el administrador.'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'Node no pudo verificar la firma del certificado del servidor. Comprueba si el servidor entrega los intermedios y si la CA emisora es de confianza.'],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'Falta un emisor para completar la cadena de confianza local. Revisa la cadena presentada y la CA institucional en DB_SSL_CA_FILE.'],
  ['UNABLE_TO_GET_ISSUER_CERT', 'No se encontró el certificado emisor necesario para completar la cadena. Comprueba los certificados intermedios y la CA.'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'La cadena contiene un certificado autofirmado que Node no reconoce como ancla de confianza. Solicita la CA institucional en PEM.'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'El certificado presentado por el servidor es autofirmado y no figura entre los certificados de confianza. Confirma su emisor y el material de confianza autorizado.'],
  ['CERT_HAS_EXPIRED', 'Ha vencido un certificado de la cadena según el reloj del cliente. Comprueba la hora del equipo y la vigencia de la cadena con el administrador.'],
  ['CERT_NOT_YET_VALID', 'Un certificado de la cadena aún no es válido según el reloj del cliente. Comprueba la hora del equipo y la fecha de inicio de vigencia.'],
  ['HANDSHAKE_SSL_ERROR', 'Falló la negociación TLS. El controlador no entregó un código de Node que permita precisar la causa.'],
  ['HANDSHAKE_NO_SSL_SUPPORT', 'El servicio en el puerto configurado no anuncia soporte TLS para MySQL. Confirma el endpoint seguro.'],
  ['EACCES', 'El entorno denegó el acceso de red. No se pudo verificar el certificado desde este equipo.'],
  ['ENOTFOUND', 'No se pudo resolver el destino TCP de DB_HOST.'],
  ['EAI_AGAIN', 'La resolución DNS del destino TCP falló temporalmente.'],
  ['ECONNREFUSED', 'El destino rechazó la conexión TCP. Comprueba el servicio y el puerto.'],
  ['ENETUNREACH', 'La red del destino no es accesible desde el cliente.'],
  ['EHOSTUNREACH', 'El cliente no dispone de una ruta al servidor.'],
  ['ETIMEDOUT', 'Se agotó el tiempo de espera de la conexión.'],
  ['ECONNRESET', 'La conexión se interrumpió. Este código por sí solo no identifica un problema de certificado.'],
  ['PROTOCOL_SEQUENCE_TIMEOUT', 'Se agotó el tiempo de espera de la operación MySQL.'],
  ['PROTOCOL_CONNECTION_LOST', 'El servidor cerró la conexión MySQL.'],
  ['ER_ACCESS_DENIED_ERROR', 'MySQL rechazó la autenticación. Revisa la cuenta y el origen de conexión autorizado.'],
  ['ER_NOT_SUPPORTED_AUTH_MODE', 'MySQL solicita un mecanismo de autenticación incompatible con el cliente.'],
  ['ER_BAD_DB_ERROR', 'MySQL no reconoce la base indicada en DB_NAME.'],
  ['ER_DBACCESS_DENIED_ERROR', 'MySQL denegó el acceso a la base de datos.'],
  ['ER_TABLEACCESS_DENIED_ERROR', 'MySQL denegó la lectura de la tabla.'],
  ['ER_COLUMNACCESS_DENIED_ERROR', 'MySQL denegó la lectura de una columna.'],
])

export function identidadDelCheck(opciones: PoolOptions): 'IP' | 'DNS' {
  const ssl = opciones.ssl
  if (ssl && typeof ssl === 'object' && 'servername' in ssl && ssl.servername) return 'DNS'
  return isIP(opciones.host ?? '') ? 'IP' : 'DNS'
}

function codigoSeguro(valor: unknown): string | undefined {
  return typeof valor === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(valor) ? valor : undefined
}

export function diagnosticoDelCheck(error: unknown, identidad: 'IP' | 'DNS') {
  if (error instanceof ErrorEsquema) return `[Esquema] ${error.message}`
  if (!error || typeof error !== 'object') return 'MySQL no proporcionó un código de error.'
  const codigo = 'code' in error ? codigoSeguro(error.code) : undefined
  if (!codigo) return 'MySQL no proporcionó un código de error identificable.'
  const nativo = codigo === 'HANDSHAKE_SSL_ERROR' && 'nodeTlsCode' in error ? codigoSeguro(error.nodeTlsCode) : undefined
  const causa = nativo ?? codigo
  const etiqueta = nativo ? `[MySQL2 ${codigo}] [Node ${nativo}]` : `[${codigo}]`
  if (causa === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    const detalle = identidad === 'IP'
      ? 'La IP de DB_HOST no coincide con una entrada IP Address del SAN. Confirma la IP certificada o el DNS oficial para DB_TLS_SERVERNAME.'
      : 'El DNS usado para verificar la identidad no coincide con el certificado presentado. Confirma el DNS oficial del servicio.'
    return `${etiqueta} ${detalle}`
  }
  return `${etiqueta} ${descripciones.get(causa) ?? 'El controlador devolvió este código sin una interpretación específica en db:check.'}`
}
