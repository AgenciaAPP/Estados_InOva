const formulariosOficiales = {
  gestion: 'nPozbdjobkkpiIsdgI0zFXrvPdUm8FgJRw==',
  supervision: '_qCVahYhHpXHyjBWlcl5ozFNf4UxLTxO_w==',
  cobro: 'lmW2bbWMwGFOru75HQCIwvIaT6txPRPsCA==',
}

function rutaContrato(valor?: string): string[] {
  if (!valor) return []
  if (!valor.startsWith('/') || /~(?![01])/.test(valor)) {
    throw new Error('La ruta del contrato en In-Ova debe ser un puntero JSON válido.')
  }
  const ruta = valor.slice(1).split('/').map(campo => campo.replaceAll('~1', '/').replaceAll('~0', '~'))
  if (['entity_id', 'form_id', 'estado_id', 'colectiva_visit_id', 'section_id', 'professional_id'].includes(ruta.at(-1)!)) {
    throw new Error('Un identificador técnico de In-Ova no verifica el número de contrato.')
  }
  return ruta
}

export function opcionesInova(env: NodeJS.ProcessEnv) {
  const apiKey = env.INOVA_API_KEY
  if (!apiKey || !/^[\x21-\x7e]+$/.test(apiKey)) throw new Error('INOVA_SOURCE=real requiere una INOVA_API_KEY válida en el backend.')
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('In-Ova requiere la validación del certificado HTTPS.')
  let base: URL
  try { base = new URL(env.INOVA_BASE_URL ?? 'https://databridge-api.in-ova-bi.co') }
  catch { throw new Error('INOVA_BASE_URL inválida.') }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('INOVA_BASE_URL debe ser un origen HTTPS sin credenciales, ruta o parámetros.')
  }
  const formularios = {
    gestion: env.INOVA_FORM_GESTION?.trim() || formulariosOficiales.gestion,
    supervision: env.INOVA_FORM_SUPERVISION?.trim() || formulariosOficiales.supervision,
    cobro: env.INOVA_FORM_COBRO?.trim() || formulariosOficiales.cobro,
  }
  const ids = Object.values(formularios)
  if (ids.some(id => !/^[A-Za-z0-9_+-]+=*$/.test(id)) || new Set(ids).size !== ids.length ||
      [formularios.gestion, formularios.supervision].includes(formulariosOficiales.cobro)) {
    throw new Error('Revisa los identificadores de formularios de In-Ova. Cada informe requiere su propio formulario.')
  }
  return {
    base: base.origin, apiKey, formularios,
    rutaEntidad: rutaContrato(env.INOVA_RUTA_CONTRATO_ENTIDAD),
    rutaContrato: {
      gestion: rutaContrato(env.INOVA_RUTA_CONTRATO_GESTION),
      supervision: rutaContrato(env.INOVA_RUTA_CONTRATO_SUPERVISION),
    },
  }
}
export type OpcionesInova = ReturnType<typeof opcionesInova>
