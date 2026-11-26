import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { crearApp, serviciosDemo } from './app.ts'
import { configurar } from './config.ts'
import { leerPaginaPanelDemo, listarActivosDemo } from './mock/adaptadores.ts'
import { configurarPanel } from './supervisor/config.ts'
import { cargarHash } from './supervisor/cuenta.ts'
import { rutasSupervisor } from './supervisor/rutas.ts'

// Este proceso persistente solo monta proveedores ficticios y escucha detrás del proxy HTTPS.
export function crearServidorDemo(env: NodeJS.ProcessEnv, hash: string | null) {
  if ((env.CONTRACT_SOURCE ?? 'mock') !== 'mock' || (env.INOVA_SOURCE ?? 'mock') !== 'mock' ||
      (env.DATA_MODE ?? 'mock') !== 'mock') throw new Error('El backend de demostración requiere ambos proveedores en mock.')
  const panel = configurarPanel(env, 'mock')
  if (!panel.origen) throw new Error('Configura SUPERVISOR_ORIGIN con el origen HTTPS exacto del frontend.')
  const valor = env.DEMO_ORIGIN_SECRET
  if (!valor || !/^[a-f0-9]{64}$/.test(valor)) throw new Error('Falta un DEMO_ORIGIN_SECRET válido de 32 bytes en hexadecimal.')
  const secreto = Buffer.from(valor)
  if (!hash) throw new Error('Prepara la cuenta de demostración con supervisor:clave en este servidor.')

  const api = crearApp(serviciosDemo, 'mock')
  api.use('/api/supervisor', rutasSupervisor(panel, hash, listarActivosDemo,
    { ...serviciosDemo, leerPagina: leerPaginaPanelDemo }, { contratos: 'mock', informes: 'mock' }))
  const servidor = express()
  servidor.disable('x-powered-by')
  servidor.use('/demo', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const recibido = Buffer.from(req.get('x-inova-demo-secret') ?? '')
    if (recibido.length !== secreto.length || !timingSafeEqual(recibido, secreto)) {
      res.status(403).json({ mensaje: 'Accede a la demostración desde el portal protegido.' })
      return
    }
    next()
  }, api)
  return servidor
}

if (import.meta.main) {
  try {
    const servidor = crearServidorDemo(process.env, cargarHash())
    const { port } = configurar({ PORT: process.env.PORT })
    servidor.listen(port, '127.0.0.1', (error?: Error) => {
      if (error) { console.error('No se pudo abrir el puerto de demostración.'); process.exitCode = 1; return }
      console.log('API de demostración en loopback, puerto ' + port)
    })
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
