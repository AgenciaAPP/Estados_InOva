import type { ResponsablesContrato } from '../../shared/consulta.ts'

// El controlador enlaza la cédula al parámetro como cadena.
export const SQL_CONTRATO = `SELECT nitCc, contratista, numeroContrato, supervisor, apoyoSupervision, apoyoJuridico, apoyoLogistico
FROM contratos
WHERE nitCc = ?
ORDER BY fechaActualizacion DESC
LIMIT 1;`

export interface Contrato extends ResponsablesContrato {
  numeroContrato: string | null
  contratista: string
}
export type BuscarContrato = (cedula: string) => Promise<Contrato | null>

export function leerResponsables(fila: Partial<Record<keyof ResponsablesContrato, unknown>>): ResponsablesContrato {
  function nombre(campo: keyof ResponsablesContrato) {
    const valor = fila[campo]
    if (valor == null) return null
    if (typeof valor !== 'string') throw new Error(`El campo contratos.${campo} debe contener texto.`)
    return valor.trim() ? valor : null
  }
  return {
    supervisor: nombre('supervisor'), apoyoSupervision: nombre('apoyoSupervision'),
    apoyoJuridico: nombre('apoyoJuridico'), apoyoLogistico: nombre('apoyoLogistico'),
  }
}
