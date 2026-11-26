import type { Fuentes, ResultadoConsulta } from '../../../shared/consulta.ts'
import { solicitarApi } from './api'

export async function obtenerFuentes(): Promise<Fuentes> {
  const respuesta = await solicitarApi('configuracion', { signal: AbortSignal.timeout(15000) })
  if (!respuesta.ok) throw new Error('Configuración no disponible.')
  return (await respuesta.json()).fuentes
}

export async function consultarInformes(cedula: string): Promise<ResultadoConsulta> {
  const respuesta = await solicitarApi('consulta-informes?' + new URLSearchParams({ cedula }), {
    signal: AbortSignal.timeout(40000),
  })
  if (!respuesta.ok) {
    if ([400, 404].includes(respuesta.status)) {
      const { mensaje } = await respuesta.json()
      if (typeof mensaje === 'string') throw new Error(mensaje)
    }
    throw new Error('Error durante la consulta. Inténtalo de nuevo.')
  }
  return respuesta.json() as Promise<ResultadoConsulta>
}
