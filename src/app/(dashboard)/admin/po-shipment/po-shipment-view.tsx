'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils'
import { fmtMoney, stageOf, type Batch, type OpsRow, type Stage } from '../../po/_ops'
import { PoDocsModal } from './po-docs-modal'

export type SkuOpt = { id: number; code: string; name: string }
export type CountryOpt = { id: number; code: string; name: string; flag: string }
export type KaOpt = { id: number; name: string; country_id: number }

type StageMeta = { key: Stage; icon: string; label: string; a: string; bg: string; bd: string; tx: string; desc: string }
const STAGES: Record<Stage, StageMeta> = {
  new:       { key: 'new',       icon: '🆕', label: 'New PO',    a: '#6366f1', bg: '#eef2ff', bd: '#c7d2fe', tx: '#4338ca', desc: '刚导入 / 手动新建、且尚未发货的单，等待核对。Confirm 进入待发；也可直接作废。' },
  toship:    { key: 'toship',    icon: '📦', label: 'To Ship',   a: '#f59e0b', bg: '#fffbeb', bd: '#fde68a', tx: '#b45309', desc: '已确认、等待发货。全发→Mark shipped；只发一部分→Partial（剩余量转入 Partial 车道继续跟）；客户取消→Cancel。' },
  shipped:   { key: 'shipped',   icon: '✈️', label: 'Shipped',   a: '#10b981', bg: '#ecfdf5', bd: '#a7f3d0', tx: '#047857', desc: '已全部发出、在途。展开逐批录入送达日；全部批次都送达即自动归入 Delivered。' },
  delivered: { key: 'delivered', icon: '📬', label: 'Delivered', a: '#64748b', bg: '#f8fafc', bd: '#e2e8f0', tx: '#475569', desc: '发满且全部批次都已送达 = 自动完成。展开可追溯每张 PO 下每个 SKU 的每一批发运。' },
  partial:   { key: 'partial',   icon: '◑',  label: 'Partial',   a: '#0ea5e9', bg: '#f0f9ff', bd: '#bae6fd', tx: '#0369a1', desc: '部分已发，Remaining 为仍待发的未结量（open）。展开可给已发批次录送达日；可多次 Ship remaining 分批发货，发完自动归 Shipped。' },
  cancelled: { key: 'cancelled', icon: '✗',  label: 'Cancelled', a: '#f43f5e', bg: '#fff1f2', bd: '#fecdd3', tx: '#be123c', desc: '已取消（仍计入总额，只是状态标签）。误操作可 Reopen 退回待发。' },
}

// To Ship 账龄：距 PO 日多少天。>14 黄，>30 红。
const daysSince = (d: string) => Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000))
const ageTone = (n: number) => n > 30 ? 'bg-rose-50 text-rose-700' : n > 14 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'

export function PoShipmentView({ rows, batches, docCounts, skus, countries, kas }: {
  rows: OpsRow[]; batches: Batch[]; docCounts: Record<string, number>; plnToEur: number; skus: SkuOpt[]; countries: CountryOpt[]; kas: KaOpt[]
}) {
  const supabase = useRef(createClient()).current
  const router = useRouter()
  const today = useRef(new Date().toISOString().slice(0, 10)).current

  const [active, setActive] = useState<Stage>('toship')
  const [busy, setBusy] = useState<string | null>(null)     // 'line:12' / 'grp:PO123'
  const [dates, setDates] = useState<Record<string, string>>({})   // 行/组 → 发货日
  const [poSearch, setPoSearch] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())  // 展开的组 / 行
  const [addOpen, setAddOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [poDetailsOpen, setPoDetailsOpen] = useState(false)
  const [docsPo, setDocsPo] = useState<string | null>(null)

  const batchesByPo = useMemo(() => {
    const m = new Map<number, Batch[]>()
    batches.forEach(b => { const a = m.get(b.po_id); a ? a.push(b) : m.set(b.po_id, [b]) })
    return m
  }, [batches])

  const buckets = useMemo(() => {
    const b: Record<Stage, OpsRow[]> = { new: [], toship: [], shipped: [], delivered: [], partial: [], cancelled: [] }
    rows.forEach(r => b[stageOf(r)].push(r))
    Object.values(b).forEach(arr => arr.sort((a, z) => (z.po_date ?? '').localeCompare(a.po_date ?? '')))
    return b
  }, [rows])

  const list = useMemo(() => {
    const base = buckets[active]
    const q = poSearch.trim().toLowerCase()
    return q ? base.filter(r => (r.po_number ?? '').toLowerCase().includes(q)) : base
  }, [buckets, active, poSearch])

  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const dateOf = (k: string) => dates[k] || today

  // ===== 写操作。批次是唯一事实来源；父行 ship/delivery/delivered_qty/po_status 由 DB 触发器派生 =====
  const after = (err: any, key: string) => {
    if (err) { setBusy(null); alert(`操作失败: ${err.message}`); return false }
    router.refresh(); return true
  }
  const confirmPo = async (ids: number[], key: string) => {
    setBusy(key)
    const { error } = await supabase.from('channel_po').update({ po_status: null }).in('id', ids)
    after(error, key)
  }
  const cancelPo = async (ids: number[], key: string) => {
    if (!confirm(`取消 ${ids.length} 行 PO？\n仍计入总额，只是打上 Cancelled 状态标签。`)) return
    setBusy(key)
    const { error } = await supabase.from('channel_po').update({ po_status: 'cancelled' }).in('id', ids)
    after(error, key)
  }
  // 发货 = 新增一条批次（绝不覆盖既有批次的日期）
  const addBatches = async (b: { po_id: number; qty: number; ship_date: string }[], key: string) => {
    setBusy(key)
    const { error } = await supabase.from('po_shipment').insert(b)
    after(error, key)
  }
  const markShipped = (lines: OpsRow[], key: string) => {
    const b = lines.map(l => ({ po_id: l.id, qty: l.qty - (l.delivered_qty ?? 0), ship_date: dateOf(key) })).filter(x => x.qty > 0)
    if (!b.length) { alert('这些行已全部发完。'); return }
    addBatches(b, key)
  }
  const markPartial = (l: OpsRow, key: string) => {
    const input = prompt(`部分发货 — 本次发货数量（共 ${l.qty}）：`, '')
    if (input == null) return
    const n = Math.floor(Number(input))
    if (!Number.isFinite(n) || n <= 0 || n >= l.qty) { alert(`请输入 1 到 ${l.qty - 1} 之间的数量（整单发完请用 Mark shipped）。`); return }
    addBatches([{ po_id: l.id, qty: n, ship_date: dateOf(key) }], key)
  }
  const shipRemaining = (l: OpsRow, key: string) => {
    const remaining = l.qty - (l.delivered_qty ?? 0)
    const input = prompt(`发运尾单 — 本次发货数量（剩余 ${remaining}）：`, String(remaining))
    if (input == null) return
    const n = Math.floor(Number(input))
    if (!Number.isFinite(n) || n <= 0 || n > remaining) { alert(`请输入 1 到 ${remaining} 之间的数量。`); return }
    addBatches([{ po_id: l.id, qty: n, ship_date: dateOf(key) }], key)
  }
  // 退回待发：删掉全部批次（触发器把父行日期/已发量清空），并清掉状态标签
  const reopen = async (id: number, key: string) => {
    if (!confirm('退回 To Ship？\n将删除该行的全部发货批次记录，并清除 shipped / partial / cancelled 标记。')) return
    setBusy(key)
    const { error: e1 } = await supabase.from('po_shipment').delete().eq('po_id', id)
    if (e1) { setBusy(null); alert(`操作失败: ${e1.message}`); return }
    const { error: e2 } = await supabase.from('channel_po').update({ po_status: null }).eq('id', id)
    after(e2, key)
  }
  const patchBatch = async (batchId: number, patch: Record<string, any>, key: string) => {
    setBusy(key)
    const { error } = await supabase.from('po_shipment').update(patch).eq('id', batchId)
    after(error, key)
  }
  // 整单送达：把该 PO 下所有 SKU 行、所有"未录送达日"的批次一次性标记送达
  const deliverGroup = async (lineIds: number[], date: string, key: string) => {
    setBusy(key)
    const { error } = await supabase.from('po_shipment').update({ delivery_date: date }).in('po_id', lineIds).is('delivery_date', null)
    after(error, key)
  }
  const saveLineNotes = async (id: number, notes: string, key: string) => {
    setBusy(key)
    const { error } = await supabase.from('channel_po').update({ notes: notes.trim() || null }).eq('id', id)
    after(error, key)
  }

  const m = STAGES[active]
  const grouped = active === 'new' || active === 'toship'

  return (
    <div className="p-6 max-w-[1560px] mx-auto">
      <PosStyle />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🚚 Shipment Workflow</h1>
          <p className="text-sm text-gray-500 mt-1">
            一条履约流水线管完整 PO 生命周期。发货记录以<span className="font-medium text-gray-700">批次</span>存储，同一 SKU 可分多次发运、各批独立日期与备注。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setPoDetailsOpen(true)} title="导出所选 PO 为 PO Details 子表格式，用于粘贴回「线下零售渠道发货记录表」"
            className="group inline-flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-xl border border-sky-200 bg-white hover:border-sky-300 hover:bg-sky-50/60 shadow-sm transition">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-sky-600 text-white text-base group-hover:bg-sky-700 transition">📄</span>
            <span className="text-left leading-tight">
              <span className="block text-sm font-semibold text-gray-900">PO Details</span>
              <span className="block text-[11px] text-gray-400">导出明细 · 粘贴用</span>
            </span>
          </button>
          <button onClick={() => setExportOpen(true)} title="导出所选 PO 的发货批次与各批 ETA，用于追踪交期 / 回复客户到货时间"
            className="group inline-flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-xl border border-emerald-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60 shadow-sm transition">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-emerald-600 text-white text-base group-hover:bg-emerald-700 transition">📋</span>
            <span className="text-left leading-tight">
              <span className="block text-sm font-semibold text-gray-900">Order Leadtime</span>
              <span className="block text-[11px] text-gray-400">导出交期表 · 各批 ETA</span>
            </span>
          </button>
        </div>
      </div>

      <div className="flex gap-5 items-start">
        <div className="w-[236px] flex-none">
          <RailNode meta={STAGES.new}    count={buckets.new.length}    active={active === 'new'}    onClick={() => setActive('new')} />
          <div className="conn">▼</div>
          <RailNode meta={STAGES.toship} count={buckets.toship.length} active={active === 'toship'} onClick={() => setActive('toship')} />
          <div className="branchwrap">
            <RailBranch meta={STAGES.partial}   count={buckets.partial.length}   active={active === 'partial'}   onClick={() => setActive('partial')} />
            <RailBranch meta={STAGES.cancelled} count={buckets.cancelled.length} active={active === 'cancelled'} onClick={() => setActive('cancelled')} />
          </div>
          <div className="conn">▼</div>
          <RailNode meta={STAGES.shipped}   count={buckets.shipped.length}   active={active === 'shipped'}   onClick={() => setActive('shipped')} />
          <div className="conn">▼</div>
          <RailNode meta={STAGES.delivered} count={buckets.delivered.length} active={active === 'delivered'} onClick={() => setActive('delivered')} />
          <div className="mt-3 text-[10.5px] leading-relaxed text-gray-400 px-2.5 py-2 bg-gray-50/70 border border-dashed border-gray-200 rounded-[10px]">
            <span className="text-sky-700">◑ Partial</span> 剩余量仍待发，可多次分批 → 发完回 <span className="text-emerald-700">Shipped</span><br />
            <span className="text-emerald-700">✈️ Shipped</span> 逐批录送达日 → 全达自动进 <span className="text-slate-600">Delivered</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_20px_rgba(0,0,0,0.04)] p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-[15px] font-semibold" style={{ color: m.tx }}>{m.icon} {m.label}
                <span className="ml-2 text-xs font-normal text-gray-400">· {list.length} lines · {fmtNum(list.reduce((s, r) => s + r.qty, 0))} units</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5 max-w-[880px]">{m.desc}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
                <input value={poSearch} onChange={e => setPoSearch(e.target.value)} placeholder="Search PO #…" className="fld pl-7 pr-7 w-[190px] h-[34px] text-[13px]" />
                {poSearch && <button onClick={() => setPoSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm leading-none">×</button>}
              </div>
              {active === 'new' && <button onClick={() => setAddOpen(true)} className="btn b-indigo" style={{ padding: '7px 14px' }}>＋ Add PO manually</button>}
            </div>
          </div>

          <div className="rounded-[10px] overflow-hidden mt-2.5" style={{ borderLeft: `3px solid ${m.a}` }}>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto border border-gray-100 border-l-0 rounded-r-[10px]">
              {grouped && <GroupedTable stage={active} meta={m} rows={list} open={open} toggle={toggle} busy={busy} dateOf={dateOf} setDate={(k, v) => setDates(p => ({ ...p, [k]: v }))} today={today}
                onConfirm={confirmPo} onCancel={cancelPo} onShip={markShipped} onPartial={markPartial} poSearch={poSearch} docCounts={docCounts} onDocs={setDocsPo} />}
              {active === 'partial' && <BatchStageTable stage={active} meta={m} rows={list} batchesByPo={batchesByPo} open={open} toggle={toggle} busy={busy}
                dateOf={dateOf} setDate={(k, v) => setDates(p => ({ ...p, [k]: v }))} today={today} onShipRemaining={shipRemaining} onReopen={reopen} onPatchBatch={patchBatch} onSaveNotes={saveLineNotes} poSearch={poSearch} docCounts={docCounts} onDocs={setDocsPo} />}
              {active === 'shipped' && <ShippedGroupedTable meta={m} rows={list} batchesByPo={batchesByPo} open={open} toggle={toggle} busy={busy} today={today}
                onReopen={reopen} onPatchBatch={patchBatch} onSaveNotes={saveLineNotes} onDeliverGroup={deliverGroup} poSearch={poSearch} docCounts={docCounts} onDocs={setDocsPo} />}
              {active === 'cancelled' && <CancelledTable meta={m} rows={list} busy={busy} onReopen={reopen} poSearch={poSearch} docCounts={docCounts} onDocs={setDocsPo} />}
              {active === 'delivered' && <DeliveredTable meta={m} rows={list} batchesByPo={batchesByPo} open={open} toggle={toggle} poSearch={poSearch} docCounts={docCounts} onDocs={setDocsPo} />}
            </div>
          </div>
        </div>
      </div>

      {addOpen && <AddPoModal today={today} skus={skus} countries={countries} kas={kas} onClose={() => setAddOpen(false)}
        onDone={() => { setAddOpen(false); router.refresh() }} supabase={supabase} />}
      {exportOpen && <ExportModal rows={rows} batchesByPo={batchesByPo} today={today} onClose={() => setExportOpen(false)} />}
      {poDetailsOpen && <PoDetailsExportModal rows={rows} today={today} onClose={() => setPoDetailsOpen(false)} />}
      {docsPo && <PoDocsModal poNumber={docsPo} onClose={() => setDocsPo(null)} onChanged={() => router.refresh()} />}
    </div>
  )
}

