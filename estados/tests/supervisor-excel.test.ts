import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { generarExcel, LimiteExcel, nombreExcel } from '../backend/supervisor/excel.ts'
import { columnasPanel, type FilaPanel } from '../shared/supervisor.ts'

const fila: FilaPanel = {
  cedula: '000000000000000001', numeroContrato: '000045', contratista: '=1+1', supervisor: '+3',
  apoyoSupervision: '-1', apoyoLogistico: '@ejemplo',
  informes: { gestion: { nombre: 'Aprobado', tono: 'aprobado' }, supervision: null, cobro: { aviso: 'No se pudo consultar la cuenta de cobro.' } },
}

test('El XLSX conserva los textos literales, ceros, estados y formato de las nueve columnas', async () => {
  const largo = 'Equipo de supervisión & logística <demo> '.repeat(20)
  const bytes = await generarExcel([fila, { ...fila, contratista: largo, supervisor: null, apoyoLogistico: '   ',
    informes: { ...fila.informes, gestion: { nombre: 'Estado no identificado', tono: 'neutral' } } }])
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(Uint8Array.from(bytes).buffer)
  assert.deepEqual(libro.worksheets.map(h => h.name), ['Contratos activos'])
  const h = libro.worksheets[0]
  assert.equal(h.columnCount, 9)
  assert.equal(h.rowCount, 3)
  assert.deepEqual(h.getRow(1).values, [, ...Object.values(columnasPanel)])
  assert.equal(h.autoFilter, 'A1:I3')
  assert.ok(h.views.some(v => v.state === 'frozen' && v.ySplit === 1))
  h.getRow(1).eachCell(c => { assert.equal(c.font.bold, true); assert.equal(c.fill.type, 'pattern') })
  assert.deepEqual(h.getRow(2).values, [, '000000000000000001', '=1+1', '000045', '+3', '-1', '@ejemplo',
    'Estado actual: Aprobado', 'Sin registros', 'No se pudo consultar la cuenta de cobro.'])
  h.eachRow(r => r.eachCell(c => {
    assert.equal(c.type, ExcelJS.ValueType.String)
    assert.equal(c.formula, undefined)
    assert.equal(c.alignment.wrapText, true)
  }))
  assert.equal(h.getCell('A2').numFmt, '@')
  assert.equal(h.getCell('C2').numFmt, '@')
  assert.equal(h.getCell('B3').text, largo)
  assert.equal(h.getCell('D3').text, 'No registrado')
  assert.equal(h.getCell('F3').text, 'No registrado')
  assert.equal(h.getCell('G3').text, 'Estado no identificado')
  assert.ok(h.getRow(3).height > h.getRow(2).height)
})

test('El nombre de descarga utiliza la fecha y los minutos de Bogotá incluso al cambiar de día', () => {
  assert.equal(nombreExcel(new Date('2026-11-25T01:30:59Z')), 'Estados_Contratos_PS_2026-11-24_2030.xlsx')
  assert.equal(nombreExcel(new Date('2026-11-25T05:00:00Z')), 'Estados_Contratos_PS_2026-11-25_0000.xlsx')
})

test('La exportación informa los límites de filas, celda y volumen sin entregar un archivo parcial', async () => {
  await assert.rejects(generarExcel(Array(50_001).fill(fila)), LimiteExcel)
  await assert.rejects(generarExcel([{ ...fila, contratista: 'a'.repeat(32_768) }]), LimiteExcel)
  await assert.rejects(generarExcel(Array(600).fill({ ...fila, contratista: 'a'.repeat(32_000) })), LimiteExcel)
})
