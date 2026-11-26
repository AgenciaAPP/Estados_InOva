import { descripcionInforme, tieneEstadoActual, type Consulta, type Fuentes, type TipoInforme } from './consulta.ts'

export type ContratoActivo = Pick<Consulta, 'cedula' | 'contratista' | 'supervisor' | 'apoyoSupervision' | 'apoyoLogistico'> & {
  numeroContrato: string | null
}
export type FilaPanel = ContratoActivo & { informes: Consulta['informes'] }
export const columnasPanel = {
  cedula: 'Número de cédula', contratista: 'Nombre del contratista', numeroContrato: 'Número de contrato',
  supervisor: 'Supervisor', apoyoSupervision: 'Apoyo a la supervisión', apoyoLogistico: 'Apoyo logístico',
  gestion: 'Estado del informe de gestión', supervision: 'Estado del informe de supervisión',
  cobro: 'Estado de Cuenta de cobro y Pago de Seguridad Social',
} satisfies Record<keyof ContratoActivo | TipoInforme, string>
export type ColumnaPanel = keyof typeof columnasPanel
export interface FiltroPanel { columna: ColumnaPanel; texto: string }
export const maximoTextoFiltro = 512

export function esColumnaPanel(valor: unknown): valor is ColumnaPanel {
  return typeof valor === 'string' && Object.hasOwn(columnasPanel, valor)
}

export function leerFiltroPanel(columna: unknown, texto: unknown): FiltroPanel | null {
  return esColumnaPanel(columna) && typeof texto === 'string' && texto.length <= maximoTextoFiltro ? { columna, texto } : null
}

export function textoCeldaPanel(fila: FilaPanel, columna: ColumnaPanel, conPrefijo = false): string {
  if (columna === 'gestion' || columna === 'supervision' || columna === 'cobro') {
    const informe = fila.informes[columna]
    return (conPrefijo && tieneEstadoActual(informe) ? 'Estado actual: ' : '') + descripcionInforme(informe)
  }
  const valor = fila[columna]
  return valor?.trim() ? valor : 'No registrado'
}

export interface PaginaPanel {
  estado: 'enCurso' | 'completa' | 'fallida'
  fecha: string
  total: number | null
  candidatos: number | null
  procesados: number
  excluidos: number
  incluidos: number
  coincidencias: number
  pagina: number
  paginas: number
  filas: FilaPanel[]
}
export interface SesionPanel {
  csrf: string
  vence: number
  alcance: 'demo' | 'piloto' | 'general'
  fuentes: Fuentes
}
