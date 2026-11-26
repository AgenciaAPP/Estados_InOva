import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { TipoInforme } from '../shared/consulta.ts'
import { opcionesInova } from '../backend/inova/config.ts'
import { crearConsultaInova } from '../backend/inova/informes.ts'
import { verificarEntidad } from '../backend/inova/verificar-entidad.ts'

const cfg = opcionesInova({ INOVA_API_KEY: 'clave-sintetica', INOVA_BASE_URL: 'https://prueba.invalid' })
const contrato = '00019'
const aprobado = 'p81iCXmC1jZUwf_nmL3ROsdde9siZJggig4rH0rn'
const revision = 'fApaC8FobWVK71HGMTz3Zf72pho0BIZFOxmeGhCxLQ=='
const reciente = '2026-02-03T10:00:00.000002Z'
const anterior = '2026-02-03T05:00:00.000001-05:00'
function fila(tipo: TipoInforme, entidad: string, estado: unknown, date: unknown = anterior) {
  return { entity_id: entidad, estado_id: estado, date, form_id: cfg.formularios[tipo] }
}
const pagina = (results: unknown[], next: string | null = null) => Response.json({ results, next })

for (const tipo of ['gestion', 'supervision', 'cobro'] as const) {
  test(tipo + ' audita todas las páginas y clasifica los estados según el contrato de la entidad', async () => {
    const logs: string[] = []
    const peticiones: string[] = []
    const elegido = tipo === 'gestion' ? aprobado : revision
    const esperado = tipo === 'gestion' ? 'Aprobado' : 'Revisión Contadora'
    const enviar: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      peticiones.push(url.pathname)
      assert.equal(init?.method, 'GET')
      assert.equal(init.redirect, 'error')
      if (url.pathname.startsWith('/api/entities/')) {
        const id = url.pathname.split('/').at(-1)
        // La respuesta puede corroborar el ID opaco o identificar la entidad por el recurso solicitado.
        return Response.json(id === 'entidad-exacta' ? { id, identification: contrato } : { identification: '19' })
      }
      assert.equal(decodeURIComponent(url.pathname), '/api/forms/' + cfg.formularios[tipo] + '/records/')
      assert.equal(url.searchParams.get('identification'), contrato)
      if (url.searchParams.has('cursor')) return pagina([fila(tipo, 'entidad-exacta', elegido, reciente)])
      return pagina([
        fila(tipo, 'entidad-exacta', 'id-sin-mapa'), fila(tipo, 'entidad-exacta', null),
        fila(tipo, 'entidad-exacta', undefined), fila(tipo, 'entidad-exacta', ' '),
        fila(tipo, 'entidad-exacta', 7), fila(tipo, 'entidad-parcial', 'otro-id'),
        fila(tipo, 'entidad-parcial', elegido, '2030-01-01T00:00:00Z'),
      ], 'segunda')
    }
    // El diagnóstico examina la hipótesis de entidad aunque la configuración web tenga rutas directas.
    const opciones = { ...cfg, rutaContrato: { gestion: ['/ignorada'], supervision: ['/ignorada'] } }
    assert.ok(await verificarEntidad(opciones, tipo, contrato, enviar, msg => logs.push(msg), esperado))
    assert.equal(peticiones.length, 4)
    assert.match(logs.join('\n'), /Páginas=2, entidades leídas=2, entidades con \/identification exacta=1/)
    assert.match(logs.join('\n'), /id devuelto y corroborado=1, sin id devuelto=1/)
    assert.match(logs.join('\n'), /del contrato exacto: reconocidos=1, desconocidos=1, ausentes o nulos=2, vacíos=1, tipo inválido=1/)
    assert.match(logs.join('\n'), /con otra identificación: reconocidos=1, desconocidos=1/)
    assert.match(logs.join('\n'), /más reciente inequívoco/)
    assert.match(logs.join('\n'), /Contraste institucional: coincide/)
    if (tipo === 'cobro') {
      const huella = createHash('sha256').update('id-sin-mapa').digest('hex')
      assert.deepEqual(logs.filter(m => m.includes('SHA-256')), ['[inova:check] cobro · estado_id pendiente de equivalencia (SHA-256): ' + huella])
      const consultar = crearConsultaInova({ ...cfg, rutaEntidad: ['identification'] }, enviar)
      assert.deepEqual(await consultar(tipo, contrato), { nombre: esperado, tono: 'revision' })
    }
    for (const privado of [contrato, cfg.apiKey, 'entidad-exacta', 'id-sin-mapa', reciente, elegido, esperado]) {
      assert.ok(!logs.join(' ').includes(privado))
    }
  })
}

