import express from 'express'
import { crearDemo } from '../backend/demo/app.ts'

let app: ReturnType<typeof crearDemo>
const handler = express()
handler.disable('x-powered-by')

handler.use((req, res) => {
  try {
    app ??= crearDemo(process.env)
  } catch {
    // También protege la invocación directa del handler con un entorno incompleto.
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ mensaje: 'Demostración no habilitada. Revisa la configuración privada de Preview.' }))
    return
  }
  // Algunos adaptadores entregan la URL de destino de la reescritura.
  // En ese caso recuperamos la ruta pública y conservamos la cédula o la página.
  if (req.url?.startsWith('/api/index?')) {
    const parametros = new URLSearchParams(req.url.slice('/api/index?'.length))
    const ruta = parametros.get('__ruta')
    if (ruta && /^[a-z/-]+$/.test(ruta)) {
      parametros.delete('__ruta')
      req.url = '/api/' + ruta + (parametros.size ? '?' + parametros : '')
    }
  }
  return app(req, res)
})

export default handler
