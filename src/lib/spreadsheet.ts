/**
 * SpreadsheetML 2003 工作簿生成（零依赖，原生多 sheet）。
 *
 * 为什么不用 HTML <table> + application/vnd.ms-excel：
 * 那种写法能"声明"出多个 tab，但所有 table 实际都落在第一张 sheet，其余是空白页。
 * SpreadsheetML 是单个 XML，<Worksheet> 是真正的分页单位。
 *
 * 注意：输出是纯 XML，写 Blob 时**不要加 BOM**，否则 <?xml ?> 声明失效。
 * Excel / WPS 都能直接打开；文件后缀用 .xls。
 */

export type XCell = {
  v: string | number | null
  num?: boolean        // true → 以数字写入（可参与 Excel 求和/透视）
  s?: string           // 样式 ID，见下方 STYLES
  span?: number        // 横向合并的列数（1 = 不合并）
}
export type XRow = XCell[]
export type XSheet = { name: string; rows: XRow[]; widths?: number[]; freezeRows?: number }

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 样式表：<base>=文本 / <base>0=整数 / <base>2=两位小数
const STYLES = `<Styles>`
  + `<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/><Font ss:FontName="Calibri" ss:Size="11"/></Style>`
  + `<Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>`
  + `<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/></Borders></Style>`
  + `<Style ss:ID="hdrL"><Font ss:Bold="1"/><Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>`
  + `<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/></Borders></Style>`
  + `<Style ss:ID="grp"><Font ss:Bold="1" ss:Color="#1D4ED8"/><Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style>`
  + `<Style ss:ID="grpA"><Font ss:Bold="1" ss:Color="#92400E"/><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style>`
  + `<Style ss:ID="code"><Font ss:Bold="1" ss:FontName="Consolas"/></Style>`
  + `<Style ss:ID="n0"><NumberFormat ss:Format="#,##0"/></Style>`
  + `<Style ss:ID="n2"><NumberFormat ss:Format="#,##0.00"/></Style>`
  + `<Style ss:ID="dim"><Font ss:Color="#CBD5E1"/><Alignment ss:Horizontal="Right"/></Style>`
  + `<Style ss:ID="sub"><Font ss:Bold="1"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/></Style>`
  + `<Style ss:ID="sub0"><Font ss:Bold="1"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0"/></Style>`
  + `<Style ss:ID="sub2"><Font ss:Bold="1"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/></Style>`
  + `<Style ss:ID="mon"><Font ss:Bold="1"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style>`
  + `<Style ss:ID="mon0"><Font ss:Bold="1"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0"/></Style>`
  + `<Style ss:ID="mon2"><Font ss:Bold="1"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/></Style>`
  + `<Style ss:ID="tot"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#475569" ss:Pattern="Solid"/></Style>`
  + `<Style ss:ID="tot0"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#475569" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0"/></Style>`
  + `<Style ss:ID="tot2"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#475569" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/></Style>`
  + `<Style ss:ID="note"><Font ss:Italic="1" ss:Color="#64748B"/></Style>`
  + `</Styles>`

function sheetXml({ name, rows, widths, freezeRows = 1 }: XSheet): string {
  const cols = (widths ?? []).map(w => `<Column ss:Width="${w}"/>`).join('')
  const body = rows.map(r => {
    const cells = r.map(c => {
      const span = c.span && c.span > 1 ? ` ss:MergeAcross="${c.span - 1}"` : ''
      const style = c.s ? ` ss:StyleID="${c.s}"` : ''
      if (c.v === null || c.v === '') return `<Cell${style}${span}/>`
      return `<Cell${style}${span}><Data ss:Type="${c.num ? 'Number' : 'String'}">${esc(c.v)}</Data></Cell>`
    }).join('')
    return `<Row>${cells}</Row>`
  }).join('')
  // sheet 名不能含 : \ / ? * [ ]，且最长 31 字符
  const safe = esc(name.replace(/[:\\/?*[\]]/g, '-')).slice(0, 31)
  const freeze = freezeRows > 0
    ? `<FreezePanes/><SplitHorizontal>${freezeRows}</SplitHorizontal>`
      + `<TopRowBottomPane>${freezeRows}</TopRowBottomPane><ActivePane>2</ActivePane>`
    : ''
  return `<Worksheet ss:Name="${safe}"><Table>${cols}${body}</Table>`
    + `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">${freeze}</WorksheetOptions></Worksheet>`
}

export function buildWorkbook(sheets: XSheet[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n`
    + `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"`
    + ` xmlns:o="urn:schemas-microsoft-com:office:office"`
    + ` xmlns:x="urn:schemas-microsoft-com:office:excel"`
    + ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`
    + STYLES + sheets.map(sheetXml).join('') + `</Workbook>`
}

/** 触发浏览器下载。filename 不含扩展名。 */
export function downloadWorkbook(xml: string, filename: string): void {
  // 纯 XML，绝不能加 BOM
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.xls`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
