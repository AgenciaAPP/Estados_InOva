import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// mysql2 3.24.6 omite host en tls.connect({ socket }) y deriva SNI del
// destino TCP. Con una IP literal Node puede terminar verificando "localhost".
// El ajuste está limitado a esta versión; se debe revisar al actualizarla.
const cargar = createRequire(import.meta.url)
const original = 'b22610ef653a8c2e4e6395aa5fdfa78bd150a631fc8029e49e2d165f83d0ccb7'
const corregida = 'cf22610fa1b1853f4f1f5bc790d0927cfe5e7800046157288dcd46e09eb8f674'
const conDiagnostico = '6a69d7bff05fb27efdf528fc39f903abbf7fd3357bc6fd1688d8aa2b4286cdca'
const conEtapas = 'e80a6bc0c95dc6b63c4e610fdf83df0086cdaf0d39b67109fb6a682d0750441f'
const cambios = [
  [
    'const servername = Net.isIP(this.config.host)\n      ? undefined\n      : this.config.host;',
    'const identity = this.config.ssl.servername ?? this.config.host;\n    const servername = Net.isIP(identity) ? undefined : identity;',
  ],
  [
    'this.config.ssl,\n      this.config.host,\n      this.config.port,',
    'this.config.ssl,\n      JSON.stringify([this.config.host, identity]),\n      this.config.port,',
  ],
  ['socket: this.stream,\n        servername,', 'socket: this.stream,\n        host: identity,\n        servername,'],
] as const

function huella(fuente: string) {
  return createHash('sha256').update(fuente).digest('hex')
}

export function comprobarControladorTls(modo: 'verificar' | 'instalar' | 'diagnosticar' = 'verificar') {
  const ruta = join(dirname(cargar.resolve('mysql2/package.json')), 'lib/base/connection.js')
  const fuente = readFileSync(ruta, 'utf8').replaceAll('\r\n', '\n')
  const actual = huella(fuente)
  if (actual === conEtapas || (modo === 'verificar' && [corregida, conDiagnostico].includes(actual))) return
  if (![original, corregida, conDiagnostico].includes(actual) || cargar('mysql2/package.json').version !== '3.24.6') {
    throw new Error('Versión de mysql2 sin verificar. Revisa la compatibilidad TLS antes de conectar.')
  }
  if (modo !== 'instalar') throw new Error('Falta el ajuste TLS de mysql2. Ejecuta npm run postinstall y reinicia el backend.')
  let ajustada = fuente
  if (actual === original) {
    for (const [antes, despues] of cambios) ajustada = ajustada.replace(antes, despues)
  }
  // client_handshake sobrescribe err.code al recibir onSecure(error).
  // Conservamos solo el identificador original, sin copiar el certificado ni el mensaje.
  if (actual !== conDiagnostico) {
    if (huella(ajustada) !== corregida) throw new Error('No se pudo preparar el controlador TLS verificado.')
    ajustada = ajustada
      .replace('onSecure(serverIdentityCheckError);', 'serverIdentityCheckError.nodeTlsCode = serverIdentityCheckError.code;\n              onSecure(serverIdentityCheckError);')
      .replace('        onSecure(err);', '        err.nodeTlsCode = err.code;\n        onSecure(err);')
  }
  if (huella(ajustada) !== conDiagnostico) throw new Error('No se pudo verificar el ajuste de diagnóstico TLS.')
  // Observación opcional del mismo saludo, sin alterar el resultado del verificador de Node.
  ajustada = ajustada
    .replace('    const secureContext = getSecureContext(this.config.ssl);', `    const etapa = this.config.ssl.inovaEtapa;
    etapa?.('tls');
    const comprobarIdentidad = etapa
      ? (host, cert) => {
          etapa('certificado');
          return Tls.checkServerIdentity(host, cert);
        }
      : Tls.checkServerIdentity;
    const secureContext = getSecureContext(this.config.ssl);`)
    .replace('checkServerIdentity: verifyIdentity\n          ? Tls.checkServerIdentity', 'checkServerIdentity: verifyIdentity\n          ? comprobarIdentidad')
    .replace('        onSecure();', "        etapa?.('autenticacion');\n        onSecure();")
  if (huella(ajustada) !== conEtapas) throw new Error('No se pudo verificar la instrumentación por etapas.')
  writeFileSync(ruta, ajustada, 'utf8')
}
