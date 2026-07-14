// 发货资料生成器（服务端 Node）：送货单 Delivery Note(.xlsx) · 箱单 Packing List(.xlsx) · 箱唛 Carton Label(.docx)
// 打成一个 zip 返回。抬头/地址来自 ka_shipping_config，列结构来自 ./config。

import ExcelJS from 'exceljs'
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } from 'docx'
import JSZip from 'jszip'
import { dnColumns, fieldValue, cartonCount, PL_COLUMNS, type DocLine } from './config'

export type KaConfig = {
  customer_name: string; ship_to_address: string | null; customer_contact: string | null
  supplier_name: string; delivery_mode: string; doc_code: string | null
}
export type ShipDocInput = {
  poNumber: string; kaId: number; config: KaConfig
  meta: { date: string; deliveryNoteNumber: string; pallets: string; parcels: string }
  lines: DocLine[]
}

const THIN = { style: 'thin' as const }
const border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const toBuf = (x: ExcelJS.Buffer | ArrayBuffer): Buffer => Buffer.from(x as ArrayBuffer)

// ── 送货单 Delivery Note ──
async function deliveryNote(inp: ShipDocInput): Promise<Buffer> {
  const { config: c, meta, lines } = inp
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Delivery Note')
  ws.getColumn(1).width = 22
  for (let i = 2; i <= 8; i++) ws.getColumn(i).width = 18

  ws.getCell('A1').value = 'Delivery Note'
  ws.getCell('A1').font = { bold: true, size: 16 }
  const kv = (row: number, k: string, v: string) => {
    ws.getCell(`A${row}`).value = k; ws.getCell(`A${row}`).font = { bold: true }
    ws.getCell(`B${row}`).value = v; ws.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'top' }
  }
  kv(3, 'Supplier:', c.supplier_name)
  kv(4, 'Customer:', c.customer_name)
  kv(5, 'Customer Address:', c.ship_to_address ?? '')
  kv(6, 'Customer Contact:', c.customer_contact ?? '')
  kv(7, 'Delivery Note Number:', meta.deliveryNoteNumber)
  kv(8, 'Number of Pallets:', meta.pallets)
  kv(9, 'Number of Parcels:', meta.parcels)

  const cols = dnColumns(inp.kaId)
  const hRow = 11
  cols.forEach((col, i) => {
    const cell = ws.getCell(hRow, i + 1)
    cell.value = col.header
    cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF3' } }
    cell.border = border; cell.alignment = { wrapText: true }
  })
  lines.forEach((l, r) => {
    cols.forEach((col, i) => {
      const cell = ws.getCell(hRow + 1 + r, i + 1)
      cell.value = fieldValue(col, l); cell.border = border
    })
  })
  // 合计（Qty Sent 列）
  const sentIdx = cols.findIndex(c2 => c2.field === 'qtySent')
  if (sentIdx >= 0) {
    const tr = hRow + 1 + lines.length
    ws.getCell(tr, Math.max(1, sentIdx)).value = 'TOTAL'
    ws.getCell(tr, Math.max(1, sentIdx)).font = { bold: true }
    const cell = ws.getCell(tr, sentIdx + 1)
    cell.value = lines.reduce((s, l) => s + l.qtySent, 0); cell.font = { bold: true }; cell.border = border
  }
  return toBuf(await wb.xlsx.writeBuffer())
}

// ── 箱单 Packing List（每托盘一张，SOP 里即"托盘标"）──
async function packingList(inp: ShipDocInput, lines: DocLine[]): Promise<Buffer> {
  const { config: c, meta } = inp
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Packing List')
  ws.getColumn(1).width = 16; ws.getColumn(4).width = 30
  for (const i of [2, 3, 5, 6, 7, 8, 9]) ws.getColumn(i).width = 16

  ws.getCell('A1').value = 'Packing List'; ws.getCell('A1').font = { bold: true, size: 16 }
  const totalQty = lines.reduce((s, l) => s + l.qtySent, 0)
  ws.getCell('A3').value = 'Packing List Date:'; ws.getCell('A3').font = { bold: true }; ws.getCell('B3').value = meta.date
  ws.getCell('D3').value = 'Customer:'; ws.getCell('D3').font = { bold: true }; ws.getCell('E3').value = c.customer_name
  ws.getCell('A4').value = 'Quantity:'; ws.getCell('A4').font = { bold: true }; ws.getCell('B4').value = totalQty
  ws.getCell('D4').value = 'Supplier:'; ws.getCell('D4').font = { bold: true }; ws.getCell('E4').value = c.supplier_name
  ws.getCell('A6').value = 'Packing Summary'; ws.getCell('A6').font = { bold: true }

  const hRow = 7
  PL_COLUMNS.forEach((h, i) => {
    const cell = ws.getCell(hRow, i + 1)
    cell.value = h; cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF3' } }
    cell.border = border; cell.alignment = { wrapText: true }
  })
  lines.forEach((l, r) => {
    const row = hRow + 1 + r
    const cartons = cartonCount(l)
    const vals: (string | number | null)[] = [
      l.po, l.palletNo, l.model, l.description,
      l.unitsPerCarton, l.cartonGrossKg, cartons,
      l.unitsPerCarton ? l.unitsPerCarton * cartons : l.qtySent,
      l.cartonGrossKg != null ? Math.round(l.cartonGrossKg * cartons * 100) / 100 : null,
    ]
    vals.forEach((v, i) => { const cell = ws.getCell(row, i + 1); cell.value = v as any; cell.border = border })
  })
  return toBuf(await wb.xlsx.writeBuffer())
}

