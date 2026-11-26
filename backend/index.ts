import express from 'express'
import { resolve } from 'node:path'
import { crearApp, serviciosDemo } from './app.ts'
import { configurar } from './config.ts'
import { abrirMysql, diagnosticoMysql } from './mysql/contratos.ts'
import { comprobarMysqlPorEtapas } from './mysql/comprobar.ts'
import { leerPaginaParaContratoMysql, leerPaginaPanelDemo, listarActivosDemo } from './mock/adaptadores.ts'
import { configurarPanel } from './supervisor/config.ts'
import { cargarHash } from './supervisor/cuenta.ts'
import { rutasSupervisor } from './supervisor/rutas.ts'
import { crearConsultaInova } from './inova/informes.ts'
import type { Servicios } from './services/consulta.ts'

async function iniciar() {
  const comprobar = process.argv.includes('--comprobar-mysql')
  const config = configurar(comprobar ? { ...process.env, INOVA_SOURCE: 'mock' } : process.env)
  if (comprobar) {
    if (config.fuente !== 'mysql') throw new Error('La comprobación requiere CONTRACT_SOURCE=mysql.')
    await comprobarMysqlPorEtapas(config.mysql)
    return
  }
  let servicios: Servicios = serviciosDemo
  const db = config.fuente === 'mysql' ? abrirMysql(config.mysql) : null
  if (db) {
    try { await db.verificar() }
    catch (error) {
      await db.cerrar()
      throw new Error(diagnosticoMysql(error))
    }
    servicios = config.inova
      ? { buscarContrato: db.buscarContrato, consultarInforme: crearConsultaInova(config.inova) }
      : { ...serviciosDemo, buscarContrato: db.buscarContrato, leerPagina: leerPaginaParaContratoMysql }
  }
  const app = crearApp(servicios, config.fuente)
  try {
    const panel = configurarPanel(process.env, config.fuente)
    let serviciosPanel = servicios
    if (!db) serviciosPanel = { ...serviciosDemo, leerPagina: leerPaginaPanelDemo }
    if (config.fuente === 'mysql' && config.inova) {
      serviciosPanel = { buscarContrato: servicios.buscarContrato, consultarInforme: crearConsultaInova({
        ...config.inova, rutaContrato: { gestion: [], supervision: [] }, rutaEntidad: ['identification'],
      }) }
    }
    app.use('/api/supervisor', rutasSupervisor(panel, cargarHash(), db?.listarActivos ?? listarActivosDemo, serviciosPanel,
      { contratos: config.fuente, informes: 'consultarInforme' in serviciosPanel ? 'real' : 'mock' }))
  } catch (error) {
    console.error('Configuración del panel de supervisión inválida.', (error as Error).message)
    app.use('/api/supervisor', (_req, res) => { res.status(503).json({ mensaje: 'Panel de supervisión no disponible.' }) })
  }
  app.use(express.static(resolve('dist/client')))
  const server = app.listen(config.port, '127.0.0.1', (error?: Error) => {
    if (error) {
      console.error('No se pudo abrir el puerto local. Revisa PORT.')
      process.exitCode = 1
      void db?.cerrar()
      return
    }
    const informes = 'consultarInforme' in servicios ? 'In-Ova' : 'simulados'
    console.log(`In-Ova · Contratos ${config.fuente}, estados ${informes} · http://127.0.0.1:${config.port}`)
  })
  const detener = () => server.close(() => { void db?.cerrar() })
  process.once('SIGINT', detener)
  process.once('SIGTERM', detener)
}

iniciar().catch((error: Error) => {
  console.error(error.message)
  process.exitCode = 1
})
