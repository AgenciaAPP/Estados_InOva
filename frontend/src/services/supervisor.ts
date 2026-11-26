export class ErrorPanel extends Error {
  status: number
  constructor(status: number, mensaje: string) { super(mensaje); this.status = status }
}

interface OpcionesPanel { cuerpo?: object; csrf?: string; signal?: AbortSignal; renovar?: (vence: number) => void }

async function respuestaPanel(ruta: string, opciones: OpcionesPanel) {
  const headers: Record<string, string> = {}
  if (opciones.cuerpo) headers['Content-Type'] = 'application/json'
  if (opciones.csrf) headers['X-CSRF-Token'] = opciones.csrf
  const r = await fetch('/api/supervisor/' + ruta, {
    method: opciones.cuerpo ? 'POST' : 'GET', headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined, signal: opciones.signal,
  })
  if (!r.ok) {
    const datos = await r.json().catch(() => ({}))
    throw new ErrorPanel(r.status, datos.mensaje || 'No se pudo consultar el panel.')
  }
  const vence = Number(r.headers.get('X-Sesion-Vence'))
  if (vence > 0) opciones.renovar?.(vence)
  return r
}

export async function pedirPanel<T>(ruta: string, opciones: OpcionesPanel = {}): Promise<T> {
  return (await respuestaPanel(ruta, opciones)).json()
}

export async function descargarExcel(opciones: OpcionesPanel) {
  const r = await respuestaPanel('exportar-excel', opciones)
  const nombre = /filename="?(Estados_Contratos_PS_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx)"?$/.exec(r.headers.get('Content-Disposition') ?? '')?.[1]
  if (!nombre) throw new ErrorPanel(500, 'No se recibió un archivo Excel válido.')
  const archivo = await r.blob()
  if (opciones.signal?.aborted) return
  const enlace = document.createElement('a')
  enlace.href = URL.createObjectURL(archivo)
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  window.setTimeout(() => URL.revokeObjectURL(enlace.href), 1000)
}

export function mensajePanel(error: unknown) {
  return error instanceof ErrorPanel ? error.message : 'No se pudo contactar con el servidor. Inténtalo de nuevo.'
}
