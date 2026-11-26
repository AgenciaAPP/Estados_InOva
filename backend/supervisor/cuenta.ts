import { readFileSync } from 'node:fs'
import { hashValido } from './argon2.ts'
export { generarHash, verificarClave } from './argon2.ts'

export const archivoHash = '.supervisor.hash'

export function cargarHash() {
  try {
    const hash = readFileSync(archivoHash, 'utf8').trim()
    if (!hashValido(hash)) throw new Error()
    return hash
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Acceso supervisor deshabilitado. Revisa el archivo de hash y la versión de Node.')
    return null
  }
}
