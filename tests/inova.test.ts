import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { crearApp } from '../backend/app.ts'
import { configurar } from '../backend/config.ts'
import { opcionesInova } from '../backend/inova/config.ts'
import { inspeccionarFormulario } from '../backend/inova/estructura.ts'
import { crearConsultaInova } from '../backend/inova/informes.ts'
import { crearBuscadorMysql } from '../backend/mysql/contratos.ts'
import type { TipoInforme } from '../shared/consulta.ts'

const entorno = {
  INOVA_API_KEY: 'clave-ficticia', INOVA_BASE_URL: 'https://prueba.invalid',
  INOVA_RUTA_CONTRATO_GESTION: '/sections/0/answers/numeroContrato',
  INOVA_RUTA_CONTRATO_SUPERVISION: '/contrato',
  INOVA_RUTA_CONTRATO_ENTIDAD: '/identification',
}
const cfg = opcionesInova(entorno)
const contrato = 'PRUEBA+001/02'
const aprobado = 'p81iCXmC1jZUwf_nmL3ROsdde9siZJggig4rH0rn'
const revision = 'fApaC8FobWVK71HGMTz3Zf72pho0BIZFOxmeGhCxLQ=='
const fila = (tipo: TipoInforme, numero = contrato, estado = aprobado, date = '2026-01-15T00:00:00Z') => ({
  form_id: cfg.formularios[tipo], estado_id: estado, entity_id: 'entidad-ficticia', date,
  ...(tipo === 'gestion' ? { sections: [{ answers: { numeroContrato: numero } }] } : { contrato: numero }),
})
const pagina = (results: unknown[], next: string | null = null) => Response.json({ next, results })
const aprobadoPublico = { nombre: 'Aprobado', tono: 'aprobado' }
const revisionPublica = { nombre: 'Revisión Contadora', tono: 'revision' }
const avisoVerificacion = { aviso: 'No se pudo verificar el registro de este informe.' }
const avisoRed = { aviso: 'No se pudo consultar este informe.' }

test('El proveedor real exige MySQL, clave del backend y HTTPS. Los proveedores simulados prescinden de la clave', () => {
  assert.throws(() => configurar({ INOVA_SOURCE: 'real' }), /CONTRACT_SOURCE=mysql/)
  assert.throws(() => opcionesInova({}), /INOVA_API_KEY/)
  for (const url of ['http://prueba.invalid', 'https://usuario@prueba.invalid', 'https://prueba.invalid/?clave=a']) {
    assert.throws(() => opcionesInova({ ...entorno, INOVA_BASE_URL: url }), /HTTPS/)
  }
  assert.throws(() => opcionesInova({ ...entorno, INOVA_FORM_SUPERVISION: cfg.formularios.cobro }), /formularios/)
  assert.throws(() => opcionesInova({ ...entorno, INOVA_RUTA_CONTRATO_GESTION: '/entity_id' }), /identificador técnico/)
  assert.equal(configurar({ INOVA_SOURCE: 'mock' }).fuente, 'mock')
})

test('HTTP consulta los tres formularios con una búsqueda MySQL y aísla una caída de Cuenta de cobro', async () => {
  const sqlParams: string[][] = []
  const responsables = { supervisor: 'Supervisora de prueba', apoyoSupervision: null,
    apoyoJuridico: 'Apoyo jurídico ficticio', apoyoLogistico: 'Apoyo logístico ficticio' }
  const buscarContrato = crearBuscadorMysql(async (_sql, params) => {
    sqlParams.push(params)
    return [{ numeroContrato: contrato, contratista: 'Contratista de prueba', ...responsables }]
  })
  const destinos: string[] = []
  let fallaCobro = false
  const gestor = crearConsultaInova(cfg, async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, cfg.base)
    assert.equal(init?.method, 'GET')
    assert.equal(init.redirect, 'error')
    assert.equal(new Headers(init.headers).get('Authorization'), entorno.INOVA_API_KEY)
    if (url.pathname === '/api/entities/entidad-ficticia') return Response.json({ identification: contrato })
    const tipo = (['gestion', 'supervision', 'cobro'] as const).find(t =>
      decodeURIComponent(url.pathname) === '/api/forms/' + cfg.formularios[t] + '/records/')
    assert.ok(tipo)
    assert.deepEqual([...url.searchParams], [['identification', contrato]])
    destinos.push(tipo)
    if (tipo === 'cobro' && fallaCobro) return new Response(null, { status: 503 })
    return pagina([fila(tipo, contrato, tipo === 'gestion' ? aprobado : revision)])
  })
  const app = crearApp({ buscarContrato, consultarInforme: gestor }, 'mysql').listen(0, '127.0.0.1')
  await once(app, 'listening')
  try {
    const base = 'http://127.0.0.1:' + (app.address() as AddressInfo).port
    const res = await fetch(base + '/api/consulta-informes?cedula=00014&contrato=IGNORADO')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.numeroContrato, contrato)
    for (const [campo, nombre] of Object.entries(responsables)) assert.equal(body[campo], nombre)
    assert.deepEqual(body.informes, { gestion: aprobadoPublico, supervision: revisionPublica, cobro: revisionPublica })
    assert.deepEqual(body.fuentes, { contratos: 'mysql', informes: 'real' })
    const publica = await (await fetch(base + '/api/configuracion')).json()
    assert.deepEqual(publica, { demostracion: false, fuentes: body.fuentes })
    assert.deepEqual(sqlParams, [['00014']])
    assert.deepEqual(destinos.sort(), ['cobro', 'gestion', 'supervision'])
    assert.doesNotMatch(JSON.stringify(body), /clave-ficticia|estado_id|form_id|entity_id/)
    fallaCobro = true
    const parcial = await fetch(base + '/api/consulta-informes?cedula=00014')
    assert.equal(parcial.status, 200)
    assert.deepEqual((await parcial.json()).informes, { gestion: aprobadoPublico, supervision: revisionPublica,
      cobro: { aviso: 'No se pudo consultar la cuenta de cobro.' } })
  } finally { await new Promise<void>(resolve => app.close(() => resolve())) }
})

