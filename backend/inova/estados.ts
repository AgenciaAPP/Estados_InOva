import type { EstadoInforme } from '../../shared/consulta.ts'

export const ESTADOS_INOVA: Record<string, string> = {
  "BFJamNAYVlYs_iQ0FC_nXYL0dXi4SK8zUBPpGu7ygg==": "Corrección por Contadora",
  "fApaC8FobWVK71HGMTz3Zf72pho0BIZFOxmeGhCxLQ==": "Revisión Contadora",
  "p9ON5krwTl_XUHgwgcuNPS5Kutmvn_MfXJyZAbTI": "Corrección Logística",
  "tPC6E9SRzR2KxewtonSQjZj5H2zoobI7LUFO_dtR": "Revisión Logística",
  "rBHhQ-rmcTjJYnXAnRdUZRg3DIppPqRtpnkOcKFT": "Corrección por Supervisor",
  "eggtTNc137k-I41Kv-OH_kvZq0f3JQUHoytKD2yB": "Revisión Supervisor",
  "p81iCXmC1jZUwf_nmL3ROsdde9siZJggig4rH0rn": "Aprobado",
  "Ujkz89bb3wUboOaJAkilofiTZbHqCwBahakUoUwY": "Corrección por Apoyo",
  "d7iNEhnJ26ou8ojlQqXdkfVNAECOJD2k_K5Jp6BJ": "Revisión Apoyo",
}

export function estadoOficial(id: string): EstadoInforme | undefined {
  if (!Object.hasOwn(ESTADOS_INOVA, id)) return undefined
  const nombre = ESTADOS_INOVA[id]
  const tono = nombre === 'Aprobado' ? 'aprobado' : nombre.startsWith('Corrección') ? 'ajustes' : 'revision'
  return { nombre, tono }
}

export function clasificarEstado(id: unknown) {
  if (id == null) return { clase: 'ausente' } as const
  if (typeof id !== 'string') return { clase: 'tipo_invalido' } as const
  if (!id.trim()) return { clase: 'vacio' } as const
  const estado = estadoOficial(id)
  if (estado) return { clase: 'reconocido', estado } as const
  return { clase: 'desconocido' } as const
}