// PO 文档角标（点开该 PO 的文档面板）。无 PO # 的行不显示。
function DocsBadge({ po, count, onDocs }: { po: string | null; count: number; onDocs: (po: string) => void }) {
  if (!po) return null
  return (
    <button onClick={e => { e.stopPropagation(); onDocs(po) }} title="PO 文档：箱唛 / 送货单 / 装箱单 / POD / 发票"
      className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] align-middle transition ${count ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
      📎{count ? ` ${count}` : ''}
    </button>
  )
}

// ===== 按 PO # 归并（New PO / To Ship）：主行批量操作，展开逐 SKU 行 =====
type Grp = { key: string; po_number: string | null; country_code: string; country_flag: string; ka_name: string | null; po_date: string; lines: OpsRow[]; qty: number }
function groupByPo(rows: OpsRow[]): Grp[] {
  const map = new Map<string, Grp>()
  rows.forEach(r => {
    const key = r.po_number ? `po:${r.po_number}` : `id:${r.id}`   // 无 PO # 的行各自成组
    const g = map.get(key)
    if (g) { g.lines.push(r); g.qty += r.qty; if (r.po_date < g.po_date) g.po_date = r.po_date }
    else map.set(key, { key, po_number: r.po_number, country_code: r.country_code, country_flag: r.country_flag, ka_name: r.ka_name, po_date: r.po_date, lines: [r], qty: r.qty })
  })
  const out = Array.from(map.values())
  out.forEach(g => g.lines.sort((a, z) => a.sku_code.localeCompare(z.sku_code)))
  return out.sort((a, z) => z.po_date.localeCompare(a.po_date))
}