for (const ausente of ['gestion', 'supervision'] as const) {
  test(ausente + ' sin coincidencias exactas conserva el otro informe', async () => {
    const otro = ausente === 'gestion' ? 'supervision' : 'gestion'
    const consultar = crearConsultaInova(cfg, async input => decodeURIComponent(String(input)).includes(cfg.formularios[ausente])
      ? pagina([fila(ausente, contrato + '0'), fila(ausente, contrato.toLowerCase())]) : pagina([fila(otro)]))
    assert.equal(await consultar(ausente, contrato), null)
    assert.deepEqual(await consultar(otro, contrato), aprobadoPublico)
    assert.equal(await crearConsultaInova(cfg, async () => pagina([]))(ausente, contrato), null)
  })
}

test('Identificador desconocido recibe etiqueta neutral y diagnóstico sin datos personales', async () => {
  const logs: string[] = []
  const consultar = crearConsultaInova(cfg, async () => pagina([fila('gestion', contrato, '__proto__')]), msg => logs.push(msg))
  assert.deepEqual(await consultar('gestion', contrato), { nombre: 'Estado no identificado', tono: 'neutral' })
  assert.deepEqual(logs, ['[In-Ova] gestion ESTADO_DESCONOCIDO'])
})

test('Elige el envío más reciente entre páginas, con zona horaria y precisión submilisegundo', async () => {
  let peticiones = 0
  const consultar = crearConsultaInova(cfg, async input => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('identification'), contrato)
    if (++peticiones === 1) {
      const urlSiguiente = new URL(decodeURIComponent(url.pathname), cfg.base)
      urlSiguiente.searchParams.set('cursor', 'a+b==')
      return pagina([fila('gestion', contrato, revision, '2026-03-01T10:00:00.000001Z')], urlSiguiente.href)
    }
    assert.equal(url.searchParams.get('cursor'), 'a+b==')
    return pagina([fila('gestion', contrato, aprobado, '2026-03-01T05:00:00.000002-05:00')])
  })
  assert.deepEqual(await consultar('gestion', contrato), aprobadoPublico)
  assert.equal(peticiones, 2)
})

test('Fechas ambiguas, fecha imposible y formulario ajeno producen avisos locales', async () => {
  for (const filas of [
    [fila('gestion'), fila('gestion', contrato, revision)],
    [fila('gestion'), fila('gestion', contrato, revision, '2026-02-30T00:00:00Z')],
    [fila('gestion'), fila('gestion', contrato, revision, '')],
    [fila('supervision')],
  ]) {
    const consultar = crearConsultaInova(cfg, async () => pagina(filas), () => {})
    assert.deepEqual(await consultar('gestion', contrato), avisoVerificacion)
  }
})

test('Un enlace externo, un ciclo, una página incompleta o el límite descartan el resultado parcial', async () => {
  for (const caso of ['externo', 'filtro', 'ciclo', 'sin-next', 'limite']) {
    let intentos = 0
    const consultar = crearConsultaInova(cfg, async input => {
      const url = new URL(String(input))
      assert.equal(url.origin, cfg.base)
      ++intentos
      if (caso === 'sin-next') return Response.json({ results: [fila('gestion')] })
      if (caso === 'filtro') url.searchParams.set('identification', 'otro')
      url.searchParams.set('cursor', 'x')
      const next = caso === 'externo' ? 'https://otro.invalid/?cursor=x' : caso === 'limite' ? String(intentos) : url.href
      return pagina([fila('gestion')], next)
    }, () => {})
    assert.deepEqual(await consultar('gestion', contrato), avisoVerificacion)
    assert.equal(intentos, caso === 'limite' ? 20 : caso === 'ciclo' ? 2 : 1)
  }
})

