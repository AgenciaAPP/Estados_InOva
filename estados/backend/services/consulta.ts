import type { BuscarContrato } from './contratos.ts'
import { buscarEstadoReciente, type LeerPagina } from './informes.ts'
import { envioSinEstado, type Consulta, type EstadoInforme, type Informe, type TipoInforme } from '../../shared/consulta.ts'

interface InformesDemo {
  leerPagina: LeerPagina
  interpretarEstado: (id: string) => EstadoInforme
}
export type ModalidadConsulta = 'individual' | 'supervisor'
export type Servicios = { buscarContrato: BuscarContrato } & (InformesDemo | {
  consultarInforme: (tipo: TipoInforme, contrato: string, modalidad: ModalidadConsulta) => Promise<Informe>
})

export async function consultar(cedula: string, servicios: Servicios) {
  const fila = await servicios.buscarContrato(cedula)
  if (!fila) return { error: 'Cédula no encontrada.' } as const
  const { numeroContrato, contratista, supervisor, apoyoSupervision, apoyoJuridico, apoyoLogistico } = fila
  if (!numeroContrato?.trim()) return { error: 'Contrato no encontrado.' } as const
  const informes = await consultarEstados(numeroContrato, servicios, 'individual')
  const datos: Consulta = { cedula, contratista, numeroContrato, supervisor, apoyoSupervision, apoyoJuridico, apoyoLogistico, informes }
  return { datos } as const
}

export async function consultarEstados(numeroContrato: string | null, servicios: Servicios, modalidad: ModalidadConsulta): Promise<Consulta['informes']> {
  async function informe(tipo: TipoInforme) {
    const contrato = numeroContrato
    if (!contrato?.trim()) return { aviso: 'Contrato sin número verificable.' }
    if ('consultarInforme' in servicios) return servicios.consultarInforme(tipo, contrato, modalidad)
    const id = await buscarEstadoReciente(servicios.leerPagina, tipo, contrato)
    if (id === null) return null
    if (modalidad === 'supervisor' && !id.trim()) return envioSinEstado
    return servicios.interpretarEstado(id)
  }
  const resultados = await Promise.allSettled([
    informe('gestion'), informe('supervision'), informe('cobro'),
  ])
  if (modalidad === 'individual' && resultados.every(r => r.status === 'rejected')) throw new Error('Falló la consulta de documentos.')
  function resultado(r: PromiseSettledResult<Informe>, documento: string): Informe {
    return r.status === 'fulfilled' ? r.value : { aviso: 'No se pudo consultar ' + documento + '.' }
  }
  return {
    gestion: resultado(resultados[0], 'el informe de gestión'),
    supervision: resultado(resultados[1], 'el informe de supervisión'),
    cobro: resultado(resultados[2], 'la cuenta de cobro'),
  }
}
