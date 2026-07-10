'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils'
import { fmtMoney, stageOf, type OpsRow, type Stage } from '../../po/_ops'

export type SkuOpt = { id: number; code: string; name: string }
export type CountryOpt = { id: number; code: string; name: string; flag: string }
export type KaOpt = { id: number; name: string; country_id: number }

// 每个履约阶段的展示配置（颜色 / 图标 / 文案）
type StageMeta = { key: Stage; icon: string; label: string; a: string; bg: string; bd: string; tx: string; desc: string }
const STAGES: Record<Stage, StageMeta> = {
  new:       { key: 'new',       icon: '🆕', label: 'New PO',    a: '#6366f1', bg: '#eef2ff', bd: '#c7d2fe', tx: '#4338ca', desc: '刚导入 / 手动新建，尚未确认。核对无误后 Confirm 进入待发；也可直接作废。' },
  toship:    { key: 'toship',    icon: '📦', label: 'To Ship',   a: '#f59e0b', bg: '#fffbeb', bd: '#fde68a', tx: '#b45309', desc: '已确认、等待发货。全发→Mark shipped；只发一部分→Partial（剩余量转入 Partial 车道继续跟）；客户取消→Cancel。' },
  shipped:   { key: 'shipped',   icon: '✈️', label: 'Shipped',   a: '#10b981', bg: '#ecfdf5', bd: '#a7f3d0', tx: '#047857', desc: '已发货 / 在途。录入送达日即自动归入 Delivered。标错可 Reopen。' },
  delivered: { key: 'delivered', icon: '📬', label: 'Delivered', a: '#64748b', bg: '#f8fafc', bd: '#e2e8f0', tx: '#475569', desc: '有送达日 = 自动完成，无需人工操作。此处仅作追溯。' },
  partial:   { key: 'partial',   icon: '◑',  label: 'Partial',   a: '#0ea5e9', bg: '#f0f9ff', bd: '#bae6fd', tx: '#0369a1', desc: '部分已发，Remaining 为仍待发的未结量（open）。可多次 Ship remaining 分批发货；发完自动归 Shipped。' },
  cancelled: { key: 'cancelled', icon: '✗',  label: 'Cancelled', a: '#f43f5e', bg: '#fff1f2', bd: '#fecdd3', tx: '#be123c', desc: '已取消（仍计入总额，只是状态标签）。误操作可 Reopen 退回待发。' },
}