for (const estadoHttp of [401, 403, 429, 500]) {
  test('HTTP ' + estadoHttp + ' queda limitado al formulario con fallo', async () => {
    const logs: string[] = []
    const consultar = crearConsultaInova(cfg, async input => decodeURIComponent(String(input)).includes(cfg.formularios.gestion)
      ? new Response('detalle privado', { status: estadoHttp }) : pagina([fila('supervision')]), msg => logs.push(msg))
    const resultados = await Promise.all([consultar('gestion', contrato), consultar('supervision', contrato)])
    assert.deepEqual(resultados, [avisoRed, aprobadoPublico])
    assert.deepEqual(logs, ['[In-Ova] gestion HTTP_' + estadoHttp])
  })
}

test('Un fallo de red y un plazo agotado durante el cuerpo no exponen detalles', async () => {
  const logs: string[] = []
  const red = crearConsultaInova(cfg, async () => { throw new Error('secreto') }, msg => logs.push(msg))
  assert.deepEqual(await red('gestion', contrato), avisoRed)
  const lento = crearConsultaInova(cfg, async (_url, init) => new Response(new ReadableStream({
    start(control) {
      const timer = setTimeout(() => control.close(), 500)
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); control.error(init.signal?.reason) }, { once: true })
    },
  })), msg => logs.push(msg), 15)
  assert.deepEqual(await lento('gestion', contrato), avisoRed)
  assert.deepEqual(logs, ['[In-Ova] gestion CONEXION_FALLIDA', '[In-Ova] gestion TIEMPO_AGOTADO'])
})

test('La falta de ruta o de valor verificable nunca equivale a una coincidencia o ausencia de registros', async () => {
  const opciones = opcionesInova({ INOVA_API_KEY: 'ficticia' })
  const consultar = crearConsultaInova(opciones, async () => pagina([{ ...fila('gestion'), entity_id: contrato }]), () => {})
  assert.deepEqual(await consultar('gestion', contrato), avisoVerificacion)
  const incompleta = crearConsultaInova(cfg, async () => pagina([fila('gestion'), { form_id: cfg.formularios.gestion }]), () => {})
  assert.deepEqual(await incompleta('gestion', contrato), avisoVerificacion)
})

test('Una ruta confirmada en entidad compara texto exacto y reutiliza la lectura dentro de cada informe', async () => {
  const opciones = opcionesInova({ ...entorno, INOVA_RUTA_CONTRATO_GESTION: '', INOVA_RUTA_CONTRATO_ENTIDAD: '/identification' })
  const ids: string[] = []
  const consultar = crearConsultaInova(opciones, async input => {
    const ruta = new URL(String(input)).pathname
    if (ruta.startsWith('/api/entities/')) {
      ids.push(ruta)
      return Response.json({ identification: ruta.endsWith('/parcial') ? contrato + '0' : contrato })
    }
    return pagina([fila('gestion'), fila('gestion', contrato, revision, '2026-01-16T00:00:00Z'), { ...fila('gestion'), entity_id: 'parcial' }])
  })
  assert.deepEqual(await consultar('gestion', contrato), revisionPublica)
  assert.deepEqual(ids, ['/api/entities/entidad-ficticia', '/api/entities/parcial'])
})

test('Inspección muestra rutas candidatas en answers serializado y anonimiza claves dinámicas', async () => {
  const registro = { ...fila('gestion'), sections: [{ answers: JSON.stringify({ numeroContrato: contrato, 'nombre-privado': contrato }) }] }
  const logs: string[] = []
  assert.ok(await inspeccionarFormulario(cfg, 'gestion', contrato, async () => pagina([registro]), msg => logs.push(msg)))
  assert.match(logs.join(' '), /\/sections\/0\/answers\/numeroContrato/)
  assert.match(logs.join(' '), /<campo>/)
  assert.doesNotMatch(logs.join(' '), /nombre-privado|entidad-ficticia|PRUEBA|clave-ficticia/)
  assert.deepEqual(await crearConsultaInova(cfg, async () => pagina([registro]))('gestion', contrato), aprobadoPublico)
})

test('Inspección de entidad solo ante una única entidad en una muestra completa', async () => {
  const candidatos = [{ ...fila('supervision', 'otro'), entity_id: contrato }]
  for (const next of [null, 'pagina2']) {
    let lecturasEntidad = 0
    const logs: string[] = []
    const resultado = await inspeccionarFormulario(cfg, 'supervision', contrato, async ruta => {
      if (String(ruta).includes('/api/forms/')) return pagina(candidatos, next)
      lecturasEntidad++
      return Response.json({ identification: contrato })
    }, msg => logs.push(msg))
    assert.equal(resultado, next === null)
    assert.equal(lecturasEntidad, next === null ? 1 : 0)
    assert.equal(logs.some(m => m.includes('Ruta candidata en la entidad: /identification')), next === null)
    assert.ok(!logs.join(' ').includes(contrato))
  }
})
