import type { TipoInforme } from '../../shared/consulta.ts'

// Modelo normalizado de los proveedores de informes simulados.
export interface Registro {
  contrato: string
  fecha: string
  estadoId: string
}
export interface Pagina {
  registros: Registro[]
  siguiente: string | null
}
export type LeerPagina = (tipo: TipoInforme, contrato: string, cursor: string | null) => Promise<Pagina>

export async function buscarEstadoReciente(leer: LeerPagina, tipo: TipoInforme, contrato: string) {
  let cursor: string | null = null
  let estado: string | null = null
  let fechaReciente = -Infinity
  const visitados = new Set<string>()
  do {
    const pagina = await leer(tipo, contrato, cursor)
    for (const registro of pagina.registros) {
      if (registro.contrato !== contrato) continue
      const fecha = Date.parse(registro.fecha)
      if (!Number.isFinite(fecha)) throw new Error('Fecha de registro inválida.')
      if (fecha > fechaReciente) {
        fechaReciente = fecha
        estado = registro.estadoId
      }
    }
    cursor = pagina.siguiente
    if (cursor !== null) {
      if (visitados.has(cursor)) throw new Error('Cursor repetido.')
      visitados.add(cursor)
    }
  } while (cursor !== null)
  return estado
}
