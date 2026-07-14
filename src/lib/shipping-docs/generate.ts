// 发货资料生成器（服务端 Node）——**填真实模版**，格式 100% 原样：
//   送货单 Delivery Note(.xlsx) / 箱单 Packing List(.xlsx) → exceljs 载入模版填单元格
//   箱唛 Carton Label(.docx) → jszip 载入模版、按标签串填、每箱复制一张表
// 模版在 src/lib/shipping-docs/templates/{KA}/ ；抬头/地址/边框/公式全在模版里，只填变量。

import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readFileSync } from 'fs'
import path from 'path'
import { dnColumns, fieldValue, cartonCount, KA_TPL, type DocLine } from './config'

export type KaConfig = {
  customer_name: string; ship_to_address: string | null; customer_contact: string | null
  supplier_name: string; delivery_mode: string; doc_code: string | null
}
export type ShipDocInput = {
  poNumber: string; kaId: number; config: KaConfig
  meta: { date: string; deliveryNoteNumber: string; pallets: string; parcels: string }
  lines: DocLine[]
}

const TPL_DIR = path.join(process.cwd(), 'src/lib/shipping-docs/templates')
const tplPath = (dir: string, f: string) => path.join(TPL_DIR, dir, f)
const toBuf = (x: ExcelJS.Buffer | ArrayBuffer): Buffer => Buffer.from(x as ArrayBuffer)
const numOrStr = (s: string): number | string => { const n = Number(s); return s !== '' && Number.isFinite(n) ? n : s }

// ── 送货单：填模版 dn.xlsx ──
async function fillDeliveryNote(inp: ShipDocInput): Promise<Buffer | null> {
  const tpl = KA_TPL[inp.kaId]; if (!tpl?.dn) return null
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(tplPath(tpl.dir, 'dn.xlsx'))
  const ws = wb.worksheets[0]
  ws.getCell(tpl.dn.dnCell).value = inp.meta.deliveryNoteNumber
  ws.getCell(tpl.dn.palletsCell).value = numOrStr(inp.meta.pallets)
  ws.getCell(tpl.dn.parcelsCell).value = numOrStr(inp.meta.parcels)
  const cols = dnColumns(inp.kaId)
  inp.lines.forEach((l, i) => {
    const r = tpl.dn!.dataStartRow + i
    cols.forEach((c, ci) => { ws.getCell(r, 2 + ci).value = fieldValue(c, l) as any })   // B 列起
  })
  return toBuf(await wb.xlsx.writeBuffer())
}

// ── 箱单：填模版 pl.xlsx（每托盘一张，传入该托盘的行）──
async function fillPackingList(inp: ShipDocInput, lines: DocLine[]): Promise<Buffer> {
  const tpl = KA_TPL[inp.kaId]
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(tplPath(tpl.dir, 'pl.xlsx'))
  const ws = wb.worksheets[0]
  ws.getCell('D3').value = inp.meta.date
  ws.getCell('D4').value = lines.reduce((s, l) => s + l.qtySent, 0)
  lines.forEach((l, i) => {
    const r = 8 + i, cartons = cartonCount(l)
    ws.getCell('B' + r).value = l.po
    ws.getCell('C' + r).value = numOrStr(l.palletNo)
    ws.getCell('D' + r).value = l.model
    ws.getCell('E' + r).value = l.description
    ws.getCell('F' + r).value = l.unitsPerCarton
    ws.getCell('G' + r).value = l.cartonGrossKg
    ws.getCell('H' + r).value = cartons
    ws.getCell('I' + r).value = { formula: `F${r}*H${r}` }
    ws.getCell('J' + r).value = { formula: `G${r}*H${r}` }
  })
  return toBuf(await wb.xlsx.writeBuffer())
}

// ── 箱唛：填模版 carton.docx 的表格，每箱复制一张、分页 ──
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
const VAL_RPR = '<w:rPr><w:rFonts w:ascii="微软雅黑" w:hAnsi="微软雅黑" w:eastAsia="微软雅黑" w:cs="微软雅黑"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>'

// 稳健填法：把值作为新 run 追加到"标签所在段落"末尾（该段 </w:p> 之前）。
// 不依赖标签是否被拆成多 run（Komsa 模版 DESCRIPTION+独立：、QTY+独立: 都能正确处理）。
function appendToLabelParagraph(xml: string, label: string, value: string | number): string {
  const li = xml.indexOf(label); if (li < 0) return xml
  const pEnd = xml.indexOf('</w:p>', li); if (pEnd < 0) return xml
  const run = `<w:r>${VAL_RPR}<w:t xml:space="preserve">  ${esc(value)}</w:t></w:r>`
  return xml.slice(0, pEnd) + run + xml.slice(pEnd)
}

