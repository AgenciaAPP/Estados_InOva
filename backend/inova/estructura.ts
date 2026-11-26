import type { TipoInforme } from '../../shared/consulta.ts'
import type { OpcionesInova } from './config.ts'
import { abrirAnswers, clienteInova, codigoFallo, ErrorProveedor, objeto } from './cliente.ts'
import { estadoOficial } from './estados.ts'

// Solo se imprimen nombres estructurales conocidos o de identificación. Una clave dinámica
// puede contener una cédula, un nombre o un correo. Las demás claves quedan anonimizadas.
const clavePublicable = /^(?:sections|answers|data|results|entity|attributes|value|valor|identification|identificacion|identifier|contract|contrato|(?:numero|num|nro|no)_?(?:de_?)?contrato|contrato_?(?:numero|num)|contract_?(?:number|no|identifier))$/i
const clavesTecnicas = new Set(['id', 'form_id', 'entity_id', 'section_id', 'professional_id', 'estado_id', 'colectiva_visit_id'])

function rutasCoincidentes(raiz: unknown, contrato: string) {
  const rutas = new Set<string>()
  let nodos = 0
  function visitar(valor: unknown, ruta: string, nivel: number) {
    if (++nodos > 15000 || nivel > 24) throw new ErrorProveedor('LIMITE_INSPECCION')
    if (typeof valor === 'string' && valor === contrato) rutas.add(ruta)
    if (Array.isArray(valor)) {
      valor.forEach((dato, i) => visitar(dato, ruta + '/' + i, nivel + 1))
    } else if (objeto(valor)) {
      for (const [clave, dato] of Object.entries(valor)) {
        if (clavesTecnicas.has(clave)) continue
        const etiqueta = clavePublicable.test(clave) ? clave : '<campo>'
        visitar(clave === 'answers' ? abrirAnswers(dato) : dato, ruta + '/' + etiqueta, nivel + 1)
      }
    }
  }
  visitar(raiz, '', 0)
  return rutas
}

export async function inspeccionarFormulario(opciones: OpcionesInova, tipo: TipoInforme, contrato: string,
  enviar: typeof fetch = fetch, informar: (mensaje: string) => void = console.log) {
  const signal = AbortSignal.timeout(10000)
  const cliente = clienteInova(opciones, enviar, signal)
  const nota = (mensaje: string) => informar('[inova:check] ' + tipo + ' · ' + mensaje)
  try {
    const { filas, siguiente } = await cliente.pagina(tipo, contrato, null)
    if (!filas.length) { nota('Primera página sin registros para inspeccionar.'); return false }
    const rutas = new Set<string>()
    const tiposAnswers = new Set<string>()
    const catalogo = new Set<string>()
    for (const fila of filas.slice(0, 5)) {
      for (const ruta of rutasCoincidentes(fila, contrato)) rutas.add(ruta)
      catalogo.add(typeof fila.estado_id === 'string' && estadoOficial(fila.estado_id) ? 'reconocido' : 'sin equivalencia verificable')
      if (Array.isArray(fila.sections)) for (const seccion of fila.sections) {
        if (objeto(seccion) && Object.hasOwn(seccion, 'answers')) {
          const valor = abrirAnswers(seccion.answers)
          tiposAnswers.add(Array.isArray(valor) ? 'array' : objeto(valor) ? 'objeto' : typeof valor === 'string' ? 'texto' : 'otro')
        }
      }
    }
    nota('results[].estado_id en la muestra: ' + [...catalogo].join(', ') + '.')
    if (tiposAnswers.size) nota('results[].sections[].answers: ' + [...tiposAnswers].join(', ') + '.')
    for (const ruta of rutas) nota('Ruta candidata en el registro: ' + ruta)
    if (rutas.size) return true
    nota('Sin coincidencia textual exacta en la muestra de la primera página (hasta cinco registros).')
    const ids = new Set(filas.map(fila => fila.entity_id))
    if (siguiente || filas.length > 5 || ids.size !== 1 || typeof filas[0].entity_id !== 'string') {
      nota('Entidad no verificada. Se requiere una muestra completa con una única entidad autorizada.')
      return false
    }
    const entidad = await cliente.entidad(filas[0].entity_id)
    const candidatas = rutasCoincidentes(entidad, contrato)
    for (const ruta of candidatas) nota('Ruta candidata en la entidad: ' + ruta)
    if (!candidatas.size) nota('Entidad sin coincidencia textual exacta. Confirma el campo de identificación con In-Ova.')
    return candidatas.size > 0
  } catch (error) {
    nota('Inspección incompleta (' + codigoFallo(error, signal) + ').')
    return false
  }
}
