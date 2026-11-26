import express, { type CookieOptions, type ErrorRequestHandler, type Request } from 'express'
import { randomBytes } from 'node:crypto'
import { finished } from 'node:stream/promises'
import type { Fuentes } from '../../shared/consulta.ts'
import { leerFiltroPanel } from '../../shared/supervisor.ts'
import type { Servicios } from '../services/consulta.ts'
import type { ListarActivos } from './contratos.ts'
import type { ConfigPanel } from './config.ts'
import { verificarClave } from './cuenta.ts'
import { Lote } from './lote.ts'
import { generarExcel, LimiteExcel, nombreExcel } from './excel.ts'

const cookie = 'inova_supervisor'
const duracion = 30 * 60_000
interface Sesion {
  id: string
  permiso: 'supervisor'
  csrf: string
  vence: number
  lote?: Lote
}

function origenPermitido(req: Request, origen: string | null) {
  const enviado = req.get('origin')
  if (origen) return enviado === origen
  const host = req.get('host')
  if (!host || !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false
  return enviado === req.protocol + '://' + host
}

export function rutasSupervisor(config: ConfigPanel, hash: string | null, listar: ListarActivos, servicios: Servicios, fuentes: Fuentes) {
  const router = express.Router()
  const opciones: CookieOptions = { httpOnly: true, sameSite: 'strict', secure: Boolean(config.origen), path: '/api/supervisor' }
  let sesion: Sesion | undefined
  let expiracion: NodeJS.Timeout | undefined
  let ocupado = false
  let exportando = false
  let verificando = false
  let intentos: number[] = []

  function revocar() {
    clearTimeout(expiracion)
    sesion?.lote?.cancelar()
    sesion = undefined
  }
  function identificar(req: Request) {
    if (sesion && Date.now() >= sesion.vence) revocar()
    const partes = req.get('cookie')?.split(';').map(s => s.trim()) ?? []
    return sesion?.permiso === 'supervisor' && partes.includes(cookie + '=' + sesion.id) ? sesion : undefined
  }
  function renovar(s: Sesion) {
    s.vence = Date.now() + duracion
    clearTimeout(expiracion)
    expiracion = setTimeout(revocar, duracion).unref()
  }
  function vista(s: Sesion) {
    return { csrf: s.csrf, vence: s.vence, alcance: config.alcance, fuentes }
  }

  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' })
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
    if (!hash) { res.status(503).json({ mensaje: 'La cuenta de supervisión aún no está habilitada.' }); return }
    const { usuario, clave } = req.body ?? {}
    const ahora = Date.now()
    intentos = intentos.filter(t => ahora - t < 600_000)
    if (intentos.length >= 5 || verificando) {
      res.set('Retry-After', String(intentos.length >= 5 ? Math.max(1, Math.ceil((intentos[0] + 600_000 - ahora) / 1000)) : 1))
      res.status(429).json({ mensaje: 'Demasiados intentos. Inténtalo más tarde.' })
      return
    }
    intentos.push(ahora)
    if (typeof usuario !== 'string' || typeof clave !== 'string' || Buffer.byteLength(clave) > 256) {
      res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' }); return
    }
    verificando = true
    try {
      if (!await verificarClave(clave, hash) || usuario !== config.usuario) {
        res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' }); return
      }
      revocar()
      intentos = []
      sesion = { id: randomBytes(32).toString('hex'), permiso: 'supervisor', csrf: randomBytes(32).toString('hex'), vence: Date.now() + duracion }
      renovar(sesion)
      res.cookie(cookie, sesion.id, { ...opciones, secure: opciones.secure || req.secure }).json(vista(sesion))
    } finally { verificando = false }
  })
  router.get('/sesion', (req, res) => {
    const s = identificar(req)
    if (s) renovar(s)
    res.json(s ? vista(s) : null)
  })
  router.use((req, res, next) => {
    const s = identificar(req)
    if (!s) { res.status(401).json({ mensaje: 'Inicia sesión para acceder al panel.' }); return }
    if (req.method !== 'GET' && req.get('X-CSRF-Token') !== s.csrf) {
      res.status(403).json({ mensaje: 'Verificación de sesión fallida. Vuelve a ingresar.' }); return
    }
    renovar(s)
    res.set('X-Sesion-Vence', String(s.vence))
    next()
  })
  router.post('/logout', (req, res) => {
    revocar()
    res.clearCookie(cookie, { ...opciones, secure: opciones.secure || req.secure }).json(null)
  })
  router.post('/consulta', (_req, res) => {
    if (ocupado) { res.status(409).json({ mensaje: 'Ya hay una consulta en curso.' }); return }
    if (config.autorizados?.length === 0) {
      res.status(409).json({ mensaje: 'Configura los contratos autorizados del piloto antes de consultar.' }); return
    }
    const lote = new Lote()
    sesion!.lote = lote
    ocupado = true
    void lote.ejecutar(listar, servicios, config).finally(() => { ocupado = false })
    res.status(202).json(lote.pagina(1))
  })
  router.get('/consulta', (req, res) => {
    const valor = req.query.pagina ?? '1'
    if (typeof valor !== 'string' || !/^[1-9]\d{0,8}$/.test(valor)) {
      res.status(400).json({ mensaje: 'Página inválida.' }); return
    }
    res.json(sesion!.lote?.pagina(Number(valor)) ?? null)
  })
  // El texto de búsqueda viaja en el cuerpo para mantenerlo fuera de las URL de acceso.
  router.post('/consulta/filtrar', express.json({ limit: '8kb' }), (req, res) => {
    const { pagina = 1, columna, texto } = req.body ?? {}
    const filtro = leerFiltroPanel(columna, texto)
    if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 999999999 || !filtro) {
      res.status(400).json({ mensaje: 'Filtro o página inválidos.' }); return
    }
    res.json(sesion!.lote?.pagina(pagina, filtro) ?? null)
  })
  router.post('/exportar-excel', express.json({ limit: '8kb' }), async (req, res) => {
    const s = identificar(req)
    if (!s) { res.status(401).json({ mensaje: 'Vuelve a ingresar y realiza nuevamente la consulta.' }); return }
    const { consulta, columna, texto } = req.body ?? {}
    const filtro = leerFiltroPanel(columna, texto)
    if (!filtro || typeof consulta !== 'string' || Object.keys(req.body).length !== 3) {
      res.status(400).json({ mensaje: 'Solicitud de exportación inválida.' }); return
    }
    const lote = s.lote
    const revisar = 'El resultado solicitado ya no está disponible. Vuelve a leer el panel o realiza nuevamente la consulta.'
    if (!lote || lote.fecha !== consulta || lote.estado !== 'completa') {
      res.status(409).json({ mensaje: lote?.estado === 'enCurso' ? 'Espera a que termine la consulta.' : revisar }); return
    }
    if (exportando) { res.status(409).json({ mensaje: 'Ya hay una descarga en curso.' }); return }
    const filas = lote.filasFiltradas(filtro)
    if (!filas.length) { res.status(409).json({ mensaje: 'No hay coincidencias para descargar.' }); return }
    exportando = true
    try {
      const archivo = await generarExcel(filas)
      if (res.destroyed) return
      if (identificar(req) !== s) { res.status(401).json({ mensaje: 'Vuelve a ingresar y realiza nuevamente la consulta.' }); return }
      if (s.lote !== lote) { res.status(409).json({ mensaje: revisar }); return }
      res.attachment(nombreExcel()).send(archivo)
      await finished(res, { cleanup: true })
    } catch (error) {
      if (!res.destroyed && !res.headersSent) {
        const limite = error instanceof LimiteExcel
        res.status(limite ? 413 : 500).json({ mensaje: limite ? error.message : 'No se pudo generar el archivo Excel. Inténtalo de nuevo.' })
      }
    } finally { exportando = false }
  })
  const errorSeguro: ErrorRequestHandler = (error, _req, res, _next) => {
    const cliente = error?.status === 400 || error?.status === 413
    res.status(cliente ? error.status : 500).json({ mensaje: cliente ? 'Solicitud inválida.' : 'No se pudo atender la solicitud de supervisión.' })
  }
  router.use(errorSeguro)
  return router
}
