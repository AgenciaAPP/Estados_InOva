import express from 'express'
import { validarCedula, type Fuentes } from '../shared/consulta.ts'
import { consultar, type Servicios } from './services/consulta.ts'
import { buscarContratoDemo, leerPaginaDemo } from './mock/adaptadores.ts'
import { interpretarEstadoDemo } from './services/estados.ts'
import { diagnosticoMysql } from './mysql/contratos.ts'

export const serviciosDemo = {
  buscarContrato: buscarContratoDemo,
  leerPagina: leerPaginaDemo,
  interpretarEstado: interpretarEstadoDemo,
} satisfies Servicios

export function crearApp(servicios: Servicios, contratos: Fuentes['contratos']) {
  const fuentes: Fuentes = { contratos, informes: 'consultarInforme' in servicios ? 'real' : 'mock' }
  const app = express()
  app.disable('x-powered-by')
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  app.get('/api/configuracion', (_req, res) => {
    res.json({ demostracion: contratos === 'mock', fuentes })
  })
  app.get('/api/consulta-informes', async (req, res) => {
    const cedula = req.query.cedula
    const problema = validarCedula(cedula)
    if (problema || typeof cedula !== 'string') {
      res.status(400).json({ mensaje: problema })
      return
    }
    try {
      const resultado = await consultar(cedula, servicios)
      if ('error' in resultado) res.status(404).json({ mensaje: resultado.error })
      else res.json({ ...resultado.datos, fuentes })
    } catch (error) {
      if (contratos === 'mysql') console.error(diagnosticoMysql(error))
      res.status(500).json({ mensaje: 'Error durante la consulta. Inténtalo de nuevo.' })
    }
  })
  return app
}
