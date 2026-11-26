export const sinConexion = 'No se pudo contactar con el servidor de consultas. Comprueba la conexión y vuelve a intentarlo.'

export async function solicitarApi(ruta: string, opciones: RequestInit = {}) {
  const respuesta = await fetch('/api/' + ruta, {
    ...opciones, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  })
  const errorDelProxy = !respuesta.ok && !respuesta.headers.get('Content-Type')?.includes('application/json')
  if (respuesta.status === 502 || respuesta.status === 504 || errorDelProxy) {
    throw new Error(sinConexion)
  }
  return respuesta
}
