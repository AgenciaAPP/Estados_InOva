import type { EstadoInforme } from '../../shared/consulta.ts'

// Equivalencias ficticias exclusivas del adaptador de demostración.
const estadosDemo = new Map<string, EstadoInforme>([
  ['demo-pendiente', { nombre: 'Pendiente', tono: 'pendiente' }],
  ['demo-revision', { nombre: 'En revisión', tono: 'revision' }],
  ['demo-aprobado', { nombre: 'Aprobado', tono: 'aprobado' }],
  ['demo-ajustes', { nombre: 'Devuelto para ajustes', tono: 'ajustes' }],
])

export function interpretarEstadoDemo(id: string): EstadoInforme {
  return estadosDemo.get(id) ?? { nombre: 'Estado sin equivalencia', tono: 'neutral' }
}