export function PoShipmentView({ rows, skus, countries, kas }: { rows: OpsRow[]; plnToEur: number; skus: SkuOpt[]; countries: CountryOpt[]; kas: KaOpt[] }) {
  const supabase = useRef(createClient()).current
  const router = useRouter()
  const today = useRef(new Date().toISOString().slice(0, 10)).current

  const [active, setActive] = useState<Stage>('toship')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [shipDate, setShipDate] = useState<Record<number, string>>({})
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>(() => Object.fromEntries(rows.map(r => [r.id, r.notes ?? ''])))
  const [savedId, setSavedId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [poSearch, setPoSearch] = useState('')                       // 按 PO # 搜索（对当前阶段生效）
  const [expandedPo, setExpandedPo] = useState<Set<string>>(new Set()) // Delivered 视图里展开的 PO

  // 按阶段分桶（互斥），并按日期倒序
  const buckets = useMemo(() => {
    const b: Record<Stage, OpsRow[]> = { new: [], toship: [], shipped: [], delivered: [], partial: [], cancelled: [] }
    rows.forEach(r => b[stageOf(r)].push(r))
    Object.values(b).forEach(arr => arr.sort((a, z) => (z.po_date ?? '').localeCompare(a.po_date ?? '')))
    return b
  }, [rows])

  const sd = (id: number) => shipDate[id] || today

  // 统一写回：patch → channel_po → 服务端重拉。busy 直到 refresh 完成组件带新数据重渲染。
  const run = async (id: number, patch: Record<string, any>) => {
    setBusyId(id)
    const { error } = await supabase.from('channel_po').update(patch).eq('id', id)
    if (error) { setBusyId(null); alert(`操作失败: ${error.message}`); return }
    router.refresh()
  }

  const confirmPo = (id: number) => run(id, { po_status: null })                 // New → To Ship
  const cancelPo = (id: number) => { if (confirm('取消这张 PO？\n仍计入总额，只是打上 Cancelled 状态标签。')) run(id, { po_status: 'cancelled' }) }
  const markShipped = (id: number) => run(id, { ship_date: sd(id) })            // To Ship → Shipped
  const markPartial = (id: number, ordered: number) => {
    const input = prompt(`部分发货 — 本次发货数量（共 ${ordered}）：`, '')
    if (input == null) return
    const n = Math.floor(Number(input))
    if (!Number.isFinite(n) || n <= 0 || n >= ordered) { alert(`请输入 1 到 ${ordered - 1} 之间的数量（整单发完请用 Mark shipped）。`); return }
    run(id, { po_status: 'partial', delivered_qty: n, ship_date: sd(id) })
  }
  const shipRemaining = (id: number, ordered: number, delivered: number) => {
    const remaining = ordered - delivered
    const input = prompt(`发运尾单 — 本次发货数量（剩余 ${remaining}）：`, String(remaining))
    if (input == null) return
    const n = Math.floor(Number(input))
    if (!Number.isFinite(n) || n <= 0 || n > remaining) { alert(`请输入 1 到 ${remaining} 之间的数量。`); return }
    const newDelivered = delivered + n
    if (newDelivered >= ordered) run(id, { po_status: null, delivered_qty: ordered, ship_date: sd(id) })  // 发完 → Shipped
    else run(id, { delivered_qty: newDelivered })                                                          // 仍 Partial，累加
  }
  const reopen = (id: number) => { if (confirm('退回 To Ship？\n将清除该行的 shipped / partial / cancelled 标记。')) run(id, { po_status: null, delivered_qty: null, ship_date: null }) }

  const saveNotes = async (id: number) => {
    setBusyId(id); setSavedId(null)
    const { error } = await supabase.from('channel_po').update({ notes: (notesDraft[id] ?? '').trim() || null }).eq('id', id)
    setBusyId(null)
    if (error) { alert(`备注保存失败: ${error.message}`); return }
    setSavedId(id); setTimeout(() => setSavedId(s => s === id ? null : s), 1800)
  }

  const m = STAGES[active]
  // 当前阶段的行，按 PO # 搜索过滤
  const list = useMemo(() => {
    const base = buckets[active]
    const q = poSearch.trim().toLowerCase()
    if (!q) return base
    return base.filter(r => (r.po_number ?? '').toLowerCase().includes(q))
  }, [buckets, active, poSearch])
  const isPartial = active === 'partial'
  const editableNotes = active === 'new' || active === 'toship' || active === 'partial' || active === 'cancelled'

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <PosStyle />
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">🚚 Shipment Workflow</h1>
        <p className="text-sm text-gray-500 mt-1">
          一条履约流水线管完整 PO 生命周期。点左侧阶段 → 右侧展开操作。公开 <span className="font-medium text-gray-700">PO</span> 页为只读看板，此处每次改动即时回流。
        </p>
      </div>

      <div className="flex gap-5 items-start">
        {/* ===== 左：竖向流水线 ===== */}
        <div className="w-[236px] flex-none">
          <RailNode meta={STAGES.new}       count={buckets.new.length}       active={active === 'new'}       onClick={() => setActive('new')} />
          <div className="conn">▼</div>
          <RailNode meta={STAGES.toship}    count={buckets.toship.length}    active={active === 'toship'}    onClick={() => setActive('toship')} />
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
            <span className="text-rose-700">✗ Cancelled</span> 可 Reopen 退回 <span className="text-amber-700">To Ship</span>
          </div>
        </div>

        {/* ===== 右：阶段操作卡片 ===== */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_20px_rgba(0,0,0,0.04)] p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-[15px] font-semibold" style={{ color: m.tx }}>{m.icon} {m.label}
                <span className="ml-2 text-xs font-normal text-gray-400">· {list.length} lines · {fmtNum(list.reduce((s, r) => s + r.qty, 0))} units</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5 max-w-[820px]">{m.desc}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
                <input value={poSearch} onChange={e => setPoSearch(e.target.value)} placeholder="Search PO #…"
                  className="fld pl-7 pr-7 w-[190px] h-[34px] text-[13px]" />
                {poSearch && (
                  <button onClick={() => setPoSearch('')} title="清除"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm leading-none">×</button>
                )}
              </div>
              {active === 'new' && (
                <button onClick={() => setAddOpen(true)} className="btn b-indigo" style={{ padding: '7px 14px' }}>＋ Add PO manually</button>
              )}
            </div>
          </div>

          {active === 'delivered' ? (
            <DeliveredTable rows={list} meta={m} expanded={expandedPo}
              onToggle={key => setExpandedPo(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })} />
          ) : (
          <div className="rounded-[10px] overflow-hidden mt-2.5" style={{ borderLeft: `3px solid ${m.a}` }}>
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto border border-gray-100 border-l-0 rounded-r-[10px]">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 z-10" style={{ background: m.bg }}>
                  <tr className="border-b border-gray-200">
                    <Th>Country</Th><Th>KA</Th><Th>SKU</Th><Th>Product</Th>
                    <Th right>Qty</Th>
                    {isPartial && <Th right className="text-emerald-600">Delivered</Th>}
                    {isPartial && <Th right className="text-amber-600">Remaining ⏳</Th>}
                    <Th>PO Date</Th>
                    <Th>Notes</Th>
                    <Th center>Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {list.map(r => {
                    const remaining = r.qty - (r.delivered_qty ?? 0)
                    const dirty = (notesDraft[r.id] ?? '') !== (r.notes ?? '')
                    return (
                      <tr key={r.id} className="hover:bg-gray-50/60 align-top">
                        <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{r.country_flag} {r.country_code}</span></td>
                        <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{r.ka_name ?? '-'}</span></td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{r.sku_code}</td>
                        <td className="px-3 py-2 text-gray-600">{r.sku_name || '-'}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(r.qty)}</td>
                        {isPartial && <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums">{fmtNum(r.delivered_qty ?? 0)}</td>}
                        {isPartial && <td className="px-3 py-2 text-right font-bold text-amber-700 tabular-nums">{fmtNum(remaining)}</td>}
                        <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{r.po_date}</td>
                        <td className="px-3 py-2" style={{ minWidth: 200 }}>
                          {editableNotes ? (
                            <div className="flex items-start gap-1.5">
                              <textarea value={notesDraft[r.id] ?? ''} onChange={e => setNotesDraft(p => ({ ...p, [r.id]: e.target.value }))} rows={2}
                                placeholder="备注…" className="flex-1 min-w-0 resize-y rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-gray-400" />
                              <button onClick={() => saveNotes(r.id)} disabled={!dirty || busyId === r.id}
                                className={`shrink-0 px-2 py-1 text-xs rounded-md transition ${dirty ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400'}`}>
                                {busyId === r.id ? '…' : savedId === r.id ? '✓' : 'Save'}
                              </button>
                            </div>
                          ) : <span className="text-xs text-gray-400">{r.notes || '—'}</span>}
                        </td>
                        <td className="px-3 py-2.5 align-middle">{renderActions(r, remaining)}</td>
                      </tr>
                    )
                  })}
                  {!list.length && <tr><td colSpan={12} className="py-12 text-center text-gray-300">{poSearch ? `没有匹配「${poSearch}」的 PO` : '此阶段暂无记录 🎉'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      </div>

      {addOpen && <AddPoModal today={today} skus={skus} countries={countries} kas={kas} onClose={() => setAddOpen(false)}
        onDone={() => { setAddOpen(false); router.refresh() }} supabase={supabase} />}
    </div>
  )

  // 每个阶段的操作按钮组
  function renderActions(r: OpsRow, remaining: number) {
    const busy = busyId === r.id
    const dateInput = (
      <input type="date" value={sd(r.id)} max={today} onChange={e => setShipDate(p => ({ ...p, [r.id]: e.target.value }))}
        className="lg-date w-full" />
    )
    if (active === 'new') return (
      <div className="flex flex-col gap-1.5 w-[150px]">
        <button onClick={() => confirmPo(r.id)} disabled={busy} className="btn b-green w-full">{busy ? '…' : '✅ Confirm → To Ship'}</button>
        <button onClick={() => cancelPo(r.id)} disabled={busy} className="btn b-red w-full">✗ Cancel</button>
      </div>
    )
    if (active === 'toship') return (
      <div className="flex flex-col gap-1.5 w-[150px]">
        {dateInput}
        <button onClick={() => markShipped(r.id)} disabled={busy} className="btn b-green w-full">{busy ? '…' : 'Mark shipped'}</button>
        <div className="flex gap-1.5">
          <button onClick={() => markPartial(r.id, r.qty)} disabled={busy} className="btn b-blue flex-1">Partial</button>
          <button onClick={() => cancelPo(r.id)} disabled={busy} className="btn b-red flex-1">Cancel</button>
        </div>
      </div>
    )
    if (active === 'partial') return (
      <div className="flex flex-col gap-1.5 w-[160px]">
        {dateInput}
        <button onClick={() => shipRemaining(r.id, r.qty, r.delivered_qty ?? 0)} disabled={busy} className="btn b-green w-full">{busy ? '…' : `🚚 Ship remaining ${fmtNum(remaining)}`}</button>
        <button onClick={() => reopen(r.id)} disabled={busy} className="btn b-grey w-full">↩ Reopen</button>
      </div>
    )
    if (active === 'shipped') return (
      <div className="flex items-center gap-2 w-[150px]">
        <span className="inline-block px-2 py-0.5 rounded text-xs bg-emerald-50 text-emerald-700 whitespace-nowrap">shipped {r.ship_date}</span>
        <button onClick={() => reopen(r.id)} disabled={busy} className="btn b-grey">↩</button>
      </div>
    )
    if (active === 'cancelled') return (
      <button onClick={() => reopen(r.id)} disabled={busy} className="btn b-grey">↩ Reopen</button>
    )
    // delivered → 只读
    return <span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600 whitespace-nowrap">delivered {r.delivery_date}</span>
  }
}

// ===== 子组件 =====
function RailNode({ meta, count, active, onClick }: { meta: StageMeta; count: number; active: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} className={`mainnode ${active ? 'active' : ''}`}
      style={{ ['--a' as any]: meta.a, ['--bg' as any]: meta.bg, ['--bd' as any]: meta.bd, ['--tx' as any]: meta.tx }}>
      <span className="ni">{meta.icon}</span>
      <span className="nl">{meta.label}</span>
      <span className="nc">{count}</span>
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
// Delivered：按 PO # 归并成主行，小三角展开看该 PO 下每个 SKU 的发货明细（单价/发货日/送达日/备注）。
// 同一 PO 内不同 SKU 可能分批发运，各自的 ship_date / delivery_date 就是那一批的日期。
type PoGroup = {
  key: string; po_number: string | null; country_code: string; country_flag: string; ka_name: string | null
  po_date: string; lines: OpsRow[]; qty: number; turnover: number; currency: string | null
  firstShip: string | null; lastDelivery: string | null; batches: number
}
function DeliveredTable({ rows, meta, expanded, onToggle }: {
  rows: OpsRow[]; meta: StageMeta; expanded: Set<string>; onToggle: (key: string) => void
}) {
  const groups = useMemo<PoGroup[]>(() => {
    const map = new Map<string, PoGroup>()
    rows.forEach(r => {
      // 无 PO # 的行各自成组，避免被合并到一起
      const key = r.po_number ? `po:${r.po_number}` : `id:${r.id}`
      const g = map.get(key)
      if (g) {
        g.lines.push(r); g.qty += r.qty; g.turnover += r.turnover ?? 0
        if (!g.currency) g.currency = r.currency
        if (r.po_date < g.po_date) g.po_date = r.po_date
      } else map.set(key, {
        key, po_number: r.po_number, country_code: r.country_code, country_flag: r.country_flag, ka_name: r.ka_name,
        po_date: r.po_date, lines: [r], qty: r.qty, turnover: r.turnover ?? 0, currency: r.currency,
        firstShip: null, lastDelivery: null, batches: 0,
      })
    })
    const out = Array.from(map.values())
    out.forEach(g => {
      g.lines.sort((a, z) => (a.delivery_date ?? '').localeCompare(z.delivery_date ?? '') || a.sku_code.localeCompare(z.sku_code))
      const ships = g.lines.map(l => l.ship_date).filter(Boolean) as string[]
      const dels = g.lines.map(l => l.delivery_date).filter(Boolean) as string[]
      g.firstShip = ships.length ? ships.reduce((a, b) => a < b ? a : b) : null
      g.lastDelivery = dels.length ? dels.reduce((a, b) => a > b ? a : b) : null
      // 不同送达日的批次数（同一 PO 里分批发运时 > 1）
      g.batches = new Set(dels).size
    })
    return out.sort((a, z) => (z.lastDelivery ?? '').localeCompare(a.lastDelivery ?? '') || (z.po_date).localeCompare(a.po_date))
  }, [rows])

  return (
    <div className="rounded-[10px] overflow-hidden mt-2.5" style={{ borderLeft: `3px solid ${meta.a}` }}>
      <div className="overflow-x-auto max-h-[560px] overflow-y-auto border border-gray-100 border-l-0 rounded-r-[10px]">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 z-10" style={{ background: meta.bg }}>
            <tr className="border-b border-gray-200">
              <Th> </Th><Th>PO #</Th><Th>Country</Th><Th>KA</Th>
              <Th center>SKUs</Th><Th right>Total Qty</Th><Th right>Total Value</Th>
              <Th>PO Date</Th><Th>Shipped</Th><Th>Delivered</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map(g => {
              const open = expanded.has(g.key)
              return (
                <Fragment key={g.key}>
                  <tr className="hover:bg-gray-50/60 cursor-pointer" onClick={() => onToggle(g.key)}>
                    <td className="pl-3 pr-1 py-2 w-6">
                      <span className="inline-block text-gray-400 transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{g.po_number ?? <span className="text-gray-300">（无 PO #）</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">{g.country_flag} {g.country_code}</span></td>
                    <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{g.ka_name ?? '-'}</span></td>
                    <td className="px-3 py-2 text-center text-gray-500 tabular-nums">
                      {g.lines.length}
                      {g.batches > 1 && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700" title={`${g.batches} 个不同送达日 = 分批发运`}>{g.batches} 批</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtNum(g.qty)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">{g.turnover ? fmtMoney(g.turnover, g.currency) : '–'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.po_date}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{g.firstShip ?? '–'}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{g.lastDelivery ?? '–'}</span></td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-50/60">
                      <td></td>
                      <td colSpan={9} className="px-3 py-2.5">
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">发货明细 · {g.lines.length} 个 SKU{g.batches > 1 ? ` · ${g.batches} 批发运` : ''}</div>
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-left text-[10.5px] text-gray-500 border-b border-gray-200">
                              <th className="py-1 pr-3 font-semibold">SKU</th>
                              <th className="py-1 pr-3 font-semibold">Product</th>
                              <th className="py-1 pr-3 font-semibold text-right">Qty</th>
                              <th className="py-1 pr-3 font-semibold text-right">Unit Price</th>
                              <th className="py-1 pr-3 font-semibold text-right">Turnover</th>
                              <th className="py-1 pr-3 font-semibold">🚚 Ship Date</th>
                              <th className="py-1 pr-3 font-semibold">📬 Delivery Date</th>
                              <th className="py-1 font-semibold">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lines.map(l => (
                              <tr key={l.id} className="border-b border-gray-100 last:border-0">
                                <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-700 whitespace-nowrap">{l.sku_code}</td>
                                <td className="py-1.5 pr-3 text-gray-600">{l.sku_name || '-'}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmtNum(l.qty)}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500 whitespace-nowrap">{fmtMoney(l.fd_buying_price, l.currency)}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700 whitespace-nowrap">{fmtMoney(l.turnover, l.currency)}</td>
                                <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">{l.ship_date ?? '–'}</td>
                                <td className="py-1.5 pr-3 font-mono text-[11px] text-emerald-700 whitespace-nowrap">{l.delivery_date ?? '–'}</td>
                                <td className="py-1.5 text-[11px] text-gray-400">{l.notes || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {!groups.length && <tr><td colSpan={10} className="py-12 text-center text-gray-300">没有匹配的 PO</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, right, center, className = '' }: { children: React.ReactNode; right?: boolean; center?: boolean; className?: string }) {
  return <th className={`px-3 py-2.5 text-xs font-semibold text-gray-600 ${right ? 'text-right' : center ? 'text-center' : 'text-left'} ${className}`}>{children}</th>
}

// 手动新建 PO（落 New PO，po_status 由 DB 默认 'new'）
// 一张 PO 抬头（国家/KA/PO#/日期/币种）+ 多条 SKU 明细行 → 每行 insert 一条 channel_po。
type PoLine = { key: number; skuCode: string; qty: string; price: string }
const CCY_FMT = (v: number, ccy: string) => (ccy === 'PLN' ? 'zł ' : '€') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Turnover = Qty × Unit Price（自动计算，不手填）
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
  // 输入的 SKU 文本 → sku.id（大小写不敏感，按 code 精确匹配）
  const skuByCode = useMemo(() => new Map(skus.map(s => [s.code.toLowerCase(), s])), [skus])
  const resolve = (code: string) => skuByCode.get(code.trim().toLowerCase())

  const addLine = () => { setLines(ls => [...ls, { key: nextKey.current++, skuCode: '', qty: '', price: '' }]) }
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

        {/* 全局 SKU 选项：input+datalist = 可打字过滤，同时保留下拉 */}
        <datalist id="sku-options">
          {skus.map(s => <option key={s.id} value={s.code}>{s.name}</option>)}
        </datalist>

        {/* ── PO 抬头 ── */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country *"><select value={countryId} onChange={e => { setCountryId(Number(e.target.value) || ''); setKaId(''); }} className="fld">
            <option value="">—</option>{countries.map(c => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}</select></Field>
          <Field label="KA"><select value={kaId} onChange={e => setKaId(Number(e.target.value) || '')} disabled={!countryId} className="fld">
            <option value="">—</option>{kaOptions.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>
          <Field label="PO #"><input value={poNumber} onChange={e => setPoNumber(e.target.value)} className="fld" placeholder="optional" /></Field>
          <Field label="PO Date *"><input type="date" value={poDate} max={today} onChange={e => setPoDate(e.target.value)} className="fld" /></Field>
          <Field label="Currency"><select value={currency} onChange={e => setCurrency(e.target.value)} className="fld"><option>EUR</option><option>PLN</option></select></Field>
        </div>

        {/* ── SKU 明细行 ── */}
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
                    <div className={`text-[10px] mt-0.5 truncate ${bad ? 'text-rose-500' : 'text-gray-400'}`}>
                      {bad ? '⚠ 无法识别此 SKU' : sku ? sku.name : ' '}
                    </div>
                  </div>
                  <input type="number" value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} placeholder="0" className="fld text-right h-[35px]" />
                  <input type="number" value={l.price} onChange={e => setLine(l.key, { price: e.target.value })} placeholder="optional" className="fld text-right h-[35px]" />
                  <div className="h-[35px] flex items-center justify-end px-2 rounded-lg bg-gray-50 border border-gray-200 text-[13px] tabular-nums text-gray-600">
                    {t == null ? '–' : CCY_FMT(t, currency)}
                  </div>
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
    #posroot{}
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
