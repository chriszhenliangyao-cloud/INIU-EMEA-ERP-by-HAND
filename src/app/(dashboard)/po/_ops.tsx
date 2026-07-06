'use client'

// PO 操作共享模块：Unshipped / Partial / Cancelled 三张操作表 + 共用金额/发货辅助。
// 公开 PO 看板(po-view)与 admin「PO & Shipment」模块都从这里引用。

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtNum } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

// 发货判定：有 ship_date 或 delivery_date 任一即视为已发（物流偶尔漏填 ship_date，用送达日兜底）
export const isShipped = (r: { ship_date: string | null; delivery_date: string | null }) => !!(r.ship_date || r.delivery_date)

// 金额按原币种展示（不折算、不取整，保留真实 2 位小数）：EUR→€ · PLN→zł
export const CCY_SYM: Record<string, string> = { EUR: '€', PLN: 'zł ' }

// Value 模式把营业额统一折算成 EUR（明细列仍存原币，不受影响）。汇率经 page.tsx 注入。
export const toEUR = (turnover: number | null, currency: string | null, rate: number) =>
  turnover == null ? 0 : (currency === 'PLN' ? turnover * rate : turnover)

export const fmtMoney = (v: number | null | undefined, ccy: string | null) => {
  if (v == null) return '–'
  return (ccy ? (CCY_SYM[ccy] ?? ccy + ' ') : '') +
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 低饱和度调色板（PO 色卡，shipment 也复用）
export const PALETTE = ['#5b8def', '#52b788', '#9b8cce', '#e0a458', '#d98594', '#6cc3d5', '#c9a227', '#7aa095', '#b58db6', '#8a9bb0']

export type UnRow = {
  id: number; po_date: string; po_number: string | null; notes: string | null
  sku_code: string; sku_name: string; country_code: string; country_flag: string; ka_name: string | null; qty: number
  fd_buying_price: number | null; turnover: number | null; currency: string | null; delivered_qty: number | null
}

// 未发货 PO 表 —— notes 可编辑并写回 channel_po
export function UnshippedTable({ rows, plnToEur }: { rows: UnRow[]; plnToEur: number }) {
  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const totalValEUR = rows.reduce((s, r) => s + toEUR(r.turnover, r.currency, plnToEur), 0)
  const supabase = useRef(createClient()).current
  const router = useRouter()
  const today = useRef(new Date().toISOString().slice(0, 10)).current
  const [draft, setDraft] = useState<Record<number, string>>(() => Object.fromEntries(rows.map(r => [r.id, r.notes ?? ''])))
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  // 每行的发货日期（默认今天，可改成实际发货日）+ 标记中状态
  const [shipDate, setShipDate] = useState<Record<number, string>>({})
  const [shippingId, setShippingId] = useState<number | null>(null)

  const save = async (id: number) => {
    setSavingId(id); setSavedId(null)
    const { error } = await supabase.from('channel_po').update({ notes: (draft[id] ?? '').trim() || null }).eq('id', id)
    setSavingId(null)
    if (!error) { setSavedId(id); setTimeout(() => setSavedId(s => s === id ? null : s), 2000) }
    else alert(`Save failed: ${error.message}`)
  }

  // 标记已发货：写入 ship_date → 该行不再算 unshipped，看板聚合里计为已发货。router.refresh() 重新拉服务端数据。
  const markShipped = async (id: number) => {
    const d = shipDate[id] || today
    setShippingId(id)
    const { error } = await supabase.from('channel_po').update({ ship_date: d }).eq('id', id)
    if (error) { setShippingId(null); alert(`Mark failed: ${error.message}`); return }
    router.refresh()
  }

  // 取消：po_status=cancelled → 移入 Cancelled 表（仍计入总额，只是状态标签）。
  const markCancelled = async (id: number) => {
    if (!confirm('Mark this PO as cancelled?\nIt still counts toward totals, but moves to the Cancelled table.')) return
    setShippingId(id)
    const { error } = await supabase.from('channel_po').update({ po_status: 'cancelled' }).eq('id', id)
    if (error) { setShippingId(null); alert(`Mark failed: ${error.message}`); return }
    router.refresh()
  }

  // 部分发货：输入已发数量 → po_status=partial + delivered_qty + ship_date（部分发货日）→ 移入 Partially Delivered 表。
  const markPartial = async (id: number, ordered: number) => {
    const input = prompt(`Partial shipment — quantity delivered (of ${ordered} ordered):`, '')
    if (input == null) return
    const n = Math.floor(Number(input))
    if (!Number.isFinite(n) || n <= 0 || n >= ordered) { alert(`Enter a delivered quantity between 1 and ${ordered - 1} (for the full order, use "Mark shipped").`); return }
    setShippingId(id)
    const { error } = await supabase.from('channel_po').update({ po_status: 'partial', delivered_qty: n, ship_date: shipDate[id] || today }).eq('id', id)
    if (error) { setShippingId(null); alert(`Mark failed: ${error.message}`); return }
    router.refresh()
  }

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-4 mb-5">
      <style>{`
        .lg-date{background:rgba(120,120,128,.10);border:1px solid rgba(255,255,255,.6);box-shadow:inset 0 1px 1px rgba(255,255,255,.7);backdrop-filter:blur(10px) saturate(150%);-webkit-backdrop-filter:blur(10px) saturate(150%);transition:background .25s}
        .lg-date:hover{background:rgba(120,120,128,.16)}
        .lg-ship{background:rgba(16,185,129,.20);border:1px solid rgba(16,185,129,.35);box-shadow:inset 0 1px 1px rgba(255,255,255,.7);backdrop-filter:blur(8px) saturate(160%);-webkit-backdrop-filter:blur(8px) saturate(160%);transition:background .25s,transform .2s}
        .lg-ship:hover{background:rgba(16,185,129,.30);transform:translateY(-1px)}
        .lg-chip{background:rgba(120,120,128,.12);border:1px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.6);backdrop-filter:blur(8px) saturate(150%);-webkit-backdrop-filter:blur(8px) saturate(150%);transition:background .25s,transform .2s}
        .lg-chip:hover{transform:translateY(-1px)}
        .lg-chip-blue{color:#0369a1}
        .lg-chip-blue:hover{background:rgba(2,132,199,.15)}
        .lg-chip-red{color:#be123c}
        .lg-chip-red:hover{background:rgba(225,29,72,.14)}
      `}</style>
      <div className="flex items-center justify-between mb-1">
        <div className="text-base font-semibold text-gray-900">🚚 Unshipped POs <span className="ml-2 text-xs font-normal text-amber-600">no ship date & no delivery date — needs follow-up</span></div>
        <div className="text-xs text-gray-400 whitespace-nowrap">{rows.length} lines · <strong className="text-gray-700 tabular-nums">{fmtNum(totalQty)}</strong> units · <strong className="text-gray-700 tabular-nums">€{fmtNum(Math.round(totalValEUR))}</strong></div>
      </div>
      <div className="text-xs text-gray-400 mb-3">A PO counts as shipped if it has either a Ship Date or a Delivery Date (logistics sometimes leaves Ship Date blank). Only POs missing both are listed here. Add a note to record why.</div>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-amber-50 border-b sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">Country</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">KA</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">PO Date</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">PO #</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">SKU</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">Product</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600">Qty</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 whitespace-nowrap" title="FD buying price (original currency)">Unit Price</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 whitespace-nowrap" title="Turnover (original currency)">Turnover</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600" style={{ minWidth: 280 }}>Notes — why not shipped?</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 whitespace-nowrap" title="Shipped / Partial / Cancel — moves the row to the matching table">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => {
              const dirty = (draft[r.id] ?? '') !== (r.notes ?? '')
              return (
                <tr key={r.id} className="hover:bg-amber-50/40 align-top">
                  <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{r.country_flag} {r.country_code}</span></td>
                  <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{r.ka_name ?? '-'}</span></td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">{r.po_date}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-500 whitespace-nowrap">{r.po_number ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{r.sku_code}</td>
                  <td className="px-3 py-2 text-gray-600">{r.sku_name || '-'}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(r.qty)}</td>
                  <td className="px-3 py-2 text-right text-gray-500 tabular-nums whitespace-nowrap">{fmtMoney(r.fd_buying_price, r.currency)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">{fmtMoney(r.turnover, r.currency)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <textarea value={draft[r.id] ?? ''} onChange={e => setDraft(p => ({ ...p, [r.id]: e.target.value }))} rows={2}
                        placeholder="e.g. awaiting stock / customer postponed / partial backorder…"
                        className="flex-1 min-w-0 resize-y rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-400" />
                      <button onClick={() => save(r.id)} disabled={!dirty || savingId === r.id}
                        className={`shrink-0 px-2.5 py-1 text-xs rounded-md transition ${dirty ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-gray-100 text-gray-400'}`}>
                        {savingId === r.id ? '…' : savedId === r.id ? '✓' : 'Save'}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex flex-col gap-1.5 w-[140px]">
                      <input type="date" value={shipDate[r.id] ?? today} max={today}
                        onChange={e => setShipDate(p => ({ ...p, [r.id]: e.target.value }))}
                        className="lg-date w-full rounded-[10px] px-2 py-1 text-[11px] text-gray-700 outline-none focus:ring-2 focus:ring-emerald-200/70" />
                      <button onClick={() => markShipped(r.id)} disabled={shippingId === r.id}
                        className="lg-ship w-full rounded-[10px] px-3 py-1.5 text-xs font-semibold text-emerald-800 active:scale-[0.98] disabled:opacity-50">
                        {shippingId === r.id ? 'Saving…' : 'Mark shipped'}
                      </button>
                      <div className="flex gap-1.5">
                        <button onClick={() => markPartial(r.id, r.qty)} disabled={shippingId === r.id}
                          className="lg-chip lg-chip-blue flex-1 rounded-[10px] px-2 py-1 text-[11px] font-semibold active:scale-[0.98] disabled:opacity-50" title="Partial shipment: enter quantity delivered">
                          Partial
                        </button>
                        <button onClick={() => markCancelled(r.id)} disabled={shippingId === r.id}
                          className="lg-chip lg-chip-red flex-1 rounded-[10px] px-2 py-1 text-[11px] font-semibold active:scale-[0.98] disabled:opacity-50" title="Cancel this PO">
                          Cancel
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={11} className="py-10 text-center text-gray-400">All POs have a ship date 🎉</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-amber-50 border-t-2 border-amber-200 sticky bottom-0">
              <tr>
                <td className="px-3 py-2 text-xs font-semibold text-gray-600" colSpan={6}>Unshipped total (in total PO)</td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{fmtNum(totalQty)}</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums whitespace-nowrap" title={`In EUR · PLN×${plnToEur.toFixed(4)}`}>€{fmtNum(Math.round(totalValEUR))}</td>
                <td className="px-3 py-2" colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// 已取消 / 部分发货 的 PO 表 —— 从 Unshipped 标记后转入。notes 可编辑；Reopen 退回待发。
export function ActionedTable({ rows, mode, plnToEur, viewerIsAdmin }: { rows: UnRow[]; mode: 'cancelled' | 'partial'; plnToEur: number; viewerIsAdmin: boolean }) {
  const supabase = useRef(createClient()).current
  const router = useRouter()
  const [draft, setDraft] = useState<Record<number, string>>(() => Object.fromEntries(rows.map(r => [r.id, r.notes ?? ''])))
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const save = async (id: number) => {
    setSavingId(id); setSavedId(null)
    const { error } = await supabase.from('channel_po').update({ notes: (draft[id] ?? '').trim() || null }).eq('id', id)
    setSavingId(null)
    if (!error) { setSavedId(id); setTimeout(() => setSavedId(s => s === id ? null : s), 2000) }
    else alert(`Save failed: ${error.message}`)
  }
  // 退回待发：清空 po_status / delivered_qty / ship_date（这些行原本都来自未发货清单）
  const reopen = async (id: number) => {
    if (!confirm('Move back to the Unshipped list? This clears the shipped / partial / cancelled mark on this row.')) return
    setBusyId(id)
    const { error } = await supabase.from('channel_po').update({ po_status: null, delivered_qty: null, ship_date: null }).eq('id', id)
    if (error) { setBusyId(null); alert(`Action failed: ${error.message}`); return }
    router.refresh()
  }

  const isPartial = mode === 'partial'
  const totalValEUR = rows.reduce((s, r) => s + toEUR(r.turnover, r.currency, plnToEur), 0)
  const totalDelivered = rows.reduce((s, r) => s + (r.delivered_qty ?? 0), 0)
  const totalOrdered = rows.reduce((s, r) => s + r.qty, 0)
  const theme = isPartial
    ? { border: 'border-sky-200', head: 'bg-sky-50', foot: 'bg-sky-50 border-sky-200', icon: '◑', title: 'Partially Delivered POs', sub: 'Partially delivered — full ordered qty still counts toward totals; track the remainder here' }
    : { border: 'border-rose-200', head: 'bg-rose-50', foot: 'bg-rose-50 border-rose-200', icon: '✗', title: 'Cancelled POs', sub: 'Cancelled — still counts toward totals (status label only)' }

  return (
    <div className={`bg-white rounded-xl border ${theme.border} p-4 mb-5`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-base font-semibold text-gray-900">{theme.icon} {theme.title}</div>
        <div className="text-xs text-gray-400 whitespace-nowrap">{rows.length} lines · <strong className="text-gray-700 tabular-nums">{fmtNum(totalOrdered)}</strong> units · <strong className="text-gray-700 tabular-nums">€{fmtNum(Math.round(totalValEUR))}</strong></div>
      </div>
      <div className="text-xs text-gray-400 mb-3">{theme.sub}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-300 py-6 text-center border border-gray-100 rounded-lg">No records</div>
      ) : (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className={`${theme.head} border-b sticky top-0 z-10`}>
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">Country</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">KA</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">PO Date</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">PO #</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">SKU</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600">Product</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600">{isPartial ? 'Ordered' : 'Qty'}</th>
                {isPartial && <th className="px-3 py-2.5 text-right text-xs font-semibold text-emerald-600">Delivered</th>}
                {isPartial && <th className="px-3 py-2.5 text-right text-xs font-semibold text-amber-600">Remaining</th>}
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600">Turnover</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600" style={{ minWidth: 220 }}>Notes</th>
                {viewerIsAdmin && <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600">Reopen</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const dirty = (draft[r.id] ?? '') !== (r.notes ?? '')
                const remaining = r.qty - (r.delivered_qty ?? 0)
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60 align-top">
                    <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{r.country_flag} {r.country_code}</span></td>
                    <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{r.ka_name ?? '-'}</span></td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">{r.po_date}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500 whitespace-nowrap">{r.po_number ?? '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{r.sku_code}</td>
                    <td className="px-3 py-2 text-gray-600">{r.sku_name || '-'}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(r.qty)}</td>
                    {isPartial && <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums">{fmtNum(r.delivered_qty ?? 0)}</td>}
                    {isPartial && <td className="px-3 py-2 text-right font-semibold text-amber-700 tabular-nums">{fmtNum(remaining)}</td>}
                    <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">{fmtMoney(r.turnover, r.currency)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        <textarea value={draft[r.id] ?? ''} onChange={e => setDraft(p => ({ ...p, [r.id]: e.target.value }))} rows={2}
                          placeholder={isPartial ? 'Remaining shipment plan / notes…' : 'Cancellation reason…'}
                          className="flex-1 min-w-0 resize-y rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-gray-400" />
                        <button onClick={() => save(r.id)} disabled={!dirty || savingId === r.id}
                          className={`shrink-0 px-2.5 py-1 text-xs rounded-md transition ${dirty ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400'}`}>
                          {savingId === r.id ? '…' : savedId === r.id ? '✓' : 'Save'}
                        </button>
                      </div>
                    </td>
                    {viewerIsAdmin && (
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => reopen(r.id)} disabled={busyId === r.id}
                          className="px-2 py-1 text-[11px] rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition disabled:opacity-60" title="Move back to Unshipped">
                          {busyId === r.id ? '…' : '↩ Reopen'}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className={`${theme.foot} border-t-2 sticky bottom-0`}>
              <tr>
                <td className="px-3 py-2 text-xs font-semibold text-gray-600" colSpan={6}>Total</td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{fmtNum(totalOrdered)}</td>
                {isPartial && <td className="px-3 py-2 text-right text-sm font-bold text-emerald-700 tabular-nums">{fmtNum(totalDelivered)}</td>}
                {isPartial && <td className="px-3 py-2 text-right text-sm font-bold text-amber-700 tabular-nums">{fmtNum(totalOrdered - totalDelivered)}</td>}
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums whitespace-nowrap" title={`In EUR · PLN×${plnToEur.toFixed(4)}`}>€{fmtNum(Math.round(totalValEUR))}</td>
                <td className="px-3 py-2" colSpan={viewerIsAdmin ? 2 : 1}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
