import express, { type ErrorRequestHandler, type Request } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import { crearApp, serviciosDemo } from '../app.ts'
import { leerPaginaPanelDemo, listarActivosDemo } from '../mock/adaptadores.ts'
import { hashValido, verificarClave } from '../supervisor/argon2.ts'
import { configurarPanel } from '../supervisor/config.ts'
import { generarExcel, nombreExcel } from '../supervisor/excel.ts'
import { Lote } from '../supervisor/lote.ts'
import { leerFiltroPanel } from '../../shared/supervisor.ts'
import { clienteTurso, estadoCompartido } from './estado.ts'

const cookie = 'inova_demo_supervisor'
const opciones = { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/supervisor' } as const
const fuentes = { contratos: 'mock', informes: 'mock' } as const
const panel = configurarPanel({}, 'mock')
const token = () => randomBytes(32).toString('hex')
const tamanoPagina = 2

class ErrorPanel extends Error {
  status: number
  constructor(status: number, mensaje: string) { super(mensaje); this.status = status }
}
const sinSesion = () => new ErrorPanel(401, 'Inicia sesión para acceder al panel.')

async function reconstruir(fecha: string) {
  const lote = new Lote()
  lote.fecha = fecha
  await lote.ejecutar(listarActivosDemo, { ...serviciosDemo, leerPagina: leerPaginaPanelDemo }, panel)
  if (lote.estado !== 'completa') throw new Error('No se pudo preparar el lote ficticio.')
  return lote
}

export function crearDemo(env: NodeJS.ProcessEnv, enviar = fetch) {
  if (env.VERCEL_ENV !== 'preview' || !env.VERCEL_URL) throw new Error('La demostración requiere una URL de Preview.')
  if ([env.CONTRACT_SOURCE, env.INOVA_SOURCE, env.DATA_MODE].some(v => v && v !== 'mock') ||
      env.DB_HOST || env.DB_USER || env.DB_NAME || env.DB_PASSWORD || env.DB_SSL_CA_FILE || env.INOVA_API_KEY) {
    throw new Error('La demostración requiere un entorno sin configuración institucional.')
  }
  const hash = env.DEMO_SUPERVISOR_HASH
  if (!hashValido(hash)) throw new Error('Configura un hash Argon2id de demostración.')
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) throw new Error('Conecta el almacenamiento de demostración.')
  const estado = estadoCompartido(clienteTurso(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN, enviar))
  const app = crearApp(serviciosDemo, 'mock')
  const router = express.Router()
  app.use('/api/supervisor', router)
  // Un identificador opaco de 256 bits. El almacén solo recibe su huella,
  // ligada a la contraseña de demo y al despliegue que emitió la cookie.
  const huella = (valor: string) => createHash('sha256').update([env.VERCEL_URL, hash, valor].join(':')).digest('hex')
  const vista = (csrf: string, vence: number) => ({ csrf, vence, alcance: 'demo', fuentes })
  router.use((req, res, next) => {
    res.set({ 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' })
    if (req.method !== 'GET' && (req.get('origin') !== 'https://' + req.get('host') || !req.is('application/json'))) {
      throw new ErrorPanel(403, 'Origen o tipo de solicitud no permitido.')
    }
    next()
  })
  router.post('/login', express.json({ limit: '2kb' }), async (req, res) => {
    const turno = token()
    if (!await estado.reservarLogin(turno)) {
      res.set('Retry-After', '600')
      throw new ErrorPanel(429, 'Demasiados intentos o un acceso en curso. Inténtalo más tarde.')
    }
    try {
      const { usuario, clave } = req.body ?? {}
      if (typeof clave !== 'string' || Buffer.byteLength(clave) > 256 ||
          !await verificarClave(clave, hash) || usuario !== 'supervisor_demo') {
        throw new ErrorPanel(401, 'Usuario o contraseña incorrectos.')
      }
      const valor = token()
      const csrf = token()
      const fila = await estado.iniciarSesion(turno, huella(valor), csrf)
      if (!fila) throw new ErrorPanel(409, 'El intento de acceso ha vencido. Vuelve a ingresar.')
      res.cookie(cookie, valor, opciones).json(vista(csrf, Number(fila[0]) * 1000))
    } catch (error) {
      await estado.cancelarLogin(turno)
      throw error
    }
  })

  router.use(async (req, res, next) => {
    const valor = req.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookie + '='))?.slice(cookie.length + 1)
    const id = valor && /^[a-f0-9]{64}$/.test(valor) ? huella(valor) : null
    const csrf = req.method === 'GET' ? null : req.get('X-CSRF-Token') ?? ''
    const fila = id && await estado.identificar(id, csrf)
    if (!fila) {
      if (req.method === 'GET' && req.path === '/sesion') { res.json(null); return }
      throw sinSesion()
    }
    if (csrf !== null && csrf !== fila[0]) throw new ErrorPanel(403, 'Verificación de sesión fallida.')
    const vence = Number(fila[1]) * 1000
    res.set('X-Sesion-Vence', String(vence))
    res.locals.id = id
    res.locals.consulta = fila[2]
    res.locals.sesion = vista(fila[0]!, vence)
    next()
  })
  router.get('/sesion', (_req, res) => { res.json(res.locals.sesion) })
  router.post('/logout', async (_req, res) => {
    if (!await estado.cerrar(res.locals.id)) throw sinSesion()
    res.clearCookie(cookie, opciones).json(null)
  })

  // La reserva y la confirmación cercan el trabajo incluso si hay otro login,
  // un logout o una invocación interrumpida. El plazo supera maxDuration (30 s).
  async function conReserva<T>(id: string, hacer: (anterior: string | null) => Promise<{ fecha: string; valor: T }>) {
    const turno = token()
    const reserva = await estado.reservarTrabajo(id, turno)
    if (!reserva) throw new ErrorPanel(409, 'Ya hay una operación en curso o la sesión cambió.')
    try {
      const resultado = await hacer(reserva[0])
      if (!await estado.confirmarTrabajo(id, turno, resultado.fecha)) throw sinSesion()
      return resultado.valor
    } catch (error) {
      await estado.liberarTrabajo(turno)
      throw error
    }
  }
  router.post('/consulta', async (_req, res) => {
    const pagina = await conReserva(res.locals.id, async anterior => {
      const fecha = new Date(Math.max(Date.now(), anterior ? Date.parse(anterior) + 1 : 0)).toISOString()
      return { fecha, valor: (await reconstruir(fecha)).pagina(1, undefined, tamanoPagina) }
    })
    res.json(pagina)
  })
  router.get('/consulta', async (req, res) => {
    const pagina = req.query.pagina ?? '1'
    if (typeof pagina !== 'string' || !/^[1-9]\d{0,8}$/.test(pagina)) throw new ErrorPanel(400, 'Página inválida.')
    const fecha = res.locals.consulta
    res.json(fecha ? (await reconstruir(fecha)).pagina(Number(pagina), undefined, tamanoPagina) : null)
  })
  function filtroDe(req: Request) {
    const filtro = leerFiltroPanel(req.body?.columna, req.body?.texto)
    if (!filtro) throw new ErrorPanel(400, 'Filtro inválido.')
    return filtro
  }
  router.post('/consulta/filtrar', express.json({ limit: '8kb' }), async (req, res) => {
    const filtro = filtroDe(req)
    const pagina = req.body.pagina ?? 1
    if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 999999999) throw new ErrorPanel(400, 'Página inválida.')
    const fecha = res.locals.consulta
    res.json(fecha ? (await reconstruir(fecha)).pagina(pagina, filtro, tamanoPagina) : null)
  })
  router.post('/exportar-excel', express.json({ limit: '8kb' }), async (req, res) => {
    const filtro = filtroDe(req)
    if (typeof req.body.consulta !== 'string' || Object.keys(req.body).length !== 3) throw new ErrorPanel(400, 'Solicitud inválida.')
    const archivo = await conReserva(res.locals.id, async fecha => {
      if (!fecha || req.body.consulta !== fecha) throw new ErrorPanel(409, 'Vuelve a leer la consulta actual.')
      const filas = (await reconstruir(fecha)).filasFiltradas(filtro)
      if (!filas.length) throw new ErrorPanel(409, 'No hay coincidencias para descargar.')
      return { fecha, valor: await generarExcel(filas) }
    })
    res.attachment(nombreExcel()).send(archivo)
  })
  const errores: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ErrorPanel) res.status(error.status).json({ mensaje: error.message })
    else if ([400, 413].includes(error?.status)) res.status(error.status).json({ mensaje: 'Solicitud inválida.' })
    else res.status(503).json({ mensaje: 'Servicio de demostración no disponible. Inténtalo de nuevo.' })
  }
  router.use(errores)
  return app
}
