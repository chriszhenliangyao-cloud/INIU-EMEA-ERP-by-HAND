'use client'

import { useMemo, useRef, useState } from 'react'
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
  const list = buckets[active]
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
            {active === 'new' && (
              <button onClick={() => setAddOpen(true)} className="btn b-indigo shrink-0" style={{ padding: '7px 14px' }}>＋ Add PO manually</button>
            )}
          </div>

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
                  {!list.length && <tr><td colSpan={12} className="py-12 text-center text-gray-300">此阶段暂无记录 🎉</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
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
function Th({ children, right, center, className = '' }: { children: React.ReactNode; right?: boolean; center?: boolean; className?: string }) {
  return <th className={`px-3 py-2.5 text-xs font-semibold text-gray-600 ${right ? 'text-right' : center ? 'text-center' : 'text-left'} ${className}`}>{children}</th>
}

// 手动新建 PO（落 New PO，po_status 由 DB 默认 'new'）
function AddPoModal({ today, skus, countries, kas, onClose, onDone, supabase }: {
  today: string; skus: SkuOpt[]; countries: CountryOpt[]; kas: KaOpt[]
  onClose: () => void; onDone: () => void; supabase: ReturnType<typeof createClient>
}) {
  const [countryId, setCountryId] = useState<number | ''>('')
  const [kaId, setKaId] = useState<number | ''>('')
  const [skuId, setSkuId] = useState<number | ''>('')
  const [poNumber, setPoNumber] = useState('')
  const [poDate, setPoDate] = useState(today)
  const [qty, setQty] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [price, setPrice] = useState('')
  const [turnover, setTurnover] = useState('')
  const [saving, setSaving] = useState(false)

  const kaOptions = kas.filter(k => k.country_id === countryId)

  const submit = async () => {
    const q = Math.floor(Number(qty))
    if (!countryId || !skuId || !Number.isFinite(q) || q <= 0 || !poDate) { alert('请填写：国家、SKU、数量(>0)、PO 日期。'); return }
    setSaving(true)
    const { error } = await supabase.from('channel_po').insert({
      country_id: countryId, ka_id: kaId || null, sku_id: skuId,
      po_number: poNumber.trim() || null, po_date: poDate, qty_ordered: q,
      currency, fd_buying_price: price ? Number(price) : null, turnover: turnover ? Number(turnover) : null,
      source_file: 'manual',
    })
    setSaving(false)
    if (error) { alert(`新建失败: ${error.message}`); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold text-gray-900">🆕 Add PO manually</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-400 mb-4">新建的 PO 落入 <span className="text-indigo-600 font-medium">New PO</span>，核对后 Confirm 进入待发。</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country *"><select value={countryId} onChange={e => { setCountryId(Number(e.target.value) || ''); setKaId(''); }} className="fld">
            <option value="">—</option>{countries.map(c => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}</select></Field>
          <Field label="KA"><select value={kaId} onChange={e => setKaId(Number(e.target.value) || '')} disabled={!countryId} className="fld">
            <option value="">—</option>{kaOptions.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>
          <Field label="SKU *" full><select value={skuId} onChange={e => setSkuId(Number(e.target.value) || '')} className="fld">
            <option value="">—</option>{skus.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
          <Field label="PO #"><input value={poNumber} onChange={e => setPoNumber(e.target.value)} className="fld" placeholder="optional" /></Field>
          <Field label="PO Date *"><input type="date" value={poDate} max={today} onChange={e => setPoDate(e.target.value)} className="fld" /></Field>
          <Field label="Qty *"><input type="number" value={qty} onChange={e => setQty(e.target.value)} className="fld" placeholder="0" /></Field>
          <Field label="Currency"><select value={currency} onChange={e => setCurrency(e.target.value)} className="fld"><option>EUR</option><option>PLN</option></select></Field>
          <Field label="Unit Price"><input type="number" value={price} onChange={e => setPrice(e.target.value)} className="fld" placeholder="optional" /></Field>
          <Field label="Turnover"><input type="number" value={turnover} onChange={e => setTurnover(e.target.value)} className="fld" placeholder="optional" /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? 'Saving…' : 'Create PO'}</button>
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
