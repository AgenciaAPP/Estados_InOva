import type { ContratoActivo } from '../../shared/supervisor.ts'
import { leerResponsables } from '../services/contratos.ts'

export type ListarActivos = (autorizados: readonly string[] | null) => Promise<ContratoActivo[]>
type Leer = (sql: string, parametros: string[]) => Promise<Record<string, unknown>[]>
const campos = 'nitCc, contratista, numeroContrato, supervisor, apoyoSupervision, apoyoLogistico'
export const camposDesempate = ['numeroContrato', 'contratista', 'supervisor', 'apoyoSupervision', 'apoyoLogistico'] as const
const desempate = camposDesempate.map(campo => `CAST(${campo} AS BINARY) ASC`).join(', ')

function identificador(valor: unknown) {
  if (valor == null) return null
  if (typeof valor === 'string') return valor
  if (typeof valor === 'number' && Number.isSafeInteger(valor)) return String(valor)
  throw new Error('Tipo de identificador contractual no verificable.')
}

export function crearListadoMysql(leer: Leer): ListarActivos {
  let esquemaVerificado = false
  return async autorizados => {
    if (autorizados && !autorizados.length) return []
    if (!esquemaVerificado) {
      await leer(`SELECT ${campos}, estado, fechaActualizacion FROM contratos LIMIT 0`, [])
      esquemaVerificado = true
    }
    // La autorización exacta se aplica antes de numerar las filas de cada cédula.
    const filtro = autorizados ? ` AND CAST(numeroContrato AS BINARY) IN (${autorizados.map(() => '?').join(', ')})` : ''
    const filas = await leer(`WITH contratos_ordenados AS (
  SELECT ${campos},
         ROW_NUMBER() OVER (
           PARTITION BY nitCc
           ORDER BY (fechaActualizacion IS NULL) ASC, fechaActualizacion DESC,
                    ${desempate}
         ) AS fila
  FROM contratos
  WHERE estado = ? AND numeroContrato LIKE CAST(? AS BINARY)${filtro}
)
SELECT ${campos} FROM contratos_ordenados
WHERE fila = 1
ORDER BY contratista, numeroContrato, nitCc`,
      ['EN EJECUCIÓN', 'PS%', ...(autorizados ?? [])])
    const resultado: ContratoActivo[] = []
    for (const fila of filas) {
      const numeroContrato = identificador(fila.numeroContrato)
      if (autorizados && (numeroContrato === null || !autorizados.includes(numeroContrato))) continue
      const { supervisor, apoyoSupervision, apoyoLogistico } = leerResponsables(fila)
      resultado.push({ cedula: identificador(fila.nitCc) ?? '', numeroContrato,
        contratista: typeof fila.contratista === 'string' ? fila.contratista : '', supervisor, apoyoSupervision, apoyoLogistico })
    }
    return resultado
  }
}
