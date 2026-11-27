import express from 'express'
import { crearApp, serviciosDemo } from '../backend/app.ts'
import { configurar } from '../backend/config.ts'
import { crearAlmacenSupervisorVercel } from '../backend/supervisor/almacen-vercel.ts'
import { configurarPanel } from '../backend/supervisor/config.ts'
import { cargarHash } from '../backend/supervisor/cuenta.ts'
import { rutasSupervisorVercel } from '../backend/supervisor/rutas-vercel.ts'
import { abrirMysql, diagnosticoMysql } from '../backend/mysql/contratos.ts'
import { leerPaginaPanelDemo, leerPaginaParaContratoMysql, listarActivosDemo } from '../backend/mock/adaptadores.ts'
import { crearConsultaInova } from '../backend/inova/informes.ts'
import type { Servicios } from '../backend/services/consulta.ts'

async function crearAplicacionVercel() {
  const env = process.env
  const config = configurar(env)
  const urlVercel = env.VERCEL_ENV === 'production'
    ? env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
    : env.VERCEL_URL
  const origen = env.SUPERVISOR_ORIGIN?.trim() ||
    (urlVercel ? 'https://' + urlVercel : '')
  const envPanel = { ...env, SUPERVISOR_ORIGIN: origen }
  const panel = configurarPanel(envPanel, config.fuente)
  if (panel.concurrencia > 2) {
    throw new Error('En Vercel, SUPERVISOR_CONCURRENCY debe ser 1 o 2.')
  }
  if (!panel.origen) {
    throw new Error('Configura SUPERVISOR_ORIGIN o confirma que VERCEL_URL esté disponible.')
  }
  if (panel.alcance === 'general') {
    throw new Error('El panel de Vercel requiere SUPERVISOR_SCOPE=pilot y contratos autorizados.')
  }
  const hash = cargarHash(env)
  if (!hash) throw new Error('Configura SUPERVISOR_HASH en las variables privadas de Vercel.')
  const almacen = crearAlmacenSupervisorVercel(env)
  let servicios: Servicios = serviciosDemo
  const db = config.fuente === 'mysql' ? abrirMysql(config.mysql) : null
  if (db) {
    try {
      await db.verificar()
    } catch (error) {
      await db.cerrar()
      throw new Error(diagnosticoMysql(error))
    }
    servicios = config.inova
      ? { buscarContrato: db.buscarContrato, consultarInforme: crearConsultaInova(config.inova) }
      : { ...serviciosDemo, buscarContrato: db.buscarContrato, leerPagina: leerPaginaParaContratoMysql }
  }

  const app = crearApp(servicios, config.fuente)
  app.set('trust proxy', 1)
  const serviciosPanel: Servicios = config.fuente === 'mysql' && config.inova
    ? {
        buscarContrato: servicios.buscarContrato,
        consultarInforme: crearConsultaInova({
          ...config.inova,
          rutaContrato: { gestion: [], supervision: [] },
          rutaEntidad: ['identification'],
        }),
      }
    : db ? servicios : { ...serviciosDemo, leerPagina: leerPaginaPanelDemo }
  const listarPanel = db?.listarActivos ?? listarActivosDemo
  app.use('/api/supervisor', rutasSupervisorVercel(
    panel,
    hash,
    listarPanel,
    serviciosPanel,
    { contratos: config.fuente, informes: 'consultarInforme' in serviciosPanel ? 'real' : 'mock' },
    almacen,
  ))
  return app
}

const handler = express()
handler.disable('x-powered-by')
let aplicacion: ReturnType<typeof crearAplicacionVercel> | undefined

handler.use(async (req, res) => {
  try {
    if (!aplicacion) {
      const inicio = crearAplicacionVercel()
      aplicacion = inicio.catch(error => {
        aplicacion = undefined
        throw error
      })
    }
    const app = await aplicacion
    if (req.url?.startsWith('/api/index?')) {
      const parametros = new URLSearchParams(req.url.slice('/api/index?'.length))
      const ruta = parametros.get('__ruta')
      if (ruta && /^[a-z/-]+$/.test(ruta)) {
        parametros.delete('__ruta')
        req.url = '/api/' + ruta + (parametros.size ? '?' + parametros : '')
      }
    }
    return app(req, res)
  } catch (error) {
    console.error('No se pudo inicializar la función API de Vercel.',
      error instanceof Error ? error.message : 'Error desconocido.')
    if (!res.headersSent) {
      res.status(503).set('Cache-Control', 'no-store').json({
        mensaje: 'Servicio no disponible. Revisa las variables privadas y la conectividad del backend.',
      })
    }
  }
})

export default handler
