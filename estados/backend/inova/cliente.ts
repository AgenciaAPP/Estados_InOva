import type { TipoInforme } from '../../shared/consulta.ts'
import type { OpcionesInova } from './config.ts'

export class ErrorProveedor extends Error {}
export function objeto(valor: unknown): valor is Record<string, unknown> {
  return !!valor && typeof valor === 'object' && !Array.isArray(valor)
}
export function codigoFallo(error: unknown, signal: AbortSignal) {
  if (signal.aborted) return 'TIEMPO_AGOTADO'
  if (error instanceof ErrorProveedor) return error.message
  return error instanceof SyntaxError ? 'JSON_INVALIDO' : 'CONEXION_FALLIDA'
}

function cursorSiguiente(next: unknown, url: URL): string | null {
  if (next === null) return null
  if (typeof next !== 'string' || !next || next.length > 8192) throw new ErrorProveedor('PAGINACION_INVALIDA')
  if (/^[A-Za-z0-9_+=-]+$/.test(next)) return next
  let enlace: URL
  try {
    enlace = new URL(next, url)
    if (decodeURIComponent(enlace.pathname) !== decodeURIComponent(url.pathname)) throw new Error()
  } catch { throw new ErrorProveedor('PAGINACION_INVALIDA') }
  const filtros = enlace.searchParams.getAll('identification')
  const cursores = enlace.searchParams.getAll('cursor')
  if (enlace.origin !== url.origin || enlace.username || enlace.password || enlace.hash ||
      filtros.some(filtro => filtro !== url.searchParams.get('identification')) ||
      cursores.length !== 1 || !cursores[0] ||
      [...enlace.searchParams.keys()].some(k => k !== 'cursor' && k !== 'identification')) {
    throw new ErrorProveedor('PAGINACION_INVALIDA')
  }
  return cursores[0]
}

export function clienteInova(opciones: OpcionesInova, enviar: typeof fetch, signal: AbortSignal) {
  async function obtener(url: URL): Promise<unknown> {
    const respuesta = await enviar(url.toString(), {
      method: 'GET', headers: { Authorization: opciones.apiKey, Accept: 'application/json' },
      redirect: 'error', signal,
    })
    if (!respuesta.ok) {
      await respuesta.body?.cancel()
      throw new ErrorProveedor('HTTP_' + respuesta.status)
    }
    return respuesta.json()
  }

  async function pagina(tipo: TipoInforme, contrato: string, cursor: string | null) {
    const formId = opciones.formularios[tipo]
    const url = new URL('/api/forms/' + encodeURIComponent(formId) + '/records/', opciones.base)
    url.searchParams.set('identification', contrato)
    if (cursor !== null) url.searchParams.set('cursor', cursor)
    const datos = await obtener(url)
    if (!objeto(datos) || !Array.isArray(datos.results)) throw new ErrorProveedor('RESPUESTA_INVALIDA')
    const filas: Record<string, unknown>[] = []
    for (const fila of datos.results) {
      if (!objeto(fila) || fila.form_id !== formId) throw new ErrorProveedor('FORMULARIO_NO_VERIFICABLE')
      filas.push(fila)
    }
    return { filas, siguiente: cursorSiguiente(datos.next, url) }
  }

  async function entidad(id: unknown) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_+=/-]{1,512}$/.test(id)) throw new ErrorProveedor('ENTIDAD_NO_VERIFICABLE')
    return obtener(new URL('/api/entities/' + encodeURIComponent(id), opciones.base))
  }
  return { pagina, entidad }
}

// Swagger admite answers como texto. Solo se abre si realmente contiene un objeto o array JSON.
export function abrirAnswers(valor: unknown): unknown {
  if (typeof valor !== 'string' || !/^[\s]*[\[{]/.test(valor)) return valor
  try { return JSON.parse(valor) } catch { return valor }
}
