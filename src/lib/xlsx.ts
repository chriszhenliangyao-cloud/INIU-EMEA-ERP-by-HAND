/**
 * 零依赖 .xlsx 生成（真正的 OOXML / ZIP，官方 Microsoft Excel 能直接打开）。
 *
 * 之前的导出是「HTML <table> 存成 .xls」——WPS 能开，但官方 Excel 会拒绝/报错。
 * 这里手写一个最小 ZIP（store，无压缩）+ OOXML，产出合法 .xlsx。
 *
 * 用法：
 *   const blob = buildXlsx({ sheet:'Sheet1', rows, merges, cols, freezeRows, styles })
 *   downloadXlsx(blob, 'x.xlsx')
 * rows: XCell[][]；XCell = { v, s? }（s = styles 数组下标；数字自动按 number 写）。
 */

export type XlsxStyle = {
  bold?: boolean
  fill?: string        // 背景色 RRGGBB（不带 #）
  color?: string       // 字体色 RRGGBB
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
  border?: boolean
  numFmt?: string      // 自定义数字格式，如 '#,##0'
  size?: number
}
export type XlsxCell = { v: string | number | null; s?: number }
export type XlsxMerge = { r1: number; c1: number; r2: number; c2: number }   // 0-based inclusive

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colLetter = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }
const ref = (r: number, c: number) => `${colLetter(c)}${r + 1}`

// ── styles.xml：由 XlsxStyle[] 生成 fonts / fills / borders / cellXfs ──
function buildStyles(styles: XlsxStyle[]): string {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>']   // 0 = default
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']  // 0,1 保留
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom></border>']
  const numFmts: string[] = []
  const numFmtId: Record<string, number> = {}
  const cellXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']  // 0 = default

  for (const st of styles) {
    // font
    const fontParts = ['<sz val="' + (st.size ?? 11) + '"/>', '<name val="Calibri"/>']
    if (st.bold) fontParts.unshift('<b/>')
    if (st.color) fontParts.push('<color rgb="FF' + st.color + '"/>')
    fonts.push('<font>' + fontParts.join('') + '</font>')
    const fontId = fonts.length - 1
    // fill
    let fillId = 0
    if (st.fill) { fills.push('<fill><patternFill patternType="solid"><fgColor rgb="FF' + st.fill + '"/><bgColor indexed="64"/></patternFill></fill>'); fillId = fills.length - 1 }
    // border
    const borderId = st.border ? 1 : 0
    // numFmt
    let nf = 0
    if (st.numFmt) { if (numFmtId[st.numFmt] == null) { numFmtId[st.numFmt] = 164 + numFmts.length; numFmts.push('<numFmt numFmtId="' + numFmtId[st.numFmt] + '" formatCode="' + esc(st.numFmt) + '"/>') } nf = numFmtId[st.numFmt] }
    const align = st.align || st.wrap ? `<alignment${st.align ? ` horizontal="${st.align}"` : ''}${st.wrap ? ' wrapText="1"' : ''} vertical="center"/>` : ''
    cellXfs.push(`<xf numFmtId="${nf}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1"' : ''}>${align}</xf>`)
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>` : '') +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    `<borders count="${borders.length}">${borders.join('')}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
}

function buildSheet(rows: XlsxCell[][], merges: XlsxMerge[], cols: number[] | undefined, freezeRows: number): string {
  const colsXml = cols?.length
    ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
  const sheetData = rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      const sAttr = cell.s ? ` s="${cell.s}"` : ''
      if (cell.v == null || cell.v === '') return `<c r="${ref(r, c)}"${sAttr}/>`
      if (typeof cell.v === 'number') return `<c r="${ref(r, c)}"${sAttr}><v>${cell.v}</v></c>`
      return `<c r="${ref(r, c)}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${ref(m.r1, m.c1)}:${ref(m.r2, m.c2)}"/>`).join('')}</mergeCells>` : ''
  const pane = freezeRows > 0
    ? `<sheetView workbookViewId="0"><pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`
    : `<sheetView workbookViewId="0"/>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews>${pane}</sheetViews>${colsXml}<sheetData>${sheetData}</sheetData>${mergeXml}</worksheet>`
}

// ── 最小 ZIP（store）──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Uint8Array) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
const concat = (parts: Uint8Array[]) => { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length } return out }
const u16 = (n: number) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF])
const u32 = (n: number) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF])

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data); const sz = f.data.length
    const lh = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0), name, f.data])
    local.push(lh)
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]))
    offset += lh.length
  }
  const cd = concat(central); const eocd = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)])
  return concat([...local, cd, eocd])
}

export function buildXlsx({ sheet = 'Sheet1', rows, merges = [], cols, freezeRows = 0, styles = [] }: {
  sheet?: string; rows: XlsxCell[][]; merges?: XlsxMerge[]; cols?: number[]; freezeRows?: number; styles?: XlsxStyle[]
}): Blob {
  const enc = new TextEncoder()
  const parts: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: enc.encode(buildStyles(styles)) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(buildSheet(rows, merges, cols, freezeRows)) },
  ]
  return new Blob([zipStore(parts) as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function downloadXlsx(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename.endsWith('.xlsx') ? filename : filename + '.xlsx'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