function GroupedTable({ stage, meta, rows, open, toggle, busy, dateOf, setDate, today, onConfirm, onCancel, onShip, onPartial, poSearch, docCounts, onDocs }: {
  stage: Stage; meta: StageMeta; rows: OpsRow[]; open: Set<string>; toggle: (k: string) => void; busy: string | null
  dateOf: (k: string) => string; setDate: (k: string, v: string) => void; today: string
  onConfirm: (ids: number[], key: string) => void; onCancel: (ids: number[], key: string) => void
  onShip: (lines: OpsRow[], key: string) => void; onPartial: (l: OpsRow, key: string) => void; poSearch: string
  docCounts: Record<string, number>; onDocs: (po: string) => void
}) {
  const groups = useMemo(() => groupByPo(rows), [rows])
  const isNew = stage === 'new'

  return (
    <table className="w-full text-[12.5px]">
      <thead className="sticky top-0 z-10" style={{ background: meta.bg }}>
        <tr className="border-b border-gray-200">
          <Th> </Th><Th>PO #</Th><Th>Country</Th><Th>KA</Th><Th center>SKUs</Th><Th right>Total Qty</Th><Th>PO Date</Th>
          {!isNew && <Th center>Waiting</Th>}
          <Th center>整张 PO 操作</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {groups.map(g => {
          const o = open.has(g.key)
          const gk = `grp:${g.key}`
          const ids = g.lines.map(l => l.id)
          const age = daysSince(g.po_date)
          return (
            <Fragment key={g.key}>
              <tr className="hover:bg-gray-50/60">
                <td className="pl-3 pr-1 py-2 w-6 cursor-pointer" onClick={() => toggle(g.key)}>
                  <span className="inline-block text-gray-400 transition-transform" style={{ transform: o ? 'rotate(90deg)' : 'none' }}>▶</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggle(g.key)}>{g.po_number ?? <span className="text-gray-300">（无 PO #）</span>}</span><DocsBadge po={g.po_number} count={docCounts[g.po_number ?? ''] ?? 0} onDocs={onDocs} /></td>
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{g.country_flag} {g.country_code}</span></td>
                <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{g.ka_name ?? '-'}</span></td>
                <td className="px-3 py-2 text-center text-gray-500 tabular-nums">{g.lines.length}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtNum(g.qty)}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.po_date}</td>
                {!isNew && <td className="px-3 py-2 text-center"><span className={`inline-block px-2 py-0.5 rounded text-[11px] tabular-nums ${ageTone(age)}`}>{age}d</span></td>}
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-1.5 w-[184px]">
                    {isNew ? (
                      <>
                        <button onClick={() => onConfirm(ids, gk)} disabled={busy === gk} className="btn b-green w-full">{busy === gk ? '…' : `✅ Confirm 整张 PO (${ids.length})`}</button>
                        <button onClick={() => onCancel(ids, gk)} disabled={busy === gk} className="btn b-red w-full">✗ Cancel 整张 PO</button>
                      </>
                    ) : (
                      <>
                        <input type="date" value={dateOf(gk)} max={today} onChange={e => setDate(gk, e.target.value)} className="lg-date w-full" />
                        <button onClick={() => onShip(g.lines, gk)} disabled={busy === gk} className="btn b-green w-full">{busy === gk ? '…' : `🚚 整张 PO 发货 (${ids.length})`}</button>
                        <button onClick={() => onCancel(ids, gk)} disabled={busy === gk} className="btn b-red w-full">✗ Cancel 整张 PO</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              {o && (
                <tr className="bg-slate-50/60">
                  <td></td>
                  <td colSpan={isNew ? 7 : 8} className="px-3 py-2.5">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{g.lines.length} 个 SKU · 也可单行操作</div>
                    <table className="w-full text-[12px]">
                      <thead><tr className="text-left text-[10.5px] text-gray-500 border-b border-gray-200">
                        <th className="py-1 pr-3 font-semibold">SKU</th><th className="py-1 pr-3 font-semibold">Product</th>
                        <th className="py-1 pr-3 font-semibold text-right">Qty</th><th className="py-1 pr-3 font-semibold text-right">Unit Price</th>
                        <th className="py-1 pr-3 font-semibold text-right">Turnover</th><th className="py-1 pr-3 font-semibold">Notes</th>
                        <th className="py-1 font-semibold text-center">Action</th>
                      </tr></thead>
                      <tbody>
                        {g.lines.map(l => {
                          const lk = `line:${l.id}`
                          return (
                            <tr key={l.id} className="border-b border-gray-100 last:border-0">
                              <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-700 whitespace-nowrap">{l.sku_code}</td>
                              <td className="py-1.5 pr-3 text-gray-600">{l.sku_name || '-'}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmtNum(l.qty)}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500 whitespace-nowrap">{fmtMoney(l.fd_buying_price, l.currency)}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700 whitespace-nowrap">{fmtMoney(l.turnover, l.currency)}</td>
                              <td className="py-1.5 pr-3 text-[11px] text-gray-400">{l.notes || '—'}</td>
                              <td className="py-1.5">
                                <div className="flex gap-1.5 justify-center">
                                  {isNew ? (
                                    <>
                                      <button onClick={() => onConfirm([l.id], lk)} disabled={busy === lk} className="btn b-green">✅ Confirm</button>
                                      <button onClick={() => onCancel([l.id], lk)} disabled={busy === lk} className="btn b-red">✗</button>
                                    </>
                                  ) : (
                                    <>
                                      <input type="date" value={dateOf(lk)} max={today} onChange={e => setDate(lk, e.target.value)} className="lg-date" />
                                      <button onClick={() => onShip([l], lk)} disabled={busy === lk} className="btn b-green">Ship</button>
                                      <button onClick={() => onPartial(l, lk)} disabled={busy === lk} className="btn b-blue">Partial</button>
                                      <button onClick={() => onCancel([l.id], lk)} disabled={busy === lk} className="btn b-red">✗</button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {!groups.length && <tr><td colSpan={9} className="py-12 text-center text-gray-300">{poSearch ? `没有匹配「${poSearch}」的 PO` : '此阶段暂无记录 🎉'}</td></tr>}
      </tbody>
    </table>
  )
}

// ===== Shipped / Partial：逐 SKU 行，展开看批次并逐批录送达日 =====
function BatchStageTable({ stage, meta, rows, batchesByPo, open, toggle, busy, dateOf, setDate, today, onShipRemaining, onReopen, onPatchBatch, onSaveNotes, poSearch, docCounts, onDocs }: {
  stage: Stage; meta: StageMeta; rows: OpsRow[]; batchesByPo: Map<number, Batch[]>; open: Set<string>; toggle: (k: string) => void; busy: string | null
  dateOf: (k: string) => string; setDate: (k: string, v: string) => void; today: string
  onShipRemaining: (l: OpsRow, key: string) => void; onReopen: (id: number, key: string) => void
  onPatchBatch: (batchId: number, patch: Record<string, any>, key: string) => void
  onSaveNotes: (id: number, notes: string, key: string) => void; poSearch: string
  docCounts: Record<string, number>; onDocs: (po: string) => void
}) {
  const isPartial = stage === 'partial'
  return (
    <table className="w-full text-[12.5px]">
      <thead className="sticky top-0 z-10" style={{ background: meta.bg }}>
        <tr className="border-b border-gray-200">
          <Th> </Th><Th>PO #</Th><Th>Country</Th><Th>KA</Th><Th>SKU</Th><Th>Product</Th>
          <Th right>{isPartial ? 'Ordered' : 'Qty'}</Th>
          {isPartial && <Th right className="text-emerald-600">Delivered</Th>}
          {isPartial && <Th right className="text-amber-600">Remaining ⏳</Th>}
          <Th right>Unit Price</Th><Th>PO Date</Th><Th>🚚 Ship Date</Th><Th center>Action</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map(l => {
          const o = open.has(`l${l.id}`)
          const lk = `line:${l.id}`
          const bs = batchesByPo.get(l.id) ?? []
          const remaining = l.qty - (l.delivered_qty ?? 0)
          const undelivered = bs.filter(b => !b.delivery_date).length
          return (
            <Fragment key={l.id}>
              <tr className="hover:bg-gray-50/60">
                <td className="pl-3 pr-1 py-2 w-6 cursor-pointer" onClick={() => toggle(`l${l.id}`)}>
                  <span className="inline-block text-gray-400 transition-transform" style={{ transform: o ? 'rotate(90deg)' : 'none' }}>▶</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{l.po_number ?? '–'}<DocsBadge po={l.po_number} count={docCounts[l.po_number ?? ''] ?? 0} onDocs={onDocs} /></td>
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{l.country_flag} {l.country_code}</span></td>
                <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{l.ka_name ?? '-'}</span></td>
                <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{l.sku_code}</td>
                <td className="px-3 py-2 text-gray-600">{l.sku_name || '-'}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(l.qty)}</td>
                {isPartial && <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums">{fmtNum(l.delivered_qty ?? 0)}</td>}
                {isPartial && <td className="px-3 py-2 text-right font-bold text-amber-700 tabular-nums">{fmtNum(remaining)}</td>}
                <td className="px-3 py-2 text-right tabular-nums text-gray-500 whitespace-nowrap">{fmtMoney(l.fd_buying_price, l.currency)}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{l.po_date}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">
                  {l.ship_date ?? '–'}
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500" title={`${bs.length} 批发运，${undelivered} 批未录送达日`}>{bs.length}批</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-1.5 w-[164px]">
                    {isPartial && (
                      <>
                        <input type="date" value={dateOf(lk)} max={today} onChange={e => setDate(lk, e.target.value)} className="lg-date w-full" />
                        <button onClick={() => onShipRemaining(l, lk)} disabled={busy === lk} className="btn b-green w-full">{busy === lk ? '…' : `🚚 Ship remaining ${fmtNum(remaining)}`}</button>
                      </>
                    )}
                    {!isPartial && (
                      <button onClick={() => toggle(`l${l.id}`)} className="btn b-blue w-full" title="展开逐批录入送达日">📬 录送达日 ({undelivered})</button>
                    )}
                    <button onClick={() => onReopen(l.id, lk)} disabled={busy === lk} className="btn b-grey w-full">↩ Reopen</button>
                  </div>
                </td>
              </tr>
              {o && (
                <tr className="bg-slate-50/60">
                  <td></td>
                  <td colSpan={isPartial ? 12 : 10} className="px-3 py-2.5">
                    <BatchPanel batches={bs} lineQty={l.qty} busy={busy} today={today} onPatch={onPatchBatch} />
                    <LineNotes line={l} busy={busy} onSave={onSaveNotes} />
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {!rows.length && <tr><td colSpan={13} className="py-12 text-center text-gray-300">{poSearch ? `没有匹配「${poSearch}」的 PO` : '此阶段暂无记录 🎉'}</td></tr>}
      </tbody>
    </table>
  )
}

// 批次面板：每批的 qty / 发货日 / 送达日（可录入）/ 备注（可编辑）
function BatchPanel({ batches, lineQty, busy, today, onPatch }: {
  batches: Batch[]; lineQty: number; busy: string | null; today: string
  onPatch: (batchId: number, patch: Record<string, any>, key: string) => void
}) {
  const [d, setD] = useState<Record<number, string>>({})
  const [n, setN] = useState<Record<number, string>>(() => Object.fromEntries(batches.map(b => [b.id, b.notes ?? ''])))
  const shipped = batches.reduce((s, b) => s + b.qty, 0)

  return (
    <>
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
        发货批次 · {batches.length} 批 · 已发 {fmtNum(shipped)} / {fmtNum(lineQty)}
      </div>
      {!batches.length ? <div className="text-xs text-gray-300 py-3">暂无批次</div> : (
        <table className="w-full text-[12px] mb-2">
          <thead><tr className="text-left text-[10.5px] text-gray-500 border-b border-gray-200">
            <th className="py-1 pr-3 font-semibold">批次</th><th className="py-1 pr-3 font-semibold text-right">Qty</th>
            <th className="py-1 pr-3 font-semibold">🚚 Ship Date</th><th className="py-1 pr-3 font-semibold">📬 Delivery Date</th>
            <th className="py-1 font-semibold">Notes</th>
          </tr></thead>
          <tbody>
            {batches.map((b, i) => {
              const bk = `batch:${b.id}`
              const dirty = (n[b.id] ?? '') !== (b.notes ?? '')
              return (
                <tr key={b.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-1.5 pr-3 text-gray-400">#{i + 1}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmtNum(b.qty)}</td>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">{b.ship_date ?? '–'}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {b.delivery_date ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-emerald-700">{b.delivery_date}</span>
                        <button onClick={() => onPatch(b.id, { delivery_date: null }, bk)} disabled={busy === bk} className="text-gray-300 hover:text-rose-500 text-xs" title="清除送达日">×</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <input type="date" value={d[b.id] ?? today} max={today} onChange={e => setD(p => ({ ...p, [b.id]: e.target.value }))} className="lg-date" />
                        <button onClick={() => onPatch(b.id, { delivery_date: d[b.id] ?? today }, bk)} disabled={busy === bk} className="btn b-green" style={{ padding: '4px 8px' }}>
                          {busy === bk ? '…' : '📬 送达'}
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-1.5">
                      <input value={n[b.id] ?? ''} onChange={e => setN(p => ({ ...p, [b.id]: e.target.value }))} placeholder="本批备注…"
                        className="fld flex-1 min-w-0 h-[28px] text-[11px] py-1" />
                      <button onClick={() => onPatch(b.id, { notes: (n[b.id] ?? '').trim() || null }, bk)} disabled={!dirty || busy === bk}
                        className={`shrink-0 px-2 py-1 text-[11px] rounded-md ${dirty ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400'}`}>Save</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

function LineNotes({ line, busy, onSave }: { line: OpsRow; busy: string | null; onSave: (id: number, notes: string, key: string) => void }) {
  const [v, setV] = useState(line.notes ?? '')
  const lk = `note:${line.id}`
  const dirty = v !== (line.notes ?? '')
  return (
    <div className="flex items-start gap-2 mt-1">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-1.5 shrink-0">行备注</span>
      <textarea value={v} onChange={e => setV(e.target.value)} rows={1} placeholder="整行备注（跨批次）…"
        className="flex-1 min-w-0 resize-y rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-gray-400" />
      <button onClick={() => onSave(line.id, v, lk)} disabled={!dirty || busy === lk}
        className={`shrink-0 px-2.5 py-1 text-xs rounded-md ${dirty ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400'}`}>Save</button>
    </div>
  )
}

function CancelledTable({ meta, rows, busy, onReopen, poSearch, docCounts, onDocs }: { meta: StageMeta; rows: OpsRow[]; busy: string | null; onReopen: (id: number, key: string) => void; poSearch: string; docCounts: Record<string, number>; onDocs: (po: string) => void }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead className="sticky top-0 z-10" style={{ background: meta.bg }}>
        <tr className="border-b border-gray-200">
          <Th>PO #</Th><Th>Country</Th><Th>KA</Th><Th>SKU</Th><Th>Product</Th><Th right>Qty</Th>
          <Th right>Unit Price</Th><Th right>Turnover</Th><Th>PO Date</Th><Th>Notes</Th><Th center>Action</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map(l => {
          const lk = `line:${l.id}`
          return (
            <tr key={l.id} className="hover:bg-gray-50/60">
              <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{l.po_number ?? '–'}<DocsBadge po={l.po_number} count={docCounts[l.po_number ?? ''] ?? 0} onDocs={onDocs} /></td>
              <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{l.country_flag} {l.country_code}</span></td>
              <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{l.ka_name ?? '-'}</span></td>
              <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{l.sku_code}</td>
              <td className="px-3 py-2 text-gray-600">{l.sku_name || '-'}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(l.qty)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-500 whitespace-nowrap">{fmtMoney(l.fd_buying_price, l.currency)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">{fmtMoney(l.turnover, l.currency)}</td>
              <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{l.po_date}</td>
              <td className="px-3 py-2 text-[11px] text-gray-400">{l.notes || '—'}</td>
              <td className="px-3 py-2 text-center">
                <button onClick={() => onReopen(l.id, lk)} disabled={busy === lk} className="btn b-grey">↩ Reopen</button>
              </td>
            </tr>
          )
        })}
        {!rows.length && <tr><td colSpan={11} className="py-12 text-center text-gray-300">{poSearch ? `没有匹配「${poSearch}」的 PO` : '没有记录'}</td></tr>}
      </tbody>
    </table>
  )
}

// ===== Shipped：按 PO # 归并（📎 挂 PO 主行），展开逐 SKU 逐批录送达日 + Reopen =====
function ShippedGroupedTable({ meta, rows, batchesByPo, open, toggle, busy, today, onReopen, onPatchBatch, onSaveNotes, onDeliverGroup, poSearch, docCounts, onDocs }: {
  meta: StageMeta; rows: OpsRow[]; batchesByPo: Map<number, Batch[]>; open: Set<string>; toggle: (k: string) => void; busy: string | null; today: string
  onReopen: (id: number, key: string) => void
  onPatchBatch: (batchId: number, patch: Record<string, any>, key: string) => void
  onSaveNotes: (id: number, notes: string, key: string) => void
  onDeliverGroup: (lineIds: number[], date: string, key: string) => void
  poSearch: string; docCounts: Record<string, number>; onDocs: (po: string) => void
}) {
  const [gdate, setGdate] = useState<Record<string, string>>({})
  const groups = useMemo(() => groupByPo(rows).map(g => {
    const all = g.lines.flatMap(l => batchesByPo.get(l.id) ?? [])
    const ships = all.map(b => b.ship_date).filter(Boolean) as string[]
    return { ...g, firstShip: ships.length ? ships.reduce((a, b) => a < b ? a : b) : null, undelivered: all.filter(b => !b.delivery_date).length }
  }), [rows, batchesByPo])

  return (
    <table className="w-full text-[12.5px]">
      <thead className="sticky top-0 z-10" style={{ background: meta.bg }}>
        <tr className="border-b border-gray-200">
          <Th> </Th><Th>PO #</Th><Th>Country</Th><Th>KA</Th><Th center>SKUs</Th><Th right>Total Qty</Th><Th>PO Date</Th><Th>Shipped</Th><Th center>整单送达 / 逐批</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {groups.map(g => {
          const o = open.has(g.key)
          const gk = `grp:${g.key}`
          return (
            <Fragment key={g.key}>
              <tr className="hover:bg-gray-50/60 cursor-pointer" onClick={() => toggle(g.key)}>
                <td className="pl-3 pr-1 py-2 w-6"><span className="inline-block text-gray-400 transition-transform" style={{ transform: o ? 'rotate(90deg)' : 'none' }}>▶</span></td>
                <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{g.po_number ?? <span className="text-gray-300">（无 PO #）</span>}<DocsBadge po={g.po_number} count={docCounts[g.po_number ?? ''] ?? 0} onDocs={onDocs} /></td>
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{g.country_flag} {g.country_code}</span></td>
                <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{g.ka_name ?? '-'}</span></td>
                <td className="px-3 py-2 text-center text-gray-500 tabular-nums">{g.lines.length}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtNum(g.qty)}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.po_date}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.firstShip ?? '–'}</td>
                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                  {g.undelivered > 0 ? (
                    <div className="flex items-center gap-1.5 justify-center">
                      <input type="date" value={gdate[g.key] ?? today} max={today} onChange={e => setGdate(p => ({ ...p, [g.key]: e.target.value }))} className="lg-date" />
                      <button onClick={() => { if (confirm(`把整张 PO 的 ${g.undelivered} 个未录批次全部标记为 ${gdate[g.key] ?? today} 送达？`)) onDeliverGroup(g.lines.map(l => l.id), gdate[g.key] ?? today, gk) }}
                        disabled={busy === gk} className="btn b-green whitespace-nowrap">{busy === gk ? '…' : `📬 整单送达 (${g.undelivered})`}</button>
                    </div>
                  ) : <div className="text-center"><span className="inline-block px-2 py-0.5 rounded text-[11px] bg-emerald-50 text-emerald-700">✓ 全部已达</span></div>}
                </td>
              </tr>
              {o && (
                <tr className="bg-slate-50/60">
                  <td></td>
                  <td colSpan={8} className="px-3 py-2.5">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{g.lines.length} 个 SKU · 展开逐批录送达日</div>
                    <table className="w-full text-[12px]">
                      <thead><tr className="text-left text-[10.5px] text-gray-500 border-b border-gray-200">
                        <th className="py-1 pr-3 font-semibold w-5"></th><th className="py-1 pr-3 font-semibold">SKU</th><th className="py-1 pr-3 font-semibold">Product</th>
                        <th className="py-1 pr-3 font-semibold text-right">Qty</th><th className="py-1 pr-3 font-semibold">🚚 Ship Date</th><th className="py-1 font-semibold text-right">Action</th>
                      </tr></thead>
                      <tbody>
                        {g.lines.map(l => {
                          const lo = open.has(`l${l.id}`)
                          const lk = `line:${l.id}`
                          const bs = batchesByPo.get(l.id) ?? []
                          const undelivered = bs.filter(b => !b.delivery_date).length
                          return (
                            <Fragment key={l.id}>
                              <tr className="border-b border-gray-100 last:border-0 align-top">
                                <td className="py-1.5 pr-1 cursor-pointer" onClick={() => toggle(`l${l.id}`)}><span className="inline-block text-gray-400 transition-transform text-[10px]" style={{ transform: lo ? 'rotate(90deg)' : 'none' }}>▶</span></td>
                                <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-700 whitespace-nowrap">{l.sku_code}</td>
                                <td className="py-1.5 pr-3 text-gray-600">{l.sku_name || '-'}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmtNum(l.qty)}</td>
                                <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">{l.ship_date ?? '–'}<span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500">{bs.length}批</span></td>
                                <td className="py-1.5">
                                  <div className="flex gap-1.5 justify-end">
                                    <button onClick={() => toggle(`l${l.id}`)} className="btn b-blue" title="展开逐批录入送达日">📬 录送达日 ({undelivered})</button>
                                    <button onClick={() => onReopen(l.id, lk)} disabled={busy === lk} className="btn b-grey">↩ Reopen</button>
                                  </div>
                                </td>
                              </tr>
                              {lo && (
                                <tr><td></td><td colSpan={5} className="py-2">
                                  <BatchPanel batches={bs} lineQty={l.qty} busy={busy} today={today} onPatch={onPatchBatch} />
                                  <LineNotes line={l} busy={busy} onSave={onSaveNotes} />
                                </td></tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {!groups.length && <tr><td colSpan={9} className="py-12 text-center text-gray-300">{poSearch ? `没有匹配「${poSearch}」的 PO` : '此阶段暂无记录 🎉'}</td></tr>}
      </tbody>
    </table>
  )
}

// ===== Delivered：按 PO # 归并，展开逐 SKU 逐批次追溯 =====
function DeliveredTable({ meta, rows, batchesByPo, open, toggle, poSearch, docCounts, onDocs }: {
  meta: StageMeta; rows: OpsRow[]; batchesByPo: Map<number, Batch[]>; open: Set<string>; toggle: (k: string) => void; poSearch: string
  docCounts: Record<string, number>; onDocs: (po: string) => void
}) {
  const groups = useMemo(() => {
    const gs = groupByPo(rows)
    return gs.map(g => {
      const all = g.lines.flatMap(l => batchesByPo.get(l.id) ?? [])
      const dels = all.map(b => b.delivery_date).filter(Boolean) as string[]
      const ships = all.map(b => b.ship_date).filter(Boolean) as string[]
      return {
        ...g,
        turnover: g.lines.reduce((s, l) => s + (l.turnover ?? 0), 0),
        currency: g.lines[0]?.currency ?? null,
        firstShip: ships.length ? ships.reduce((a, b) => a < b ? a : b) : null,
        lastDelivery: dels.length ? dels.reduce((a, b) => a > b ? a : b) : null,
        batchCount: all.length,
      }
    }).sort((a, z) => (z.lastDelivery ?? '').localeCompare(a.lastDelivery ?? ''))
  }, [rows, batchesByPo])

  return (
    <table className="w-full text-[12.5px]">
      <thead className="sticky top-0 z-10" style={{ background: meta.bg }}>
        <tr className="border-b border-gray-200">
          <Th> </Th><Th>PO #</Th><Th>Country</Th><Th>KA</Th><Th center>SKUs</Th>
          <Th right>Total Qty</Th><Th right>Total Value</Th><Th>PO Date</Th><Th>Shipped</Th><Th>Delivered</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {groups.map(g => {
          const o = open.has(g.key)
          const multi = g.batchCount > g.lines.length
          return (
            <Fragment key={g.key}>
              <tr className="hover:bg-gray-50/60 cursor-pointer" onClick={() => toggle(g.key)}>
                <td className="pl-3 pr-1 py-2 w-6"><span className="inline-block text-gray-400 transition-transform" style={{ transform: o ? 'rotate(90deg)' : 'none' }}>▶</span></td>
                <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{g.po_number ?? <span className="text-gray-300">（无 PO #）</span>}<DocsBadge po={g.po_number} count={docCounts[g.po_number ?? ''] ?? 0} onDocs={onDocs} /></td>
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{g.country_flag} {g.country_code}</span></td>
                <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{g.ka_name ?? '-'}</span></td>
                <td className="px-3 py-2 text-center text-gray-500 tabular-nums">
                  {g.lines.length}
                  {multi && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700" title={`共 ${g.batchCount} 批发运`}>{g.batchCount} 批</span>}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtNum(g.qty)}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">{g.turnover ? fmtMoney(g.turnover, g.currency) : '–'}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.po_date}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.firstShip ?? '–'}</td>
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{g.lastDelivery ?? '–'}</span></td>
              </tr>
              {o && (
                <tr className="bg-slate-50/60">
                  <td></td>
                  <td colSpan={9} className="px-3 py-2.5">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">发货明细 · {g.lines.length} 个 SKU · {g.batchCount} 批发运</div>
                    <table className="w-full text-[12px]">
                      <thead><tr className="text-left text-[10.5px] text-gray-500 border-b border-gray-200">
                        <th className="py-1 pr-3 font-semibold">SKU</th><th className="py-1 pr-3 font-semibold">Product</th>
                        <th className="py-1 pr-3 font-semibold text-right">批次 Qty</th><th className="py-1 pr-3 font-semibold text-right">Unit Price</th>
                        <th className="py-1 pr-3 font-semibold">🚚 Ship Date</th><th className="py-1 pr-3 font-semibold">📬 Delivery Date</th>
                        <th className="py-1 font-semibold">Notes</th>
                      </tr></thead>
                      <tbody>
                        {g.lines.flatMap(l => {
                          const bs = batchesByPo.get(l.id) ?? []
                          const src: (Batch | null)[] = bs.length ? bs : [null]
                          return src.map((b, i) => (
                            <tr key={`${l.id}-${b?.id ?? 'x'}`} className="border-b border-gray-100 last:border-0">
                              <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-700 whitespace-nowrap">{i === 0 ? l.sku_code : ''}</td>
                              <td className="py-1.5 pr-3 text-gray-600">{i === 0 ? (l.sku_name || '-') : <span className="text-gray-300 pl-2">↳ 第 {i + 1} 批</span>}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmtNum(b ? b.qty : l.qty)}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500 whitespace-nowrap">{i === 0 ? fmtMoney(l.fd_buying_price, l.currency) : ''}</td>
                              <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">{(b ? b.ship_date : l.ship_date) ?? '–'}</td>
                              <td className="py-1.5 pr-3 font-mono text-[11px] text-emerald-700 whitespace-nowrap">{(b ? b.delivery_date : l.delivery_date) ?? '–'}</td>
                              <td className="py-1.5 text-[11px] text-gray-400">{(b?.notes) || (i === 0 ? l.notes : '') || '—'}</td>
                            </tr>
                          ))
                        })}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {!groups.length && <tr><td colSpan={10} className="py-12 text-center text-gray-300">{poSearch ? `没有匹配「${poSearch}」的 PO` : '没有记录'}</td></tr>}
      </tbody>
    </table>
  )
}

// ===== Export Excel: pick POs → one row per SKU, batches expanded across, unknown ETA left blank to fill =====
const STAGE_LABEL: Record<Stage, string> = { new: 'New PO', toship: 'To Ship', shipped: 'Shipped', delivered: 'Delivered', partial: 'Partial', cancelled: 'Cancelled' }
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildXlsHtml(groups: Grp[], batchesByPo: Map<number, Batch[]>, today: string): string {
  // max batches of any single SKU in the selection → how many batch column-groups to expand
  let maxB = 1
  groups.forEach(g => g.lines.forEach(l => { maxB = Math.max(maxB, (batchesByPo.get(l.id) ?? []).length) }))

  const th = (t: string) => `<th style="background:#1f2937;color:#fff;border:0.5px solid #94a3b8;padding:5px 8px;font-weight:600;">${esc(t)}</th>`
  // numeric cells: no format (stay summable in Excel); text/date cells: mso-number-format '@' to avoid mangling SKU codes / PO#s / ISO dates
  const td = (t: any, opt: { num?: boolean; c?: string; bg?: string } = {}) =>
    `<td style="border:0.5px solid #cbd5e1;padding:4px 8px;${opt.num ? 'text-align:right;' : "mso-number-format:'\\@';"}${opt.c ? `color:${opt.c};` : ''}${opt.bg ? `background:${opt.bg};` : ''}">${esc(t)}</td>`

  const fixedCols = ['PO #', 'KA', 'PO Date', 'SKU', 'Product', 'Status', 'Ordered', 'Shipped', 'Remaining']
  const totalCols = fixedCols.length + maxB * 3 + 2   // + batch groups + (Backorder ETA, Notes)

  const batchGroupTh = Array.from({ length: maxB }, (_, i) =>
    `<th colspan="3" style="background:#0f766e;color:#fff;border:0.5px solid #94a3b8;padding:5px 8px;font-weight:600;">Batch ${i + 1}</th>`).join('')
  const batchSubTh = Array.from({ length: maxB }, () => `${th('Qty')}${th('Ship Date')}${th('ETA')}`).join('')

  const head =
    `<tr>${fixedCols.map(h => `<th rowspan="2" style="background:#1f2937;color:#fff;border:0.5px solid #94a3b8;padding:5px 8px;font-weight:600;">${esc(h)}</th>`).join('')}` +
    batchGroupTh +
    `<th rowspan="2" style="background:#b45309;color:#fff;border:0.5px solid #94a3b8;padding:5px 8px;font-weight:600;">Backorder ETA (fill in)</th>` +
    `<th rowspan="2" style="background:#1f2937;color:#fff;border:0.5px solid #94a3b8;padding:5px 8px;font-weight:600;">Notes</th></tr>` +
    `<tr>${batchSubTh}</tr>`

  const spacer = `<tr><td colspan="${totalCols}" style="height:7px;border:none;background:#fff;"></td></tr>`

  // one blank row between different POs
  const body = groups.map(g => g.lines.map(l => {
    const bs = batchesByPo.get(l.id) ?? []
    const delivered = bs.reduce((s, b) => s + b.qty, 0)
    const remaining = l.qty - delivered
    const stage = STAGE_LABEL[stageOf(l)]
    const batchCells = Array.from({ length: maxB }, (_, i) => {
      const b = bs[i]
      if (!b) return td('') + td('') + td('')
      // ETA = delivery date; shipped-but-not-delivered → blank orange cell to fill in
      return td(b.qty, { num: true }) + td(b.ship_date ?? '') + td(b.delivery_date ?? '', { bg: b.delivery_date ? '' : '#fff7ed' })
    }).join('')
    return `<tr>` +
      td(l.po_number ?? '') + td(l.ka_name ?? '') + td(l.po_date) +
      td(l.sku_code) + td(l.sku_name) + td(stage) +
      td(l.qty, { num: true }) + td(delivered, { num: true }) + td(remaining, { num: true, c: remaining > 0 ? '#b45309' : '' }) +
      batchCells +
      td('', { bg: remaining > 0 ? '#fff7ed' : '' }) +   // Backorder ETA — blank to fill
      td(l.notes ?? '') +
      `</tr>`
  }).join('')).join(spacer)

  const skuLines = groups.reduce((s, g) => s + g.lines.length, 0)
  const title = `<tr><td colspan="4" style="font-size:15px;font-weight:700;padding:6px 8px;">INIU · PO Shipment Tracking</td>` +
    `<td colspan="${totalCols - 4}" style="padding:6px 8px;color:#64748b;">Exported ${today} · ${groups.length} POs · ${skuLines} SKU lines · orange cells = ETA to fill in</td></tr>`

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">` +
    `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>PO Tracking</x:Name>` +
    `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->` +
    `</head><body><table border="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:12px;">` +
    `<thead>${title}${head}</thead><tbody>${body}</tbody></table></body></html>`
}

function ExportModal({ rows, batchesByPo, today, onClose }: {
  rows: OpsRow[]; batchesByPo: Map<number, Batch[]>; today: string; onClose: () => void
}) {
  const groups = useMemo(() => groupByPo(rows), [rows])   // all POs, PO date desc
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [kaFilter, setKaFilter] = useState('')

  const kaOptions = useMemo(() =>
    Array.from(new Set(groups.map(g => g.ka_name).filter(Boolean) as string[])).sort(), [groups])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return groups.filter(g =>
      (!s || (g.po_number ?? '').toLowerCase().includes(s)) &&
      (!kaFilter || g.ka_name === kaFilter))
  }, [groups, q, kaFilter])

  const allShownSelected = shown.length > 0 && shown.every(g => sel.has(g.key))
  const toggle = (k: string) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleAll = () => setSel(s => {
    const n = new Set(s)
    if (allShownSelected) shown.forEach(g => n.delete(g.key))
    else shown.forEach(g => n.add(g.key))
    return n
  })

  const grpStage = (g: Grp) => {
    const set = new Set(g.lines.map(l => STAGE_LABEL[stageOf(l)]))
    return set.size === 1 ? [...set][0] : `Mixed (${set.size})`
  }
  const grpBatches = (g: Grp) => g.lines.reduce((s, l) => s + (batchesByPo.get(l.id) ?? []).length, 0)

  const doExport = () => {
    const picked = groups.filter(g => sel.has(g.key))
    if (!picked.length) { alert('Please select at least one PO.'); return }
    const html = buildXlsHtml(picked, batchesByPo, today)
    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `Order Leadtime-${today.replace(/-/g, '')}.xls`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[820px] p-5 max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-lg font-semibold text-gray-900">📋 Order Leadtime <span className="text-sm font-normal text-gray-400">· 导出交期表</span></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-400 mb-3">勾选要导出的 PO（按 PO 日期从近到远）。每 SKU 一行、发货批次横向展开；未发尾单与在途批次的 ETA 是 <span className="text-amber-600 font-medium">橙色空白格</span>——在 Excel 里手填到货日后即可发客户追踪交期。</div>

        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1 max-w-[220px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO #…" className="fld pl-7 pr-3 w-full h-[32px] text-[13px]" />
          </div>
          <select value={kaFilter} onChange={e => setKaFilter(e.target.value)} className="fld h-[32px] text-[13px] py-0">
            <option value="">All KAs</option>
            {kaOptions.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <button onClick={toggleAll} className="btn b-grey" style={{ padding: '6px 12px' }}>{allShownSelected ? 'Clear' : 'Select all'} ({shown.length})</button>
          <span className="ml-auto text-xs text-gray-500">Selected <strong className="text-gray-800">{sel.size}</strong></span>
        </div>

        <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 w-8"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /></th>
                <Th>PO #</Th><Th>KA</Th><Th>PO Date</Th><Th center>SKUs</Th><Th right>Qty</Th><Th center>Batches</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map(g => {
                const on = sel.has(g.key)
                return (
                  <tr key={g.key} className={`cursor-pointer ${on ? 'bg-emerald-50/50' : 'hover:bg-gray-50/60'}`} onClick={() => toggle(g.key)}>
                    <td className="px-3 py-2 text-center"><input type="checkbox" checked={on} onChange={() => toggle(g.key)} onClick={e => e.stopPropagation()} /></td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{g.po_number ?? <span className="text-gray-300">(no PO#)</span>}</td>
                    <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{g.ka_name ?? '-'}</span></td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.po_date}</td>
                    <td className="px-3 py-2 text-center text-gray-500 tabular-nums">{g.lines.length}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(g.qty)}</td>
                    <td className="px-3 py-2 text-center text-gray-500 tabular-nums">{grpBatches(g)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{grpStage(g)}</td>
                  </tr>
                )
              })}
              {!shown.length && <tr><td colSpan={8} className="py-10 text-center text-gray-300">No matching PO</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center mt-4">
          <span className="text-xs text-gray-400">导出 <span className="font-mono text-gray-500">Order Leadtime-{today.replace(/-/g, '')}.xls</span> · Excel / WPS 直接打开</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">取消</button>
            <button onClick={doExport} disabled={!sel.size}
              className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">📋 导出 ({sel.size})</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== PO Details 导出：选 PO → 导出为「线下零售渠道发货记录表 · PO Details」子表格式（可粘贴）=====
// 行2列头必须与母表逐列一致（col0..col45）。空字符串 = 母表里该列本就空。
const POD_HEADERS: string[] = [
  'Region', 'PO #', 'PO Date', 'Requested Ship Date', 'Requested Delivery Date', 'Customer', 'Seller', 'Part Number', 'UPC',
  'Qty. Ordered', '新数量', '箱数', 'Unit Cost', 'Subtotal', '沃尔玛/B&H预计打款金额', 'Currency', 'Payment Term', 'Ship to',
  'Shipping Label', '出库单号（国内直发）', 'Note', '', '出库单号（海外仓中转）', 'Invoice #', 'Invoice Amount', 'Check #',
  'Ship Date', 'ASN Sent Date', 'Delivery Date', 'Invoice Date', 'Due Date', 'Payment Method', 'Payment Receive Date',
  'Amount', '币种', 'Payment Status', '备注', '', '', '', '', '', '', '', '', '',
]
// 行1 分组抬头（col → 文本），逐列复刻母表
const POD_GROUP: Record<number, string> = { 0: '大客户运营--红方填写', 23: '大客户--朱江Shea填写', 31: '财务--钟小婷填写', 39: 'Walmart 接收&申诉情况' }

function buildPoDetailsXls(lines: OpsRow[], today: string): string {
  const esc2 = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const N = POD_HEADERS.length
  const td = (v: any, opt: { num?: boolean } = {}) =>
    `<td style="border:0.5px solid #ccc;padding:3px 6px;${opt.num ? 'text-align:right;' : "mso-number-format:'\\@';"}">${esc2(v)}</td>`
  // 每行 PO 明细：只填指定列，其余留空
  const rowCells = (l: OpsRow): (string | number)[] => {
    const c = Array(N).fill('') as (string | number)[]
    c[0] = 'Europe'; c[1] = l.po_number ?? ''; c[2] = l.po_date ?? ''; c[5] = l.ka_name ?? ''; c[6] = 'INIU'
    c[7] = l.sku_code; c[8] = l.ean ?? ''; c[9] = l.qty
    c[12] = l.fd_buying_price ?? ''; c[15] = l.currency ?? ''
    return c
  }
  const numCols = new Set([9, 12])   // 数量/单价右对齐、按数字
  const groupRow = `<tr>${Array.from({ length: N }, (_, i) => `<th style="background:#fde68a;border:0.5px solid #ccc;padding:3px 6px;font-weight:600;">${esc2(POD_GROUP[i] ?? '')}</th>`).join('')}</tr>`
  const headRow = `<tr>${POD_HEADERS.map(h => `<th style="background:#f5b301;border:0.5px solid #b8860b;padding:4px 6px;font-weight:700;white-space:nowrap;">${esc2(h)}</th>`).join('')}</tr>`
  const body = lines.map(l => { const c = rowCells(l); return `<tr>${c.map((v, i) => td(v, { num: numCols.has(i) })).join('')}</tr>` }).join('')

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">` +
    `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>PO Details</x:Name>` +
    `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>` +
    `<body><table border="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:12px;">${groupRow}${headRow}${body}</table></body></html>`
}

function PoDetailsExportModal({ rows, today, onClose }: { rows: OpsRow[]; today: string; onClose: () => void }) {
  const groups = useMemo(() => groupByPo(rows), [rows])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [kaFilter, setKaFilter] = useState('')
  const kaOptions = useMemo(() => Array.from(new Set(groups.map(g => g.ka_name).filter(Boolean) as string[])).sort(), [groups])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return groups.filter(g => (!s || (g.po_number ?? '').toLowerCase().includes(s)) && (!kaFilter || g.ka_name === kaFilter))
  }, [groups, q, kaFilter])
  const allShownSelected = shown.length > 0 && shown.every(g => sel.has(g.key))
  const toggle = (k: string) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleAll = () => setSel(s => { const n = new Set(s); if (allShownSelected) shown.forEach(g => n.delete(g.key)); else shown.forEach(g => n.add(g.key)); return n })

  const doExport = () => {
    const picked = groups.filter(g => sel.has(g.key))
    if (!picked.length) { alert('请先勾选要导出的 PO。'); return }
    const lines = picked.flatMap(g => g.lines)
    const blob = new Blob(['﻿' + buildPoDetailsXls(lines, today)], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `PO Details-${today.replace(/-/g, '')}.xls`
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    onClose()
  }

  const grpLines = (g: Grp) => g.lines.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[820px] p-5 max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-lg font-semibold text-gray-900">📄 PO Details <span className="text-sm font-normal text-gray-400">· 导出明细（粘贴回母表）</span></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-400 mb-3">勾选要导出的 PO，导出格式与「线下零售渠道发货记录表 · PO Details」子表**逐列一致**，可直接复制数据行粘贴回母表。已填：Region(Europe) / PO# / PO Date / Customer / Seller(INIU) / Part Number / UPC(有EAN才填) / Qty / Unit Cost / Currency；其余列留空。</div>

        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1 max-w-[220px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO #…" className="fld pl-7 pr-3 w-full h-[32px] text-[13px]" />
          </div>
          <select value={kaFilter} onChange={e => setKaFilter(e.target.value)} className="fld h-[32px] text-[13px] py-0">
            <option value="">All KAs</option>
            {kaOptions.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <button onClick={toggleAll} className="btn b-grey" style={{ padding: '6px 12px' }}>{allShownSelected ? 'Clear' : 'Select all'} ({shown.length})</button>
          <span className="ml-auto text-xs text-gray-500">已选 <strong className="text-gray-800">{sel.size}</strong></span>
        </div>

        <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 w-8"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /></th>
                <Th>PO #</Th><Th>Country</Th><Th>KA</Th><Th center>SKU 行</Th><Th right>Qty</Th><Th>PO Date</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map(g => {
                const on = sel.has(g.key)
                return (
                  <tr key={g.key} className={`cursor-pointer ${on ? 'bg-sky-50/60' : 'hover:bg-gray-50/60'}`} onClick={() => toggle(g.key)}>
                    <td className="px-3 py-2 text-center"><input type="checkbox" checked={on} onChange={() => toggle(g.key)} onClick={e => e.stopPropagation()} /></td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{g.po_number ?? <span className="text-gray-300">(no PO#)</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{g.country_flag} {g.country_code}</span></td>
                    <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{g.ka_name ?? '-'}</span></td>
                    <td className="px-3 py-2 text-center text-gray-500 tabular-nums">{grpLines(g)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(g.qty)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.po_date}</td>
                  </tr>
                )
              })}
              {!shown.length && <tr><td colSpan={7} className="py-10 text-center text-gray-300">No matching PO</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center mt-4">
          <span className="text-xs text-gray-400">导出 <span className="font-mono text-gray-500">PO Details-{today.replace(/-/g, '')}.xls</span> · 与母表逐列对齐</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">取消</button>
            <button onClick={doExport} disabled={!sel.size} className="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">📄 导出 ({sel.size})</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== 通用小件 =====
function RailNode({ meta, count, active, onClick }: { meta: StageMeta; count: number; active: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} className={`mainnode ${active ? 'active' : ''}`}
      style={{ ['--a' as any]: meta.a, ['--bg' as any]: meta.bg, ['--bd' as any]: meta.bd, ['--tx' as any]: meta.tx }}>
      <span className="ni">{meta.icon}</span><span className="nl">{meta.label}</span><span className="nc">{count}</span>
    </div>
  )
}
function RailBranch({ meta, count, active, onClick }: { meta: StageMeta; count: number; active: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} className={`branchnode ${active ? 'active' : ''}`}
      style={{ ['--a' as any]: meta.a, ['--bg' as any]: meta.bg, ['--bd' as any]: meta.bd, ['--tx' as any]: meta.tx }}>
      <span className="bi">{meta.icon}</span><span className="bl">{meta.label}</span><span className="bc">{count}</span>
    </div>
  )
}
function Th({ children, right, center, className = '' }: { children: React.ReactNode; right?: boolean; center?: boolean; className?: string }) {
  return <th className={`px-3 py-2.5 text-xs font-semibold text-gray-600 ${right ? 'text-right' : center ? 'text-center' : 'text-left'} ${className}`}>{children}</th>
}

// ===== 手动新建 PO（落 New PO；一张 PO 多个 SKU，每个 SKU 存一行）=====
type PoLine = { key: number; skuCode: string; qty: string; price: string }
const CCY_FMT = (v: number, ccy: string) => (ccy === 'PLN' ? 'zł ' : '€') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const lineTurnover = (l: PoLine): number | null => {
  const q = Number(l.qty), p = Number(l.price)
  if (!l.qty || !l.price || !Number.isFinite(q) || !Number.isFinite(p)) return null
  return Math.round(q * p * 100) / 100
}

function AddPoModal({ today, skus, countries, kas, onClose, onDone, supabase }: {
  today: string; skus: SkuOpt[]; countries: CountryOpt[]; kas: KaOpt[]
  onClose: () => void; onDone: () => void; supabase: ReturnType<typeof createClient>
}) {
  const [countryId, setCountryId] = useState<number | ''>('')
  const [kaId, setKaId] = useState<number | ''>('')
  const [poNumber, setPoNumber] = useState('')
  const [poDate, setPoDate] = useState(today)
  const [currency, setCurrency] = useState('EUR')
  const [lines, setLines] = useState<PoLine[]>([{ key: 1, skuCode: '', qty: '', price: '' }])
  const [saving, setSaving] = useState(false)
  const nextKey = useRef(2)

  const kaOptions = kas.filter(k => k.country_id === countryId)
  const skuByCode = useMemo(() => new Map(skus.map(s => [s.code.toLowerCase(), s])), [skus])
  const resolve = (code: string) => skuByCode.get(code.trim().toLowerCase())

  const addLine = () => setLines(ls => [...ls, { key: nextKey.current++, skuCode: '', qty: '', price: '' }])
  const delLine = (key: number) => setLines(ls => ls.length > 1 ? ls.filter(l => l.key !== key) : ls)
  const setLine = (key: number, patch: Partial<PoLine>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l))
  const grandTotal = lines.reduce((s, l) => s + (lineTurnover(l) ?? 0), 0)

  const submit = async () => {
    if (!countryId || !poDate) { alert('请填写：国家、PO 日期。'); return }
    const rows: any[] = []
    for (const [i, l] of lines.entries()) {
      const sku = resolve(l.skuCode)
      const q = Math.floor(Number(l.qty))
      if (!sku) { alert(`第 ${i + 1} 行：SKU「${l.skuCode || '空'}」无法识别，请从下拉里选或输入完整 SKU code。`); return }
      if (!Number.isFinite(q) || q <= 0) { alert(`第 ${i + 1} 行（${sku.code}）：数量必须 > 0。`); return }
      rows.push({
        country_id: countryId, ka_id: kaId || null, sku_id: sku.id,
        po_number: poNumber.trim() || null, po_date: poDate, qty_ordered: q,
        currency, fd_buying_price: l.price ? Number(l.price) : null, turnover: lineTurnover(l),
        source_file: 'manual',
      })
    }
    const dup = rows.map(r => r.sku_id).filter((v, i, a) => a.indexOf(v) !== i)
    if (dup.length && !confirm('同一张 PO 里有重复 SKU，仍要创建吗？')) return
    setSaving(true)
    const { error } = await supabase.from('channel_po').insert(rows)
    setSaving(false)
    if (error) { alert(`新建失败: ${error.message}`); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[720px] p-5 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold text-gray-900">🆕 Add PO manually</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-400 mb-4">新建的 PO 落入 <span className="text-indigo-600 font-medium">New PO</span>，核对后 Confirm 进入待发。一张 PO 可含多个 SKU，每个 SKU 存为一行。</div>

        <datalist id="sku-options">{skus.map(s => <option key={s.id} value={s.code}>{s.name}</option>)}</datalist>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Country *"><select value={countryId} onChange={e => { setCountryId(Number(e.target.value) || ''); setKaId('') }} className="fld">
            <option value="">—</option>{countries.map(c => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}</select></Field>
          <Field label="KA"><select value={kaId} onChange={e => setKaId(Number(e.target.value) || '')} disabled={!countryId} className="fld">
            <option value="">—</option>{kaOptions.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>
          <Field label="PO #"><input value={poNumber} onChange={e => setPoNumber(e.target.value)} className="fld" placeholder="optional" /></Field>
          <Field label="PO Date *"><input type="date" value={poDate} max={today} onChange={e => setPoDate(e.target.value)} className="fld" /></Field>
          <Field label="Currency"><select value={currency} onChange={e => setCurrency(e.target.value)} className="fld"><option>EUR</option><option>PLN</option></select></Field>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Line items · {lines.length}</span>
            <button onClick={addLine} className="btn b-indigo" style={{ padding: '5px 12px' }}>＋ Add SKU</button>
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 92px 108px 118px 30px' }}>
            <span className="text-[11px] font-medium text-gray-500">SKU *（可输入过滤）</span>
            <span className="text-[11px] font-medium text-gray-500 text-right">Qty *</span>
            <span className="text-[11px] font-medium text-gray-500 text-right">Unit Price</span>
            <span className="text-[11px] font-medium text-gray-500 text-right">Turnover 🔒</span>
            <span />
            {lines.map(l => {
              const sku = resolve(l.skuCode)
              const t = lineTurnover(l)
              const bad = !!l.skuCode && !sku
              return (
                <Fragment key={l.key}>
                  <div className="min-w-0">
                    <input list="sku-options" value={l.skuCode} onChange={e => setLine(l.key, { skuCode: e.target.value })}
                      placeholder="输入 PB / PX… 或点下拉" className={`fld w-full ${bad ? 'border-rose-400' : ''}`} />
                    <div className={`text-[10px] mt-0.5 truncate ${bad ? 'text-rose-500' : 'text-gray-400'}`}>{bad ? '⚠ 无法识别此 SKU' : sku ? sku.name : ' '}</div>
                  </div>
                  <input type="number" value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} placeholder="0" className="fld text-right h-[35px]" />
                  <input type="number" value={l.price} onChange={e => setLine(l.key, { price: e.target.value })} placeholder="optional" className="fld text-right h-[35px]" />
                  <div className="h-[35px] flex items-center justify-end px-2 rounded-lg bg-gray-50 border border-gray-200 text-[13px] tabular-nums text-gray-600">{t == null ? '–' : CCY_FMT(t, currency)}</div>
                  <button onClick={() => delLine(l.key)} disabled={lines.length === 1} title="删除此行"
                    className="h-[35px] rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:hover:bg-transparent transition">×</button>
                </Fragment>
              )
            })}
          </div>
          <div className="flex justify-end mt-2.5 text-sm">
            <span className="text-gray-500 mr-3">Total</span>
            <span className="font-semibold tabular-nums text-gray-800">{CCY_FMT(grandTotal, currency)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving ? 'Saving…' : `Create PO · ${lines.length} line${lines.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <label className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}><span className="text-[11px] font-medium text-gray-500">{label}</span>{children}</label>
}

function PosStyle() {
  return <style>{`
    .mainnode{cursor:pointer;display:flex;align-items:center;gap:9px;background:var(--bg);border:1.5px solid var(--bd);border-radius:12px;padding:11px 13px;transition:transform .14s,box-shadow .14s,border-color .14s}
    .mainnode:hover{transform:translateX(2px);box-shadow:0 4px 12px rgba(0,0,0,.07)}
    .mainnode.active{border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 20%,transparent)}
    .ni{font-size:19px}
    .nl{font-size:13.5px;font-weight:600;color:var(--tx);flex:1}
    .nc{font-size:17px;font-weight:700;color:var(--a);font-variant-numeric:tabular-nums}
    .conn{text-align:center;color:#d1d5db;font-size:13px;line-height:1;margin:3px 0}
    .branchwrap{margin:6px 0 6px 26px;padding-left:14px;border-left:1.5px dashed #e2c48f;display:flex;flex-direction:column;gap:6px}
    .branchnode{cursor:pointer;display:flex;align-items:center;gap:7px;background:var(--bg);border:1.5px solid var(--bd);border-radius:10px;padding:7px 10px;position:relative;transition:transform .14s,box-shadow .14s,border-color .14s}
    .branchnode::before{content:"";position:absolute;left:-15px;top:50%;width:13px;height:1.5px;background:#e2c48f}
    .branchnode:hover{transform:translateX(2px);box-shadow:0 3px 9px rgba(0,0,0,.06)}
    .branchnode.active{border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 20%,transparent)}
    .bi{font-size:14px}.bl{font-size:12px;font-weight:600;color:var(--tx);flex:1}.bc{font-size:13px;font-weight:700;color:var(--a)}
    .lg-date{background:rgba(120,120,128,.10);border:1px solid rgba(255,255,255,.6);box-shadow:inset 0 1px 1px rgba(255,255,255,.7);border-radius:10px;padding:5px 8px;font-size:11px;color:#374151;outline:none}
    .lg-date:focus{box-shadow:0 0 0 2px rgba(16,185,129,.25)}
    .btn{border-radius:10px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid transparent;transition:transform .12s,background .2s;white-space:nowrap;text-align:center}
    .btn:active{transform:scale(.97)}
    .btn:disabled{opacity:.5;cursor:default}
    .b-green{background:rgba(16,185,129,.20);border-color:rgba(16,185,129,.35);color:#065f46}.b-green:hover{background:rgba(16,185,129,.30)}
    .b-blue{background:rgba(120,120,128,.12);border-color:rgba(255,255,255,.55);color:#0369a1}.b-blue:hover{background:rgba(2,132,199,.15)}
    .b-red{background:rgba(120,120,128,.12);border-color:rgba(255,255,255,.55);color:#be123c}.b-red:hover{background:rgba(225,29,72,.14)}
    .b-grey{background:#f3f4f6;border-color:#e5e7eb;color:#4b5563}.b-grey:hover{background:#e5e7eb}
    .b-indigo{background:rgba(99,102,241,.16);border-color:rgba(99,102,241,.32);color:#3730a3}.b-indigo:hover{background:rgba(99,102,241,.26)}
    .fld{border:1px solid #d1d5db;border-radius:8px;padding:7px 9px;font-size:13px;outline:none;background:#fff}
    .fld:focus{box-shadow:0 0 0 2px rgba(99,102,241,.2);border-color:#a5b4fc}
  `}</style>
}
