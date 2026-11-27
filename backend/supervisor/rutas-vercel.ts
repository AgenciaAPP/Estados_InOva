import express, { type ErrorRequestHandler, type Request } from 'express'
import { randomBytes } from 'node:crypto'
import type { Fuentes } from '../../shared/consulta.ts'
import { leerFiltroPanel } from '../../shared/supervisor.ts'
import type { Servicios } from '../services/consulta.ts'
import type { ListarActivos } from './contratos.ts'
import type { ConfigPanel } from './config.ts'
import { verificarClave } from './cuenta.ts'
import type { AlmacenSupervisor, SesionVercel } from './almacen-vercel.ts'
import { Lote } from './lote.ts'
import { generarExcel, LimiteExcel, nombreExcel } from './excel.ts'

const cookie = 'inova_supervisor'
const duracion = 30 * 60_000
const tamanoExcelVercel = 4 * 1024 * 1024

function origenPermitido(req: Request, origen: string | null) {
  return Boolean(origen && req.get('origin') === origen)
}

function cookieSesion(req: Request) {
  return req.get('cookie')?.split(';').map(parte => parte.trim())
    .find(parte => parte.startsWith(cookie + '='))?.slice(cookie.length + 1)
}

export function rutasSupervisorVercel(
  config: ConfigPanel,
  hash: string,
  listar: ListarActivos,
  servicios: Servicios,
  fuentes: Fuentes,
  almacen: AlmacenSupervisor,
) {
  if (!config.origen) throw new Error('SUPERVISOR_ORIGIN debe identificar el origen HTTPS del despliegue.')
  if (config.alcance === 'general') {
    throw new Error('El panel de Vercel requiere SUPERVISOR_SCOPE=pilot y contratos autorizados.')
  }
  const router = express.Router()
  const opcionesCookie = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/api/supervisor' }
  const vista = (sesion: SesionVercel) => ({
    csrf: sesion.csrf,
    vence: sesion.vence,
    alcance: config.alcance,
    fuentes,
  })

  router.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    })
    next()
  })
  router.use((req, res, next) => {
    if (req.method !== 'GET' && (!origenPermitido(req, config.origen) || !req.is('application/json'))) {
      res.status(403).json({ mensaje: 'Origen o tipo de solicitud no permitido.' })
      return
    }
    next()
  })
  router.post('/login', express.json({ limit: '2kb' }), async (req, res) => {
    if (!hash) {
      res.status(503).json({ mensaje: 'La cuenta de supervisión aún no está habilitada.' })
      return
    }
    const turno = randomBytes(32).toString('hex')
    const reserva = await almacen.reservarLogin(turno)
    if (reserva !== 'reservado') {
      res.set('Retry-After', reserva === 'limite' ? '600' : '1')
      res.status(429).json({ mensaje: 'Demasiados intentos o un acceso en curso. Inténtalo más tarde.' })
      return
    }
    try {
      const { usuario, clave } = req.body ?? {}
      if (typeof usuario !== 'string' || typeof clave !== 'string' ||
          Buffer.byteLength(clave) > 256 || !await verificarClave(clave, hash) || usuario !== config.usuario) {
        await almacen.completarLogin(turno, null)
        res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' })
        return
      }
      const sesion: SesionVercel = {
        id: randomBytes(32).toString('hex'),
        csrf: randomBytes(32).toString('hex'),
        vence: Date.now() + duracion,
        lote: null,
      }
      if (!await almacen.completarLogin(turno, sesion)) {
        res.status(409).json({ mensaje: 'El intento de acceso venció. Vuelve a ingresar.' })
        return
      }
      res.cookie(cookie, sesion.id, opcionesCookie).json(vista(sesion))
    } catch (error) {
      await almacen.completarLogin(turno, null)
      throw error
    }
  })

  router.get('/sesion', async (req, res) => {
    const id = cookieSesion(req)
    const sesion = id && /^[a-f0-9]{64}$/.test(id) ? await almacen.renovarSesion(id) : null
    if (!sesion) {
      res.json(null)
      return
    }
    res.set('X-Sesion-Vence', String(sesion.vence)).json(vista(sesion))
  })

  router.use(async (req, res, next) => {
    const id = cookieSesion(req)
    const sesion = id && /^[a-f0-9]{64}$/.test(id) ? await almacen.renovarSesion(id) : null
    if (!sesion) {
      res.status(401).json({ mensaje: 'Inicia sesión para acceder al panel.' })
      return
    }
    if (req.method !== 'GET' && req.get('X-CSRF-Token') !== sesion.csrf) {
      res.status(403).json({ mensaje: 'Verificación de sesión fallida. Vuelve a ingresar.' })
      return
    }
    res.locals.sesion = sesion
    res.set('X-Sesion-Vence', String(sesion.vence))
    next()
  })

  router.post('/logout', async (req, res) => {
    const sesion = res.locals.sesion as SesionVercel
    await almacen.revocarSesion(sesion.id)
    res.clearCookie(cookie, opcionesCookie).json(null)
  })

  router.post('/consulta', async (_req, res) => {
    const sesion = res.locals.sesion as SesionVercel
    if (config.autorizados?.length === 0) {
      res.status(409).json({ mensaje: 'Configura los contratos autorizados del piloto antes de consultar.' })
      return
    }
    const turno = randomBytes(32).toString('hex')
    if (!await almacen.adquirirTrabajo(turno, 310)) {
      res.status(409).json({ mensaje: 'Ya hay una operación en curso. Inténtalo de nuevo.' })
      return
    }
    try {
      const candidatos = await listar(config.autorizados)
      if (candidatos.length > 10) {
        res.status(409).json({ mensaje: 'El piloto supera el límite serverless de diez contratos candidatos.' })
        return
      }
      const lote = new Lote()
      await lote.ejecutar(async () => candidatos, servicios, config)
      if (!await almacen.guardarLote(sesion.id, lote.guardar())) {
        res.status(401).json({ mensaje: 'La sesión cambió o venció. Vuelve a ingresar.' })
        return
      }
      res.status(202).json(lote.pagina(1))
    } finally {
      await almacen.liberarTrabajo(turno)
    }
  })

  router.get('/consulta', (req, res) => {
    const valor = req.query.pagina ?? '1'
    if (typeof valor !== 'string' || !/^[1-9]\d{0,8}$/.test(valor)) {
      res.status(400).json({ mensaje: 'Página inválida.' })
      return
    }
    const sesion = res.locals.sesion as SesionVercel
    const lote = sesion.lote && Lote.restaurar(sesion.lote)
    res.json(lote?.pagina(Number(valor)) ?? null)
  })

  router.post('/consulta/filtrar', express.json({ limit: '8kb' }), (req, res) => {
    const { pagina = 1, columna, texto } = req.body ?? {}
    const filtro = leerFiltroPanel(columna, texto)
    if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 999999999 || !filtro) {
      res.status(400).json({ mensaje: 'Filtro o página inválidos.' })
      return
    }
    const sesion = res.locals.sesion as SesionVercel
    const lote = sesion.lote && Lote.restaurar(sesion.lote)
    res.json(lote?.pagina(pagina, filtro) ?? null)
  })

  router.post('/exportar-excel', express.json({ limit: '8kb' }), async (req, res) => {
    const sesion = res.locals.sesion as SesionVercel
    const cuerpo: unknown = req.body
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
      res.status(400).json({ mensaje: 'Solicitud de exportación inválida.' })
      return
    }
    const { consulta, columna, texto } = cuerpo as Record<string, unknown>
    const filtro = leerFiltroPanel(columna, texto)
    if (!filtro || typeof consulta !== 'string' || Object.keys(cuerpo).length !== 3) {
      res.status(400).json({ mensaje: 'Solicitud de exportación inválida.' })
      return
    }
    const guardado = sesion.lote
    if (!guardado || guardado.fecha !== consulta || guardado.estado !== 'completa') {
      res.status(409).json({ mensaje: 'El resultado solicitado no está disponible. Vuelve a consultar.' })
      return
    }
    const turno = randomBytes(32).toString('hex')
    if (!await almacen.adquirirTrabajo(turno, 60)) {
      res.status(409).json({ mensaje: 'Ya hay una operación en curso. Inténtalo de nuevo.' })
      return
    }
    try {
      const filas = Lote.restaurar(guardado).filasFiltradas(filtro)
      if (!filas.length) {
        res.status(409).json({ mensaje: 'No hay coincidencias para descargar.' })
        return
      }
      const archivo = await generarExcel(filas, tamanoExcelVercel)
      const vigente = await almacen.renovarSesion(sesion.id)
      if (!vigente) {
        res.status(401).json({ mensaje: 'Vuelve a ingresar y realiza nuevamente la consulta.' })
        return
      }
      res.attachment(nombreExcel()).send(archivo)
    } catch (error) {
      if (error instanceof LimiteExcel) {
        res.status(413).json({ mensaje: error.message })
        return
      }
      throw error
    } finally {
      await almacen.liberarTrabajo(turno)
    }
  })

  const errorSeguro: ErrorRequestHandler = (error, _req, res, _next) => {
    const cliente = error?.status === 400 || error?.status === 413
    if (!res.headersSent) {
      res.status(cliente ? error.status : 503).json({
        mensaje: cliente ? 'Solicitud inválida.' : 'No se pudo atender el servicio de supervisión.',
      })
    }
  }
  router.use(errorSeguro)
  return router
}
