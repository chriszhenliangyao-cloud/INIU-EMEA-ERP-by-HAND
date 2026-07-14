'use client'

// Shipment Builder：从 To Ship/Partial 勾选的行（同一 KA、可跨多 PO）合并制作发货资料。
// 每行填 发货量/每箱装量/每箱毛重/托盘 → 自动算箱数&总毛重 → POST /api/shipping-docs 出 zip；
// 「生成并发货」再逐行写 po_shipment 批次 + 把每箱装量存回 sku 主数据。

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils'
import type { OpsRow } from '../../po/_ops'

type Line = {
  lineId: number; sku_id: number; po: string; model: string; description: string; ean: string
  qtyOrdered: number; remaining: number
  qtySent: string; unitsPerCarton: string; cartonGrossKg: string; palletNo: string; customerRef: string
  origUpc: number | null
}
type KaCfg = { customer_name: string; delivery_mode: string; doc_code: string | null }

const cartons = (l: Line) => { const q = +l.qtySent, u = +l.unitsPerCarton; return u > 0 && q > 0 ? Math.ceil(q / u) : (q > 0 ? 1 : 0) }
const totalKg = (l: Line) => { const w = +l.cartonGrossKg; return w > 0 ? Math.round(w * cartons(l) * 100) / 100 : 0 }