// ── 箱唛 Carton Label（.docx，每箱一页）──
async function cartonLabels(inp: ShipDocInput): Promise<Buffer> {
  const { config: c, lines } = inp
  const addr = (c.ship_to_address ?? '').split('\n').filter(Boolean)
  const children: Paragraph[] = []
  const line = (t: string, opt: { bold?: boolean; size?: number } = {}) =>
    new Paragraph({ children: [new TextRun({ text: t, bold: opt.bold, size: (opt.size ?? 11) * 2 })] })

  lines.forEach((l, li) => {
    const N = cartonCount(l)
    for (let box = 1; box <= N; box++) {
      const qty = l.unitsPerCarton ? (box < N ? l.unitsPerCarton : l.qtySent - l.unitsPerCarton * (N - 1)) : l.qtySent
      children.push(
        new Paragraph({ children: [new TextRun({ text: `Box ${box} of ${N}`, bold: true, size: 28 })], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 4 } } }),
        line('SHIP TO:', { bold: true, size: 12 }),
        line(`PO No. ${l.po}`, { bold: true }),
        line(c.customer_name, { bold: true }),
        ...addr.map(a => line(a)),
        line(''),
        line(`DESCRIPTION：${l.description}`),
        line(`Model Name：${l.model}`),
        line(`EAN：${l.ean}`),
        line(`QTY: ${qty}`, { bold: true, size: 12 }),
        line(`Box NO.: ${box}`),
        new Paragraph({ children: [new TextRun({ text: 'PLEASE LEAVE THIS LABEL UNCOVERED', italics: true, size: 18 })], alignment: AlignmentType.CENTER, spacing: { before: 120 }, pageBreakBefore: false }),
      )
      const last = li === lines.length - 1 && box === N
      if (!last) children.push(new Paragraph({ text: '', pageBreakBefore: true }))
    }
  })

  const doc = new Document({ sections: [{ children }] })
  return await Packer.toBuffer(doc)
}

const cleanName = (s: string) => s.replace(/[^a-zA-Z0-9._+-]+/g, '_').replace(/^_+|_+$/g, '')

export async function generateShippingDocsZip(inp: ShipDocInput): Promise<Buffer> {
  const zip = new JSZip()
  // 命名规则：KA短码-PO{单号(可多个,+连接)}-{类型}-{MMDD}
  const code = inp.config.doc_code || 'INIU'
  const pos = [...new Set(inp.lines.map(l => l.po).filter(Boolean))].join('+') || 'NA'
  const mmdd = (inp.meta.date || '').slice(5).replace('-', '') || 'nodate'
  const base = `${code}-PO${pos}`
  const folder = cleanName(base)
  const fn = (t: string) => cleanName(`${base}-${t}-${mmdd}`)

  // 送货单：一份，含所有 PO 行；仅卡派需要（快递/EDI 不出）
  if (inp.config.delivery_mode === 'truck') zip.file(`${folder}/${fn('DeliveryNote')}.xlsx`, await deliveryNote(inp))

  // 箱单：按托盘分组，一个托盘一张
  const byPallet = new Map<string, DocLine[]>()
  inp.lines.forEach(l => { const k = l.palletNo?.trim() || '(unassigned)'; const a = byPallet.get(k); a ? a.push(l) : byPallet.set(k, [l]) })
  for (const [pallet, lines] of byPallet) {
    zip.file(`${folder}/${fn('PackingList-Pallet' + cleanName(pallet))}.xlsx`, await packingList(inp, lines))
  }

  // 箱唛：一份，连续多页（每箱一页）
  zip.file(`${folder}/${fn('CartonLabel')}.docx`, await cartonLabels(inp))
  return await zip.generateAsync({ type: 'nodebuffer' })
}
