import { Writable } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { columnasPanel, textoCeldaPanel, type ColumnaPanel, type FilaPanel } from '../../shared/supervisor.ts'

const columnas = Object.keys(columnasPanel) as ColumnaPanel[]
const anchos = [21, 36, 24, 32, 32, 32, 36, 36, 42]
const maximoBytes = 16 * 1024 * 1024
const maximoFilas = 50_000
const reloj = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function nombreExcel(ahora = new Date()) {
  const partes = Object.fromEntries(reloj.formatToParts(ahora).map(p => [p.type, p.value]))
  return `Estados_Contratos_PS_${partes.year}-${partes.month}-${partes.day}_${partes.hour}${partes.minute}.xlsx`
}

export class LimiteExcel extends Error {}
const limiteVolumen = 'El resultado excede el tamaño de exportación. Acota la búsqueda y vuelve a descargar.'

export async function generarExcel(filas: readonly FilaPanel[], limiteBytes = maximoBytes): Promise<Buffer> {
  if (!Number.isSafeInteger(limiteBytes) || limiteBytes < 1 || limiteBytes > maximoBytes) {
    throw new RangeError('El límite de exportación debe estar entre 1 byte y 16 MiB.')
  }
  if (filas.length > maximoFilas) throw new LimiteExcel(limiteVolumen)
  // Validar antes de abrir el escritor evita producir un libro parcial o truncar una celda.
  let bytesTexto = 0
  for (const fila of filas) {
    for (const columna of columnas) {
      const texto = textoCeldaPanel(fila, columna, true)
      if (texto.length > 32_767) throw new LimiteExcel('Una celda supera el límite de texto de Excel. Acota la búsqueda para exportar las demás filas.')
      bytesTexto += Buffer.byteLength(texto)
    }
    if (bytesTexto > limiteBytes) throw new LimiteExcel(limiteVolumen)
  }

  const fragmentos: Buffer[] = []
  let bytesZip = 0
  const salida = new Writable({ write(chunk: Buffer, _encoding, callback) {
    bytesZip += chunk.length
    if (bytesZip <= limiteBytes) fragmentos.push(chunk)
    callback()
  } })
  const { default: ExcelJS } = await import('exceljs')
  const libro = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: salida, useStyles: true, useSharedStrings: false })
  const hoja = libro.addWorksheet('Contratos activos', { views: [{ state: 'frozen', ySplit: 1 }] })
  hoja.columns = anchos.map(width => ({ width, style: { numFmt: '@', alignment: { vertical: 'middle', wrapText: true } } }))
  hoja.autoFilter = `A1:I${filas.length + 1}`
  const cabecera = hoja.addRow(Object.values(columnasPanel))
  cabecera.height = 44
  cabecera.eachCell(celda => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF125A4C' } }
  })
  cabecera.commit()
  for (const [indice, fila] of filas.entries()) {
    // ExcelJS guarda las cadenas como texto literal, también cuando empiezan por =, +, - o @.
    const valores = columnas.map(columna => textoCeldaPanel(fila, columna, true))
    const renglon = hoja.addRow(valores)
    const lineas = valores.map((valor, i) => valor.split(/\r\n?|\n/).reduce((n, linea) =>
      n + Math.max(1, Math.ceil(linea.length / (anchos[i] - 3))), 0))
    renglon.height = Math.min(409, Math.max(30, 6 + 16 * Math.max(...lineas)))
    renglon.commit()
    if ((indice + 1) % 256 === 0) await setImmediate()
  }
  hoja.commit()
  await libro.commit()
  if (bytesZip > limiteBytes) throw new LimiteExcel(limiteVolumen)
  return Buffer.concat(fragmentos, bytesZip)
}