export function ShipmentBuilder({ rows, kaId, onClose, onShipped }: {
  rows: OpsRow[]; kaId: number; onClose: () => void; onShipped: () => void
}) {
  const supabase = useRef(createClient()).current
  const router = useRouter()
  const today = useRef(new Date().toISOString().slice(0, 10)).current

  const [cfg, setCfg] = useState<KaCfg | null>(null)
  const [lines, setLines] = useState<Line[]>(() => rows.map(r => {
    const remaining = r.qty - (r.delivered_qty ?? 0)
    return {
      lineId: r.id, sku_id: r.sku_id, po: r.po_number ?? '', model: r.sku_code, description: r.sku_name, ean: r.ean ?? '',
      qtyOrdered: r.qty, remaining, qtySent: String(remaining),
      unitsPerCarton: r.units_per_carton != null ? String(r.units_per_carton) : '', cartonGrossKg: '', palletNo: '', customerRef: '',
      origUpc: r.units_per_carton,
    }
  }))
  const [dnNumber, setDnNumber] = useState('')
  const [pallets, setPallets] = useState('')
  const [parcels, setParcels] = useState('')
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState<'' | 'docs' | 'ship'>('')

  useEffect(() => {
    supabase.from('ka_shipping_config').select('customer_name, delivery_mode, doc_code').eq('ka_id', kaId).single()
      .then(({ data }) => {
        setCfg(data as KaCfg)
        if (data?.doc_code) setDnNumber(`INIU${data.doc_code}${today.slice(5).replace('-', '')}`)
      })
  }, [kaId, supabase, today])

  const pos = useMemo(() => [...new Set(lines.map(l => l.po).filter(Boolean))], [lines])
  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  // 自动统计：托盘数 = 不同托盘号数；总箱数/总毛重
  const distinctPallets = useMemo(() => new Set(lines.map(l => l.palletNo.trim()).filter(Boolean)).size, [lines])
  const totQty = lines.reduce((s, l) => s + (+l.qtySent || 0), 0)
  const totCartons = lines.reduce((s, l) => s + cartons(l), 0)
  const totWeight = lines.reduce((s, l) => s + totalKg(l), 0)

  const isTruck = cfg?.delivery_mode === 'truck'
  const docChips = [isTruck && 'Delivery Note', 'Packing List', 'Carton Labels'].filter(Boolean) as string[]

  const validate = (): string | null => {
    for (const l of lines) {
      const q = Math.floor(+l.qtySent)
      if (!Number.isFinite(q) || q <= 0) return `${l.model}：发货量必须 > 0`
      if (q > l.remaining) return `${l.model}：发货量 ${q} 超过可发 ${l.remaining}`
    }
    return null
  }

  const callApi = async (): Promise<boolean> => {
    const payload = {
      poNumber: pos.join('+'), kaId,
      meta: { date, deliveryNoteNumber: dnNumber, pallets: pallets || String(distinctPallets), parcels },
      lines: lines.map(l => ({
        po: l.po, description: l.description, ean: l.ean, model: l.model, supplierSku: l.model, customerRef: l.customerRef,
        qtyOrdered: l.qtyOrdered, qtySent: Math.floor(+l.qtySent),
        unitsPerCarton: l.unitsPerCarton === '' ? null : +l.unitsPerCarton,
        cartonGrossKg: l.cartonGrossKg === '' ? null : +l.cartonGrossKg, palletNo: l.palletNo,
      })),
    }
    const res = await fetch('/api/shipping-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(`生成失败: ${j.error ?? res.status}`); return false }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition'); const name = cd?.match(/filename="(.+?)"/)?.[1] ?? 'ShippingDocs.zip'
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  }

  // 每箱装量变化 → 存回 sku 主数据（去重按 sku_id）
  const persistUpc = async () => {
    const seen = new Set<number>(); const ups: { sku_id: number; upc: number }[] = []
    for (const l of lines) {
      const u = l.unitsPerCarton === '' ? null : +l.unitsPerCarton
      if (u != null && u > 0 && u !== l.origUpc && !seen.has(l.sku_id)) { seen.add(l.sku_id); ups.push({ sku_id: l.sku_id, upc: u }) }
    }
    for (const { sku_id, upc } of ups) await supabase.from('sku').update({ units_per_carton: upc }).eq('id', sku_id)
  }

  const onGenerate = async () => {
    const err = validate(); if (err) { alert(err); return }
    setBusy('docs')
    const ok = await callApi()
    await persistUpc()
    setBusy('')
    if (ok) router.refresh()
  }

  const onGenerateAndShip = async () => {
    const err = validate(); if (err) { alert(err); return }
    if (!confirm(`生成资料并发货？\n将为 ${lines.length} 行各写入一条发货批次（ship date ${date}）。`)) return
    setBusy('ship')
    const ok = await callApi()
    if (!ok) { setBusy(''); return }
    await persistUpc()
    // 逐行写 po_shipment 批次
    const batch = lines.map(l => ({ po_id: l.lineId, qty: Math.floor(+l.qtySent), ship_date: date }))
    const { error } = await supabase.from('po_shipment').insert(batch)
    setBusy('')
    if (error) { alert(`资料已生成，但写发货批次失败: ${error.message}`); return }
    onShipped(); router.refresh()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <style>{`
        .sb-fld{border:1px solid #d1d5db;border-radius:8px;padding:6px 9px;font-size:13px;outline:none;background:#fff;width:100%;box-sizing:border-box}
        .sb-fld:focus{box-shadow:0 0 0 2px rgba(99,102,241,.2);border-color:#a5b4fc}
        .sb-cell{width:70px;border:1px solid #d1d5db;border-radius:7px;padding:4px 6px;font-size:12.5px;text-align:right;outline:none}
        .sb-cell:focus{box-shadow:0 0 0 2px rgba(99,102,241,.2);border-color:#a5b4fc}
        .sb-auto{font-variant-numeric:tabular-nums;color:#374151;font-weight:600}
      `}</style>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1080px] p-5 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-lg font-semibold text-gray-900">🏭 Make Shipping Docs</div>
            <div className="text-sm text-gray-500 mt-0.5">
              → <span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{cfg?.customer_name ?? rows[0]?.ka_name ?? '-'}</span>
              <span className="ml-1.5 text-xs text-gray-400">{cfg?.delivery_mode === 'truck' ? '卡派 truck' : cfg?.delivery_mode === 'edi' ? 'EDI' : cfg?.delivery_mode ?? ''}</span>
              <span className="ml-2 text-xs text-gray-400 font-mono">PO {pos.join(' + ')}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-gray-400 mb-1">将生成</div>
            {docChips.map(c => <span key={c} className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 ml-1">{c}</span>)}
            <button onClick={onClose} className="ml-3 text-gray-400 hover:text-gray-600 text-xl leading-none align-middle">×</button>
          </div>
        </div>
        {cfg?.delivery_mode === 'edi' && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 my-2">此 KA 走 EDI，通常无需手工发货资料。</div>}

        <div className="grid grid-cols-4 gap-3 bg-gray-50/70 border border-gray-100 rounded-xl p-3 my-3">
          <label className="flex flex-col gap-1"><span className="text-[11px] text-gray-500 font-medium">Delivery Note #</span><input value={dnNumber} onChange={e => setDnNumber(e.target.value)} className="sb-fld" /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] text-gray-500 font-medium">托盘数 Pallets</span><input value={pallets} onChange={e => setPallets(e.target.value)} placeholder={String(distinctPallets)} className="sb-fld" /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] text-gray-500 font-medium">包裹数 Parcels</span><input value={parcels} onChange={e => setParcels(e.target.value)} className="sb-fld" /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] text-gray-500 font-medium">日期 Date</span><input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className="sb-fld" /></label>
        </div>

        <div className="flex-1 overflow-auto border border-gray-100 rounded-xl">
          <table className="w-full text-[12.5px]" style={{ minWidth: 940 }}>
            <thead className="sticky top-0 bg-gray-50 border-b z-10">
              <tr className="text-gray-500 text-[11px]">
                <th className="px-2 py-2 text-left">PO #</th><th className="px-2 py-2 text-left">SKU</th><th className="px-2 py-2 text-left">Product</th>
                <th className="px-2 py-2 text-right">Ordered</th><th className="px-2 py-2 text-right">Avail</th>
                <th className="px-2 py-2 text-right text-indigo-600">Ship Qty</th>
                <th className="px-2 py-2 text-right text-indigo-600">Units/Carton</th><th className="px-2 py-2 text-right">Cartons🔒</th>
                <th className="px-2 py-2 text-right text-indigo-600">Kg/Carton</th><th className="px-2 py-2 text-right">Total Kg🔒</th>
                <th className="px-2 py-2 text-left text-indigo-600">Pallet#</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, i) => (
                <tr key={l.lineId} className="hover:bg-gray-50/50">
                  <td className="px-2 py-1.5"><span className="font-mono text-[11px] font-semibold text-gray-700">{l.po || '–'}</span></td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-gray-700 whitespace-nowrap">{l.model}</td>
                  <td className="px-2 py-1.5 text-gray-600">{l.description}</td>
                  <td className="px-2 py-1.5 text-right text-gray-400">{fmtNum(l.qtyOrdered)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-500">{fmtNum(l.remaining)}</td>
                  <td className="px-2 py-1.5 text-right"><input value={l.qtySent} onChange={e => setLine(i, { qtySent: e.target.value })} className="sb-cell" /></td>
                  <td className="px-2 py-1.5 text-right">
                    <input value={l.unitsPerCarton} onChange={e => setLine(i, { unitsPerCarton: e.target.value })} placeholder="?" className="sb-cell" />
                    {l.origUpc != null && <div className="text-[9px] text-emerald-600">已存</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right sb-auto">{cartons(l) || '–'}</td>
                  <td className="px-2 py-1.5 text-right"><input value={l.cartonGrossKg} onChange={e => setLine(i, { cartonGrossKg: e.target.value })} placeholder="填毛重" className="sb-cell" /></td>
                  <td className="px-2 py-1.5 text-right sb-auto">{totalKg(l) || <span className="text-gray-300">–</span>}</td>
                  <td className="px-2 py-1.5"><input value={l.palletNo} onChange={e => setLine(i, { palletNo: e.target.value })} placeholder="#" className="sb-cell" style={{ width: 54, textAlign: 'left' }} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-semibold sticky bottom-0">
              <tr>
                <td colSpan={5} className="px-2 py-2 text-right text-[11px] text-gray-500">合计 · {distinctPallets} 托盘 → {distinctPallets || 1} 张箱单</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtNum(totQty)}</td>
                <td></td>
                <td className="px-2 py-2 text-right tabular-nums">{totCartons}</td>
                <td></td>
                <td className="px-2 py-2 text-right tabular-nums">{totWeight ? totWeight + ' kg' : '–'}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex justify-between items-center mt-4">
          <div className="text-[11px] text-gray-400 max-w-[520px]">🔒 箱数=⌈发货量/每箱装量⌉、总毛重=每箱毛重×箱数，自动算。<b className="text-indigo-500">每箱装量</b>会存回 SKU 主数据。箱单按托盘各出一张。</div>
          <div className="flex gap-2">
            <button onClick={onGenerate} disabled={!!busy} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">{busy === 'docs' ? '生成中…' : '仅生成资料 ⬇'}</button>
            <button onClick={onGenerateAndShip} disabled={!!busy} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">{busy === 'ship' ? '处理中…' : '生成并发货 🚚'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