test('Cuenta de cobro distingue ausencia, identidad incierta y estado del último envío', async () => {
  const opciones = { ...cfg, rutaEntidad: ['identification'] }
  assert.equal(cfg.formularios.cobro, 'lmW2bbWMwGFOru75HQCIwvIaT6txPRPsCA==')
  function consulta(filas: unknown[], entidad: unknown = { identification: contrato }) {
    const leer: typeof fetch = async input => String(input).includes('/api/entities/') ? Response.json(entidad) : pagina(filas)
    return crearConsultaInova(opciones, leer, () => {})('cobro', contrato)
  }
  const previas = [fila('cobro', 'id', aprobado)]
  assert.equal(await consulta([]), null)
  assert.equal(await consulta(previas, { identification: contrato + '0' }), null)
  assert.deepEqual(await consulta(previas, { id: 'otra', identification: contrato }), { aviso: 'No se pudo verificar el contrato de la cuenta de cobro.' })
  assert.deepEqual(await consulta(previas, { identification: 19 }), { aviso: 'No se pudo verificar el contrato de la cuenta de cobro.' })
  assert.deepEqual(await consulta([...previas, fila('cobro', 'id', null, reciente)]), { aviso: 'El envío seleccionado de la cuenta de cobro no tiene un estado válido.' })
  assert.deepEqual(await consulta([...previas, fila('cobro', 'id', 'id-nuevo', reciente)]), { nombre: 'Estado no identificado', tono: 'neutral' })
  assert.deepEqual(await consulta([...previas, fila('cobro', 'id', revision)]), { aviso: 'Varios envíos de la cuenta de cobro comparten la fecha más reciente.' })
  assert.deepEqual(await consulta([...previas, fila('cobro', 'id', revision, null)]), { aviso: 'Las fechas disponibles no permiten identificar el último envío de la cuenta de cobro.' })
})

test('La relación de entidad y la selección web y diagnóstica fallan de forma segura', async () => {
  const viaEntidad = { ...cfg, rutaEntidad: ['identification'] }
  for (const entidad of [
    { id: 'otro-id', identification: contrato }, { identification: 19 }, { entity_id: contrato },
  ]) {
    const leer: typeof fetch = async input => String(input).includes('/api/entities/')
      ? Response.json(entidad) : pagina([fila('gestion', 'entidad-prueba', aprobado)])
    const mensajes: string[] = []
    assert.equal(await verificarEntidad(cfg, 'gestion', contrato, leer, m => mensajes.push(m)), false)
    assert.match(mensajes.join(' '), /Verificación inconclusa/)
    assert.ok(!mensajes.some(m => m.includes('Clasificación del estado seleccionado')))
    const servicio = crearConsultaInova(viaEntidad, leer, () => {})
    assert.deepEqual(await servicio('gestion', contrato), { aviso: 'No se pudo verificar el registro de este informe.' })
  }
})

test('Un ciclo, el límite de páginas y el límite de entidades nunca certifican un resultado parcial', async () => {
  for (const caso of ['ciclo', 'paginas', 'entidades']) {
    let paginas = 0
    let entidades = 0
    const logs: string[] = []
    const leer: typeof fetch = async input => {
      if (String(input).includes('/api/entities/')) {
        entidades++
        return Response.json({ identification: contrato })
      }
      paginas++
      if (caso === 'entidades') return pagina(Array.from({ length: 11 }, (_, i) => fila('gestion', 'id-' + i, aprobado)))
      return pagina([fila('gestion', 'repetida', aprobado)], caso === 'ciclo' ? 'repetido' : String(paginas))
    }
    assert.equal(await verificarEntidad(cfg, 'gestion', contrato, leer, m => logs.push(m)), false)
    assert.equal(paginas, caso === 'paginas' ? 20 : caso === 'ciclo' ? 2 : 1)
    assert.equal(entidades, caso === 'entidades' ? 10 : 1)
    assert.match(logs.join(' '), /Verificación inconclusa/)
    assert.ok(!logs.some(m => m.includes('Recorrido completo')))
  }
})

test('El diagnóstico distingue fechas ambiguas, estado desconocido, contrato ajeno y contraste institucional distinto', async () => {
  for (const [caso, mensaje] of [
    ['empate', 'FECHA_AMBIGUA'], ['fecha', 'FECHA_NO_VERIFICABLE'], ['desconocido', 'seleccionado: desconocido'],
    ['parcial', 'Sin coincidencia exacta'], ['contraste', 'Contraste institucional: difiere'],
  ]) {
    const logs: string[] = []
    const filas = [fila('supervision', 'id', caso === 'desconocido' ? 'privado' : aprobado, reciente)]
    if (caso === 'empate' || caso === 'fecha') filas.push(fila('supervision', 'id', revision, caso === 'empate' ? reciente : 'sin-zona'))
    const leer: typeof fetch = async input => String(input).includes('/api/entities/')
      ? Response.json({ identification: caso === 'parcial' ? contrato + '0' : contrato })
      : pagina(filas)
    assert.equal(await verificarEntidad(cfg, 'supervision', contrato, leer, m => logs.push(m), 'Revisión Contadora'), false)
    assert.ok(logs.some(m => m.includes(mensaje)))
    assert.doesNotMatch(logs.join(' '), /privado|00019|Revisión Contadora/)
  }
})
