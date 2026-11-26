import { createInterface } from 'node:readline/promises'
import { validarCedula } from '../shared/consulta.ts'
import { configurar } from '../backend/config.ts'
import { opcionesInova } from '../backend/inova/config.ts'
import { inspeccionarFormulario } from '../backend/inova/estructura.ts'
import { verificarEntidad } from '../backend/inova/verificar-entidad.ts'
import { abrirMysql, diagnosticoMysql } from '../backend/mysql/contratos.ts'

class AvisoDelCheck extends Error {}

function preparar() {
  try {
    const config = configurar({ ...process.env, INOVA_SOURCE: 'mock' })
    if (config.fuente !== 'mysql') throw new Error('inova:check requiere CONTRACT_SOURCE=mysql.')
    return { mysql: config.mysql, opciones: opcionesInova(process.env) }
  } catch (error) {
    // Los validadores de configuración producen mensajes sin valores de entorno.
    throw new AvisoDelCheck(error instanceof Error ? error.message : 'Configuración inválida.')
  }
}

async function comprobar() {
  const args = process.argv.slice(2)
  const estructura = args.includes('--estructura')
  if (args.some(arg => arg !== '--estructura' && arg !== '--cobro')) {
    throw new AvisoDelCheck('inova:check admite --cobro y --estructura.')
  }
  const { mysql, opciones } = preparar()
  if (process.stdin.isTTY) throw new AvisoDelCheck('Introduce la cédula autorizada por entrada estándar según el README.')
  const entrada = createInterface({ input: process.stdin, terminal: false })
  let cedula: string | undefined
  try {
    for await (const linea of entrada) { cedula = linea; break }
  } finally { entrada.close() }
  if (!cedula || validarCedula(cedula)) throw new AvisoDelCheck('Se requiere una cédula de prueba válida por entrada estándar.')
  const db = abrirMysql(mysql)
  let contrato: string | null | undefined
  try {
    await db.verificar()
    contrato = (await db.buscarContrato(cedula))?.numeroContrato
  } catch (error) { throw new AvisoDelCheck(diagnosticoMysql(error)) }
  finally { await db.cerrar() }
  if (!contrato) throw new AvisoDelCheck('No se encontró un contrato para el caso autorizado.')
  let completas = true
  const formularios = args.includes('--cobro') ? ['cobro'] as const : ['gestion', 'supervision', 'cobro'] as const
  for (const formulario of formularios) {
    const esperado = process.env['INOVA_CHECK_ESTADO_' + formulario.toUpperCase()]
    const verificado = estructura ? await inspeccionarFormulario(opciones, formulario, contrato)
      : await verificarEntidad(opciones, formulario, contrato, fetch, console.log, esperado)
    if (!verificado) completas = false
  }
  console.log(estructura
    ? '[inova:check] Confirma el significado y la estabilidad de las rutas candidatas para cada formulario.'
    : '[inova:check] La comprobación corresponde al caso autorizado. La activación del proveedor es independiente.')
  if (!completas) process.exitCode = 2
}
comprobar().catch((error: unknown) => {
  console.error('[inova:check] ' + (error instanceof AvisoDelCheck ? error.message : 'No se pudo completar la comprobación.'))
  process.exitCode = 1
})
