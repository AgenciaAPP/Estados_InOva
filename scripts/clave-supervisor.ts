import { writeFile } from 'node:fs/promises'
import { archivoHash, generarHash } from '../backend/supervisor/cuenta.ts'

async function preparar() {
  if (process.stdin.isTTY) throw new Error('Utiliza la entrada oculta de PowerShell indicada en el README.')
  let entrada = ''
  process.stdin.setEncoding('utf8')
  for await (const fragmento of process.stdin) {
    entrada += fragmento
    if (Buffer.byteLength(entrada) > 258) throw new Error('La contraseña supera el límite de 256 bytes.')
  }
  const clave = entrada.replace(/\r?\n$/, '')
  if (/[\r\n]/.test(clave)) throw new Error('Introduce una sola contraseña.')
  const hash = await generarHash(clave)
  await writeFile(archivoHash, hash + '\n', { mode: 0o600, flag: 'wx' })
  console.log('Hash de supervisor creado. Reinicia el backend.')
}
preparar().catch(error => {
  console.error(error.code === 'EEXIST' ? 'El archivo de hash ya existe. Consulta la rotación en el README.' :
    error.code ? 'No se pudo preparar el archivo de hash.' : error.message)
  process.exitCode = 1
})
