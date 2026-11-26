import * as crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

export const archivoHash = '.supervisor.hash'
const formato = /^argon2id-v19-m65536-t3-p1:([\da-f]{32}):([\da-f]{64})$/

function derivar(clave: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.argon2('argon2id', {
    message: clave, nonce: sal, memory: 65536, passes: 3, parallelism: 1, tagLength: 32,
  }, (error, hash) => error ? reject(error) : resolve(hash)))
}

export async function generarHash(clave: string) {
  if (typeof crypto.argon2 !== 'function') throw new Error('Para preparar la cuenta usa Node 24.7 o posterior con Argon2id.')
  if (clave.length < 16 || !clave.trim() || Buffer.byteLength(clave) > 256) throw new Error('Usa una contraseña robusta de al menos 16 caracteres y hasta 256 bytes.')
  const sal = crypto.randomBytes(16)
  const hash = await derivar(clave, sal)
  return 'argon2id-v19-m65536-t3-p1:' + sal.toString('hex') + ':' + hash.toString('hex')
}

export async function verificarClave(clave: string, hash: string) {
  const partes = formato.exec(hash)
  if (!partes) return false
  return crypto.timingSafeEqual(await derivar(clave, Buffer.from(partes[1], 'hex')), Buffer.from(partes[2], 'hex'))
}

export function cargarHash() {
  try {
    const hash = readFileSync(archivoHash, 'utf8').trim()
    if (!formato.test(hash) || typeof crypto.argon2 !== 'function') throw new Error()
    return hash
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Acceso supervisor deshabilitado. Revisa el archivo de hash y la versión de Node.')
    return null
  }
}
