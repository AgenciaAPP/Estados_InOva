import { descripcionInforme, tieneEstadoActual, type Informe } from '../../../shared/consulta.ts'

export function EstadoDocumento({ estado, sinRegistros = 'Sin registros' }: { estado: Informe; sinRegistros?: string }) {
  const descripcion = descripcionInforme(estado, sinRegistros)
  if (!estado || 'aviso' in estado) return <span className="no-record">{descripcion}</span>
  const nombre = estado.nombre.trim()
  return <>
    {tieneEstadoActual(estado) && <><strong>Estado actual:</strong>{' '}</>}
    <span className={'badge ' + (nombre ? estado.tono : 'neutral')}>{descripcion}</span>
  </>
}
