import type { Fuentes } from '../../shared/consulta.ts'
import type { SesionPanel } from '../../shared/supervisor.ts'

export function configurarPanel(env: NodeJS.ProcessEnv, fuente: Fuentes['contratos']) {
  const concurrencia = Number(env.SUPERVISOR_CONCURRENCY ?? '2')
  if (!Number.isInteger(concurrencia) || concurrencia < 1 || concurrencia > 8) throw new Error('SUPERVISOR_CONCURRENCY debe estar entre 1 y 8.')
  const modo = env.SUPERVISOR_SCOPE ?? 'pilot'
  if (!['pilot', 'all'].includes(modo)) throw new Error('SUPERVISOR_SCOPE debe ser pilot o all.')
  const alcance: SesionPanel['alcance'] = fuente === 'mock' ? 'demo' : modo === 'all' ? 'general' : 'piloto'
  let autorizados: string[] | null = null
  if (alcance === 'piloto') {
    try {
      const lista: unknown = JSON.parse(env.SUPERVISOR_PILOT_CONTRACTS || '[]')
      if (!Array.isArray(lista) || lista.length > 10 || lista.some(n => typeof n !== 'string' || !n.trim() || n.length > 256)) throw new Error()
      autorizados = [...new Set<string>(lista)]
    } catch { throw new Error('SUPERVISOR_PILOT_CONTRACTS requiere un arreglo JSON de hasta diez números de contrato como texto.') }
  }
  const origen = env.SUPERVISOR_ORIGIN || null
  if (origen) {
    let url: URL
    try { url = new URL(origen) } catch { throw new Error('SUPERVISOR_ORIGIN inválido.') }
    if (url.origin !== origen || url.protocol !== 'https:') throw new Error('SUPERVISOR_ORIGIN debe ser un origen HTTPS exacto.')
  }
  return { usuario: env.SUPERVISOR_USER || 'supervisor_agencia_app', origen, alcance, autorizados, concurrencia }
}
export type ConfigPanel = ReturnType<typeof configurarPanel>
