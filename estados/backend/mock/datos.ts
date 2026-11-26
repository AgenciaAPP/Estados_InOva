import type { Contrato } from '../services/contratos.ts'
import type { TipoInforme } from '../../shared/consulta.ts'

interface FilaContrato extends Contrato {
  estado: string
  nitCc: string
  fechaActualizacion: string
}
const contratoPsAlfa: FilaContrato = {
  estado: 'EN EJECUCIÓN', nitCc: '00000001', numeroContrato: 'PS001', contratista: 'Contratista Alfa', fechaActualizacion: '2024-05-01',
  supervisor: 'Supervisora de prueba Alfa', apoyoSupervision: 'Apoyo de prueba Alfa', apoyoJuridico: null, apoyoLogistico: 'Logística de prueba Alfa',
}
export const contratos: FilaContrato[] = [
  {
    estado: 'EN EJECUCIÓN', nitCc: '00000001', numeroContrato: 'DEMO-010', contratista: 'Contratista Alfa', fechaActualizacion: '2025-01-01',
    supervisor: 'Supervisor anterior de prueba', apoyoSupervision: null, apoyoJuridico: null, apoyoLogistico: null,
  },
  {
    estado: 'EN EJECUCIÓN', nitCc: '00000001', numeroContrato: 'DEMO-001', contratista: 'Contratista Alfa', fechaActualizacion: '2026-01-01',
    supervisor: 'Supervisora ficticia del equipo Alfa', apoyoSupervision: 'Apoyo de supervisión de prueba Alfa',
    apoyoJuridico: 'Apoyo jurídico de prueba Alfa', apoyoLogistico: 'Apoyo logístico de prueba Alfa',
  },
  {
    estado: 'EN EJECUCIÓN', nitCc: '00000002', numeroContrato: 'DEMO-002', contratista: 'Contratista Beta', fechaActualizacion: '2026-02-01',
    supervisor: 'Supervisor de prueba Beta', apoyoSupervision: '', apoyoJuridico: '   ', apoyoLogistico: null,
  },
  {
    estado: 'TERMINADO', nitCc: '00000004', numeroContrato: null, contratista: 'Contratista Delta', fechaActualizacion: '2026-03-01',
    supervisor: null, apoyoSupervision: null, apoyoJuridico: null, apoyoLogistico: null,
  },
  {
    estado: 'EN EJECUCIÓN', nitCc: '00000005', numeroContrato: 'DEMO-0010', contratista: 'Contratista Épsilon', fechaActualizacion: '2026-04-01',
    supervisor: null, apoyoSupervision: null, apoyoJuridico: 'Apoyo jurídico de prueba Épsilon', apoyoLogistico: null,
  },
  contratoPsAlfa,
  { ...contratoPsAlfa, numeroContrato: 'PS0010', fechaActualizacion: '2024-03-01' },
  { ...contratoPsAlfa, numeroContrato: 'PS099', fechaActualizacion: '2024-04-01' },
  { ...contratoPsAlfa, nitCc: '00000006', contratista: 'Contratista de prueba sin envíos', numeroContrato: 'PS005' },
  { ...contratoPsAlfa, nitCc: '00000006', contratista: 'Contratista de prueba sin envíos', numeroContrato: 'PS006', fechaActualizacion: '2024-02-01' },
  { ...contratoPsAlfa, numeroContrato: 'PS002', estado: 'TERMINADO' },
  { ...contratoPsAlfa, numeroContrato: 'AB001' },
  { ...contratoPsAlfa, numeroContrato: '123PS001' },
  { ...contratoPsAlfa, numeroContrato: 'ps001' },
  {
    estado: 'EN EJECUCIÓN', nitCc: '00000002', numeroContrato: 'PS003', contratista: 'Contratista Beta', fechaActualizacion: '2024-05-02',
    supervisor: 'Supervisor de prueba Beta', apoyoSupervision: '', apoyoJuridico: null, apoyoLogistico: null,
  },
  {
    estado: 'EN EJECUCIÓN', nitCc: '00000005', numeroContrato: 'PS004', contratista: 'Contratista Épsilon', fechaActualizacion: '2024-05-03',
    supervisor: null, apoyoSupervision: null, apoyoJuridico: null, apoyoLogistico: null,
  },
]

export interface RegistroDemo {
  // Campo exclusivo del simulador. Su equivalente institucional está pendiente.
  contratoDemo: string
  date: string
  estado_id: string
}
export const registros: Record<TipoInforme, RegistroDemo[]> = {
  gestion: [
    { contratoDemo: 'PS006', date: '2024-02-12T12:00:00Z', estado_id: 'demo-aprobado' },
    { contratoDemo: 'PS001', date: '2026-05-05T12:00:00Z', estado_id: 'demo-aprobado' },
    { contratoDemo: 'PS0010', date: '2026-05-01T12:00:00Z', estado_id: 'demo-sin-equivalencia' },
    { contratoDemo: 'PS003', date: '2026-05-03T12:00:00Z', estado_id: 'demo-ajustes' },
    { contratoDemo: 'DEMO-010', date: '2026-05-01T12:00:00Z', estado_id: 'demo-sin-equivalencia' },
    { contratoDemo: 'DEMO-001', date: '2026-05-01T12:00:00Z', estado_id: 'demo-pendiente' },
    { contratoDemo: 'DEMO-002', date: '2026-05-03T12:00:00Z', estado_id: 'demo-ajustes' },
    { contratoDemo: 'DEMO-001', date: '2026-05-05T12:00:00Z', estado_id: 'demo-aprobado' },
  ],
  supervision: [
    { contratoDemo: 'PS001', date: '2026-05-04T12:00:00Z', estado_id: 'demo-revision' },
    { contratoDemo: 'PS004', date: '2026-05-20T12:00:00Z', estado_id: 'demo-aprobado' },
    { contratoDemo: 'DEMO-001', date: '2026-05-04T12:00:00Z', estado_id: 'demo-revision' },
    { contratoDemo: 'DEMO-0010', date: '2026-05-20T12:00:00Z', estado_id: 'demo-aprobado' },
  ],
  cobro: [
    { contratoDemo: 'PS001', date: '2026-05-06T12:00:00Z', estado_id: 'demo-pendiente' },
    { contratoDemo: 'PS004', date: '2026-05-21T12:00:00Z', estado_id: 'demo-aprobado' },
    { contratoDemo: 'DEMO-001', date: '2026-05-02T12:00:00Z', estado_id: 'demo-revision' },
    { contratoDemo: 'DEMO-001', date: '2026-05-06T12:00:00Z', estado_id: 'demo-pendiente' },
    { contratoDemo: 'DEMO-0010', date: '2026-05-21T12:00:00Z', estado_id: 'demo-aprobado' },
  ],
}
