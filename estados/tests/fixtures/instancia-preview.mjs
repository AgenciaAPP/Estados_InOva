import { createServer } from 'node:http'
import assert from 'node:assert/strict'

// Únicamente el transporte de Turso se redirige a la base SQLite del ensayo.
const enviar = globalThis.fetch
globalThis.fetch = (url, opciones) => {
  assert.equal(String(url), 'https://prueba.turso.io/v2/pipeline')
  return enviar(process.argv[3] + '/v2/pipeline', opciones)
}
const { default: handler } = await import(process.argv[2])
// El adaptador de Node reconoce una aplicación Express por su método listen.
assert.equal(typeof handler.listen, 'function')
const servidor = createServer((req, res) => {
  // Las dos invocaciones reciben el mismo Host público tras la terminación HTTPS.
  req.headers.host = process.env.VERCEL_URL
  handler(req, res)
}).listen(0, '127.0.0.1', () => process.send(servidor.address().port))
process.on('disconnect', () => { servidor.close(); servidor.closeAllConnections() })
