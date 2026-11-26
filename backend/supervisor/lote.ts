import { textoCeldaPanel, type FilaPanel, type FiltroPanel, type PaginaPanel } from '../../shared/supervisor.ts'
import { consultarEstados, type Servicios } from '../services/consulta.ts'
import type { ListarActivos } from './contratos.ts'
import type { ConfigPanel } from './config.ts'

function normalizar(texto: string) {
  return texto.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

export class Lote {
  fecha = new Date().toISOString()
  estado: PaginaPanel['estado'] = 'enCurso'
  private candidatos: number | null = null
  procesados = 0
  private incluidos = 0
  private filas: FilaPanel[] = []
  private cancelado = false

  cancelar() {
    this.cancelado = true
    this.filas = []
  }

  async ejecutar(listar: ListarActivos, servicios: Servicios, config: ConfigPanel) {
    try {
      const contratos = await listar(config.autorizados)
      this.candidatos = contratos.length
      let siguiente = 0
      let siguienteEnOrden = 0
      // null marca una posición ya resuelta que el filtro excluyó.
      const pendientes = new Map<number, FilaPanel | null>()
      const procesar = async () => {
        while (!this.cancelado && siguiente < contratos.length) {
          const indice = siguiente++
          const contrato = contratos[indice]
          const informes = await consultarEstados(contrato.numeroContrato, servicios, 'supervisor')
          if (this.cancelado) return
          const incluir = Object.values(informes).some(informe =>
            informe !== null && !('aviso' in informe && informe.sinEstadoConfirmado))
          pendientes.set(indice, incluir ? { ...contrato, informes } : null)
          this.procesados++
          if (incluir) this.incluidos++
          while (pendientes.has(siguienteEnOrden)) {
            const fila = pendientes.get(siguienteEnOrden)
            if (fila) this.filas.push(fila)
            pendientes.delete(siguienteEnOrden++)
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(config.concurrencia, contratos.length) }, procesar))
      if (!this.cancelado) this.estado = 'completa'
    } catch {
      this.estado = 'fallida'
    }
  }

  filasFiltradas(filtro?: FiltroPanel): readonly FilaPanel[] {
    const termino = filtro && this.estado === 'completa' ? normalizar(filtro.texto) : ''
    return filtro && termino
      ? this.filas.filter(fila => normalizar(textoCeldaPanel(fila, filtro.columna)).includes(termino))
      : this.filas
  }

  pagina(numero: number, filtro?: FiltroPanel, tamanoPagina = 25): PaginaPanel {
    const filas = this.filasFiltradas(filtro)
    const paginas = Math.ceil(filas.length / tamanoPagina)
    const pagina = Math.min(numero, paginas)
    const inicio = Math.max(0, pagina - 1) * tamanoPagina
    return { estado: this.estado, fecha: this.fecha, total: this.estado === 'completa' ? this.filas.length : null,
      candidatos: this.candidatos, procesados: this.procesados, incluidos: this.incluidos,
      excluidos: this.procesados - this.incluidos, coincidencias: filas.length, paginas, pagina,
      filas: filas.slice(inicio, inicio + tamanoPagina) }
  }
}
