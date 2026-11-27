import type { LoteGuardado } from './lote.ts'

export interface SesionVercel {
  id: string
  csrf: string
  vence: number
  lote: LoteGuardado | null
}

export type ReservaLogin = 'reservado' | 'ocupado' | 'limite'

export interface AlmacenSupervisor {
  reservarLogin(turno: string): Promise<ReservaLogin>
  completarLogin(turno: string, sesion: SesionVercel | null): Promise<boolean>
  renovarSesion(id: string): Promise<SesionVercel | null>
  guardarLote(id: string, lote: LoteGuardado): Promise<boolean>
  revocarSesion(id: string): Promise<boolean>
  adquirirTrabajo(turno: string, segundos: number): Promise<boolean>
  liberarTrabajo(turno: string): Promise<void>
}

const duracionSesion = 30 * 60
const luaReservarLogin = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local intentos = tonumber(redis.call('GET', KEYS[2]) or '0')
if intentos >= 5 then return -1 end
intentos = redis.call('INCR', KEYS[2])
if intentos == 1 then redis.call('EXPIRE', KEYS[2], 600) end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 45)
return 1
`

const luaCompletarLogin = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[3] ~= '' then
  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
  redis.call('DEL', KEYS[3])
end
redis.call('DEL', KEYS[1])
return 1
`

const luaRenovarSesion = `
local valor = redis.call('GET', KEYS[1])
if not valor then return false end
local sesion = cjson.decode(valor)
if sesion.id ~= ARGV[1] then return false end
if tonumber(sesion.vence) <= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return false
end
sesion.vence = tonumber(ARGV[3])
local actualizada = cjson.encode(sesion)
redis.call('SET', KEYS[1], actualizada, 'EX', ARGV[4])
return actualizada
`

const luaGuardarLote = `
local valor = redis.call('GET', KEYS[1])
if not valor then return 0 end
local sesion = cjson.decode(valor)
if sesion.id ~= ARGV[1] then return 0 end
sesion.lote = cjson.decode(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(sesion), 'EX', ARGV[3])
return 1
`

const luaRevocarSesion = `
local valor = redis.call('GET', KEYS[1])
if not valor then return 0 end
local sesion = cjson.decode(valor)
if sesion.id ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`

const luaLiberar = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`

function objeto(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor && typeof valor === 'object' && !Array.isArray(valor))
}

function validarLote(valor: unknown): valor is LoteGuardado {
  return objeto(valor) &&
    typeof valor.fecha === 'string' &&
    ['enCurso', 'completa', 'fallida'].includes(String(valor.estado)) &&
    (valor.candidatos === null || Number.isSafeInteger(valor.candidatos)) &&
    Number.isSafeInteger(valor.procesados) &&
    Number.isSafeInteger(valor.incluidos) &&
    Array.isArray(valor.filas)
}

function parsearSesion(valor: unknown): SesionVercel | null {
  if (valor === null || valor === false) return null
  if (typeof valor !== 'string') throw new Error('El almacén devolvió una sesión inválida.')
  const datos: unknown = JSON.parse(valor)
  if (!objeto(datos)) {
    throw new Error('El almacén devolvió una sesión inválida.')
  }
  const { id, csrf, vence, lote } = datos
  if (typeof id !== 'string' || typeof csrf !== 'string' || typeof vence !== 'number' ||
      !Number.isSafeInteger(vence) ||
      !(lote === null || validarLote(lote))) {
    throw new Error('El almacén devolvió una sesión inválida.')
  }
  return { id, csrf, vence, lote }
}

export class AlmacenSupervisorVercel implements AlmacenSupervisor {
  private readonly url: string
  private readonly token: string
  private readonly enviar: typeof fetch
  private readonly claves: Record<'sesion' | 'intentos' | 'login' | 'trabajo', string>

  constructor(url: string, token: string, enviar: typeof fetch = fetch, namespace = 'inova:supervisor') {
    let base: URL
    try { base = new URL(url) }
    catch { throw new Error('UPSTASH_REDIS_REST_URL inválida.') }
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' ||
        base.search || base.hash || !token.trim()) {
      throw new Error('Configura el almacén Upstash con una URL HTTPS y su token privado.')
    }
    this.url = base.origin
    this.token = token.trim()
    this.enviar = enviar
    this.claves = {
      sesion: namespace + ':sesion',
      intentos: namespace + ':intentos',
      login: namespace + ':login',
      trabajo: namespace + ':trabajo',
    }
  }

  private async comando(argumentos: string[]): Promise<unknown> {
    const respuesta = await this.enviar(this.url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(argumentos),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!respuesta.ok) {
      await respuesta.body?.cancel()
      throw new Error('El almacén compartido del supervisor no está disponible.')
    }
    const cuerpo: unknown = await respuesta.json()
    if (!objeto(cuerpo) || 'error' in cuerpo) {
      throw new Error('El almacén compartido del supervisor rechazó la operación.')
    }
    return cuerpo.result
  }

  async reservarLogin(turno: string): Promise<ReservaLogin> {
    const resultado = await this.comando([
      'EVAL', luaReservarLogin, '2', this.claves.login, this.claves.intentos, turno,
    ])
    if (resultado === 1) return 'reservado'
    if (resultado === 0) return 'ocupado'
    if (resultado === -1) return 'limite'
    throw new Error('No se pudo reservar el acceso del supervisor.')
  }

  async completarLogin(turno: string, sesion: SesionVercel | null): Promise<boolean> {
    const resultado = await this.comando([
      'EVAL', luaCompletarLogin, '3', this.claves.login, this.claves.sesion, this.claves.intentos,
      turno, sesion ? '1' : '0', sesion ? JSON.stringify(sesion) : '',
      String(duracionSesion),
    ])
    return resultado === 1
  }

  async renovarSesion(id: string): Promise<SesionVercel | null> {
    const resultado = await this.comando([
      'EVAL', luaRenovarSesion, '1', this.claves.sesion, id,
      String(Date.now()), String(Date.now() + duracionSesion * 1000), String(duracionSesion),
    ])
    return parsearSesion(resultado)
  }

  async guardarLote(id: string, lote: LoteGuardado): Promise<boolean> {
    const resultado = await this.comando([
      'EVAL', luaGuardarLote, '1', this.claves.sesion, id, JSON.stringify(lote),
      String(duracionSesion),
    ])
    return resultado === 1
  }

  async revocarSesion(id: string): Promise<boolean> {
    const resultado = await this.comando(['EVAL', luaRevocarSesion, '1', this.claves.sesion, id])
    return resultado === 1
  }

  async adquirirTrabajo(turno: string, segundos: number): Promise<boolean> {
    const resultado = await this.comando([
      'SET', this.claves.trabajo, turno, 'EX', String(segundos), 'NX',
    ])
    return resultado === 'OK'
  }

  async liberarTrabajo(turno: string): Promise<void> {
    await this.comando(['EVAL', luaLiberar, '1', this.claves.trabajo, turno])
  }
}

export function crearAlmacenSupervisorVercel(env: NodeJS.ProcessEnv, enviar: typeof fetch = fetch) {
  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Configura UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN en Vercel.')
  const project = env.VERCEL_PROJECT_ID || 'inova'
  const environment = env.VERCEL_ENV || 'preview'
  const deployment = environment === 'preview' ? env.VERCEL_URL || 'preview' : 'production'
  return new AlmacenSupervisorVercel(url, token, enviar,
    `inova:${project}:${environment}:${deployment}:supervisor`)
}
