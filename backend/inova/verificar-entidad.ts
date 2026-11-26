import { createHash } from 'node:crypto'
import type { TipoInforme } from '../../shared/consulta.ts'
import type { OpcionesInova } from './config.ts'
import { clienteInova, codigoFallo } from './cliente.ts'
import { clasificarEstado } from './estados.ts'
import { PLAZO_MS, revisarRegistros, seleccionarEnvio } from './informes.ts'

function contadores() {
  return { reconocido: 0, desconocido: 0, ausente: 0, vacio: 0, tipo_invalido: 0 }
}

function resumen(c: ReturnType<typeof contadores>) {
  return `reconocidos=${c.reconocido}, desconocidos=${c.desconocido}, ausentes o nulos=${c.ausente}, vacíos=${c.vacio}, tipo inválido=${c.tipo_invalido}`
}

export async function verificarEntidad(opciones: OpcionesInova, tipo: TipoInforme, contrato: string,
  enviar: typeof fetch = fetch, informar: (mensaje: string) => void = console.log, estadoEsperado?: string) {
  const nota = (mensaje: string) => informar('[inova:check] ' + tipo + ' · ' + mensaje)
  // La hipótesis se prueba aun con las rutas de producción en blanco. Nunca modifica el entorno.
  const prueba = { ...opciones, rutaContrato: { gestion: [], supervision: [] }, rutaEntidad: ['identification'] }
  const signal = AbortSignal.timeout(PLAZO_MS)
  const exactos = contadores()
  const otros = contadores()
  try {
    const recorrido = await revisarRegistros(prueba, tipo, contrato, clienteInova(prueba, enviar, signal),
      (exacto, clase) => { (exacto ? exactos : otros)[clase]++ })
    nota(`Recorrido completo. Páginas=${recorrido.paginas}, entidades leídas=${recorrido.entidades}, entidades con /identification exacta=${recorrido.entidadesExactas}.`)
    nota(`Entidades con id devuelto y corroborado=${recorrido.idsCorroborados}, sin id devuelto=${recorrido.entidades - recorrido.idsCorroborados}.`)
    nota('estado_id en filas del contrato exacto: ' + resumen(exactos) + '.')
    nota('estado_id en filas con otra identificación: ' + resumen(otros) + '.')
    if (tipo === 'cobro' && exactos.desconocido > 0) {
      const pendientes = new Set<string>()
      for (const { estado } of recorrido.filas) {
        if (typeof estado === 'string' && clasificarEstado(estado).clase === 'desconocido') {
          pendientes.add(createHash('sha256').update(estado, 'utf8').digest('hex'))
        }
      }
      for (const huella of pendientes) nota('estado_id pendiente de equivalencia (SHA-256): ' + huella)
    }
    const registro = seleccionarEnvio(recorrido.filas)
    if (!registro) {
      nota('Sin coincidencia exacta con MySQL. Este caso no confirma /identification.')
      return false
    }
    nota(recorrido.filas.length === 1 ? 'Selección: único registro exacto.' :
      'Selección: envío más reciente inequívoco por results[].date.')
    const estado = clasificarEstado(registro.estado)
    nota('Clasificación del estado seleccionado: ' + estado.clase + '.')
    if (estado.clase !== 'reconocido') return false
    if (estadoEsperado) {
      const coincide = estado.estado.nombre === estadoEsperado
      nota(coincide ? 'Contraste institucional: coincide.' : 'Contraste institucional: difiere.')
      return coincide
    }
    return true
  } catch (error) {
    nota('Verificación inconclusa (' + codigoFallo(error, signal) + '). Sin selección válida.')
    return false
  }
}
