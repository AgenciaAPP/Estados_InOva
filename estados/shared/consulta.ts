export type TipoInforme = 'gestion' | 'supervision' | 'cobro'
export interface Fuentes {
  contratos: 'mock' | 'mysql'
  informes: 'mock' | 'real'
}
export interface EstadoInforme {
  nombre: string
  tono: 'pendiente' | 'revision' | 'aprobado' | 'ajustes' | 'neutral'
}
export type Informe = EstadoInforme | { aviso: string; sinEstadoConfirmado?: true } | null
export function tieneEstadoActual(estado: Informe) {
  return estado !== null && 'nombre' in estado && Boolean(estado.nombre.trim()) && estado.tono !== 'neutral'
}
export function descripcionInforme(estado: Informe, sinRegistros = 'Sin registros') {
  if (estado === null) return sinRegistros
  return 'aviso' in estado ? estado.aviso : estado.nombre.trim() || 'Estado no identificado'
}
export const envioSinEstado = { aviso: 'El último envío no tiene estado registrado.', sinEstadoConfirmado: true } as const
export interface ResponsablesContrato {
  supervisor: string | null
  apoyoSupervision: string | null
  apoyoJuridico: string | null
  apoyoLogistico: string | null
}
export interface Consulta extends ResponsablesContrato {
  cedula: string
  numeroContrato: string
  contratista: string
  informes: Record<TipoInforme, Informe>
}
export type ResultadoConsulta = Consulta & { fuentes: Fuentes }

export function validarCedula(valor: unknown): string | null {
  if (valor == null || valor === '') return 'Ingresa tu número de cédula.'
  if (typeof valor !== 'string' || !/^[0-9]+$/.test(valor)) {
    return 'Ingresa solo números, sin puntos, espacios ni guiones.'
  }
  return null
}