function fillCartonTable(tbl: string, l: DocLine, g: number, total: number, qtyThisBox: number, extra: 'boxNo' | 'hsCode'): string {
  let t = tbl
  // Box 编号 = 全发货全局：序号 g / 总箱数 total（不是"本 SKU 第几箱"）
  t = t.replace('Box  of ', `Box ${g} of ${total} `)
  t = t.replace('PO No. ', `PO No. ${esc(l.po)}`).replace('PO NO. ', `PO NO. ${esc(l.po)}`)
  t = appendToLabelParagraph(t, 'DESCRIPTION', l.description)
  t = appendToLabelParagraph(t, 'Model Name', l.model)
  if (l.ean) t = appendToLabelParagraph(t, 'EAN', l.ean)
  t = appendToLabelParagraph(t, 'QTY', qtyThisBox)
  if (extra === 'boxNo') t = appendToLabelParagraph(t, 'Box NO.', g)
  if (extra === 'hsCode') t = appendToLabelParagraph(t, 'HS Code', l.customerRef)
  return t
}

// 返回 null 表示该 KA 的箱唛模版尚未就绪（无表格结构）→ 跳过箱唛，DN/箱单照常出
async function fillCartonLabels(inp: ShipDocInput): Promise<Buffer | null> {
  const tpl = KA_TPL[inp.kaId]
  let raw: Buffer
  try { raw = readFileSync(tplPath(tpl.dir, 'carton.docx')) } catch { return null }
  const zip = await JSZip.loadAsync(raw)
  const docXml = await zip.file('word/document.xml')!.async('string')
  const m = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)   // 模版里那张 label 表（非贪婪取第一张）
  if (!m) return null                                   // 拍平无表格 → 视为未就绪
  const tbl = m[0]

  const total = inp.lines.reduce((s, l) => s + cartonCount(l), 0)   // 本次发货总箱数
  let g = 0
  const filled: string[] = []
  for (const l of inp.lines) {
    const N = cartonCount(l)
    for (let b = 1; b <= N; b++) {
      g++
      const qty = l.unitsPerCarton && l.unitsPerCarton > 0
        ? (b < N ? l.unitsPerCarton : l.qtySent - l.unitsPerCarton * (N - 1))
        : l.qtySent
      filled.push(fillCartonTable(tbl, l, g, total, qty, tpl.carton.extra))
    }
  }
  const newDoc = docXml.replace(tbl, filled.join(PAGE_BREAK))
  zip.file('word/document.xml', newDoc)
  return await zip.generateAsync({ type: 'nodebuffer' })
}

const cleanName = (s: string) => s.replace(/[^a-zA-Z0-9._+-]+/g, '_').replace(/^_+|_+$/g, '')

export async function generateShippingDocsZip(inp: ShipDocInput): Promise<Buffer> {
  const zip = new JSZip()
  const code = inp.config.doc_code || 'INIU'
  const pos = [...new Set(inp.lines.map(l => l.po).filter(Boolean))].join('+') || 'NA'
  const mmdd = (inp.meta.date || '').slice(5).replace('-', '') || 'nodate'
  const base = `${code}-PO${pos}`
  const folder = cleanName(base)
  const fn = (t: string) => cleanName(`${base}-${t}-${mmdd}`)

  // 送货单：一份（仅卡派）
  if (inp.config.delivery_mode === 'truck') {
    const dn = await fillDeliveryNote(inp)
    if (dn) zip.file(`${folder}/${fn('DeliveryNote')}.xlsx`, dn)
  }
  // 箱单：按托盘各一张
  const byPallet = new Map<string, DocLine[]>()
  inp.lines.forEach(l => { const k = l.palletNo?.trim() || '(unassigned)'; const a = byPallet.get(k); a ? a.push(l) : byPallet.set(k, [l]) })
  for (const [pallet, lines] of byPallet) {
    zip.file(`${folder}/${fn('PackingList-Pallet' + cleanName(pallet))}.xlsx`, await fillPackingList(inp, lines))
  }
  // 箱唛：一份，连续多页（模版未就绪的 KA 跳过，并放一个提示文件）
  const carton = await fillCartonLabels(inp)
  if (carton) zip.file(`${folder}/${fn('CartonLabel')}.docx`, carton)
  else zip.file(`${folder}/CartonLabel-模版待补充.txt`, `该渠道(${inp.config.customer_name})的箱唛 .docx 模版尚未就绪，暂未生成箱唛。DN/箱单已生成。`)
  return await zip.generateAsync({ type: 'nodebuffer' })
}
