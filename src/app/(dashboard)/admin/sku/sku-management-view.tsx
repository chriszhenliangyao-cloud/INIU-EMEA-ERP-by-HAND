'use client'

/**
 * SKU Master Data 管理 — admin 自助 UI
 *
 * - 顶部：搜索 + 状态 filter + Add SKU 按钮
 * - 主表：8 列核心信息 + 状态徽章 + Edit / Deactivate / Reactivate / Delete
 * - Edit Drawer：右侧划入，所有字段编辑 + 保存
 * - 删除时检查 reference count，有引用就提示用 deactivate
 */

import { useState, useMemo, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  createSKU, updateSKU, deactivateSKU, reactivateSKU,
  deleteSKUPermanently, getSKUReferenceCount,
} from './_actions/manage-sku'
import type { SkuInput } from './_actions/manage-sku'

type Sku = {
  id: number
  code: string
  name: string
  name_zh: string | null
  category: string | null
  color: string | null
  ean: string | null
  box_qty: number | null
  unit_weight_g: number | null
  rrp_eur: number | null
  rrp_usd: number | null
  cost_usd: number | null
  lifecycle: string | null
  launch_date: string | null
  region_scope: string[] | null
  sort_order: number
  is_active: boolean
  notes: string | null
  series: string | null
  family: string | null
  created_at: string
  updated_at: string
}

type Toast = { kind: 'success' | 'error' | 'info'; msg: string; id: number }

type Warehouse = { name: string; location: string }
export function SkuManagementView({ allSkus, viewerName, stockBySku, warehouses, stockAsOf }: {
  allSkus: Sku[]; viewerName: string
  stockBySku: Record<number, Record<string, number>>
  warehouses: Warehouse[]
  stockAsOf: string
}) {
  const router = useRouter()
  // 库存列：HQ 短名 + 数字格式化；行合计 = 各仓相加
  const shortWh = (name: string) => name === '生产部' ? 'HQ' : name.replace('国仓', '').replace('仓', '')
  const fmtQty = (n?: number) => (n && n > 0 ? n.toLocaleString() : null)
  const rowTotal = (id: number) => warehouses.reduce((sum, w) => sum + (stockBySku[id]?.[w.name] ?? 0), 0)
  const CODE_W = 150, NAME_W = 210
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editingSku, setEditingSku] = useState<Sku | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [isPending, startTransition] = useTransition()

  const flash = (kind: Toast['kind'], msg: string) => {
    const id = Date.now()
    setToast({ kind, msg, id })
    setTimeout(() => setToast(prev => prev?.id === id ? null : prev), kind === 'error' ? 5000 : 2500)
  }

  // 派生：所有 categories
  const categories = useMemo(() => {
    const set = new Set<string>()
    allSkus.forEach(s => { if (s.category) set.add(s.category) })
    return Array.from(set).sort()
  }, [allSkus])

  // 派生：过滤后的列表
  const filteredSkus = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allSkus.filter(s => {
      if (statusFilter === 'active' && !s.is_active) return false
      if (statusFilter === 'inactive' && s.is_active) return false
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
      if (q && !`${s.code} ${s.name} ${s.name_zh ?? ''} ${s.series ?? ''} ${s.family ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [allSkus, search, statusFilter, categoryFilter])

  const activeCount = useMemo(() => allSkus.filter(s => s.is_active).length, [allSkus])
  const inactiveCount = allSkus.length - activeCount

  // ── Actions ──
  const onDeactivate = (sku: Sku) => {
    if (!confirm(`Deactivate "${sku.code} · ${sku.name}"? Historical data is preserved, but the SKU will be hidden from forecast/PSI/shipment lists.`)) return
    startTransition(async () => {
      const r = await deactivateSKU(sku.id)
      if (!r.ok) flash('error', r.error)
      else { flash('success', `${sku.code} deactivated`); router.refresh() }
    })
  }
  const onReactivate = (sku: Sku) => {
    startTransition(async () => {
      const r = await reactivateSKU(sku.id)
      if (!r.ok) flash('error', r.error)
      else { flash('success', `${sku.code} reactivated`); router.refresh() }
    })
  }
  const onDelete = (sku: Sku) => {
    if (!confirm(`Permanently delete "${sku.code} · ${sku.name}"? This cannot be undone. If the SKU has any history, the operation will be blocked.`)) return
    startTransition(async () => {
      const r = await deleteSKUPermanently(sku.id)
      if (!r.ok) flash('error', r.error)
      else { flash('success', `${sku.code} deleted`); router.refresh() }
    })
  }

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-none">
          <div className={`pointer-events-auto px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium border flex items-center gap-2 ${
            toast.kind === 'success' ? 'bg-green-50 text-green-700 border-green-300' :
            toast.kind === 'error'   ? 'bg-red-50 text-red-700 border-red-300' :
                                       'bg-blue-50 text-blue-700 border-blue-300'
          }`}>
            <span>{toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span>{toast.msg}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      )}

      {/* 页头 */}
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            ⚙️ SKU Master Data
            <span className="text-base text-gray-500 ml-2 font-normal">· Admin only</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Signed in as <span className="text-purple-600 font-medium">🌍 {viewerName}</span>
            {' · '}<span className="text-green-600 font-medium">{activeCount} active</span>
            {' · '}<span className="text-gray-400">{inactiveCount} inactive</span>
            {' · '}All changes auto-logged
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/forecast" className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md">← Back to dashboard</Link>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl p-4 mb-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code / name / series / family…"
            className="w-full pl-9 pr-3 py-2 bg-gray-500/[0.08] rounded-xl text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 bg-gray-500/[0.08] rounded-xl text-sm outline-none cursor-pointer hover:bg-gray-500/[0.12] transition"
        >
          <option value="all">All status ({allSkus.length})</option>
          <option value="active">✓ Active ({activeCount})</option>
          <option value="inactive">⊘ Inactive ({inactiveCount})</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 bg-gray-500/[0.08] rounded-xl text-sm outline-none cursor-pointer hover:bg-gray-500/[0.12] transition"
        >
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="text-xs text-gray-500 ml-auto">
          Showing <strong>{filteredSkus.length}</strong> of {allSkus.length}
        </div>

        <button
          onClick={() => setAddOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl shadow-sm hover:bg-blue-700 active:scale-[0.98] transition flex items-center gap-1.5"
        >
          <span>+</span> Add SKU
        </button>
      </div>

      {/* 主表 */}
      <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-gray-500 border-b border-black/[0.06]">
          <span>📦 <b className="text-gray-700 font-semibold">Inventory</b> · HQ = 生产部 · 海外仓相加 · 只读（随供应链快照更新）</span>
          {stockAsOf && <span className="ml-auto text-[11px] font-semibold bg-[#e3eefc] text-[#1a56b3] px-2.5 py-1 rounded-full">as of {stockAsOf}</span>}
        </div>
        <div className="overflow-auto max-h-[750px]">
          <table className="w-full text-sm border-collapse" style={{ minWidth: CODE_W + NAME_W + 440 + warehouses.length * 84 + 90 + 260 }}>
            <thead>
              <tr className="bg-white">
                <th className="sticky top-0 left-0 z-30 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-black/[0.06]" style={{ minWidth: CODE_W, width: CODE_W }}>Code</th>
                <th className="sticky top-0 z-30 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-r-2 border-black/[0.06]" style={{ left: CODE_W, minWidth: NAME_W, width: NAME_W }}>Name</th>
                {[['Category', 'left'], ['Series', 'left'], ['Family', 'left'], ['Lifecycle', 'left']].map(([h, align]) => (
                  <th key={h} className={`sticky top-0 z-20 bg-white px-3 py-2.5 text-${align} text-[11px] font-medium text-gray-400 border-b border-black/[0.06]`}>{h}</th>
                ))}
                {warehouses.map((w, i) => (
                  <th key={w.name} title={w.name} className={`sticky top-0 z-20 px-3 py-2.5 text-right text-[11px] font-semibold text-[#1a56b3] bg-[#e3eefc] border-b border-black/[0.06] ${i === 0 ? 'border-l-2 border-l-[#cfe0f8]' : ''}`}>{shortWh(w.name)}</th>
                ))}
                <th className="sticky top-0 z-20 px-3 py-2.5 text-right text-[11px] font-bold text-gray-700 bg-[#eef2f7] border-b border-black/[0.06]">汇总</th>
                {[['Sort', 'right'], ['Status', 'center'], ['Actions', 'right']].map(([h, align]) => (
                  <th key={h} className={`sticky top-0 z-20 bg-white px-3 py-2.5 text-${align} text-[11px] font-medium text-gray-400 border-b border-black/[0.06]`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSkus.length === 0 && (
                <tr><td colSpan={10 + warehouses.length} className="py-12 text-center text-gray-400">No SKUs match the filters</td></tr>
              )}
              {filteredSkus.map(s => (
                <tr key={s.id} className={`group hover:bg-[#f5f5f7] transition-colors ${!s.is_active ? 'opacity-55' : ''}`}>
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-[#f5f5f7] px-3 py-2 font-mono text-xs font-bold text-gray-900 border-b border-black/[0.05]" style={{ left: 0, minWidth: CODE_W, width: CODE_W }}>{s.code}</td>
                  <td className="sticky z-10 bg-white group-hover:bg-[#f5f5f7] px-3 py-2 text-xs text-gray-700 border-b border-r-2 border-black/[0.05]" style={{ left: CODE_W, minWidth: NAME_W, width: NAME_W }}>
                    {s.name}
                    {s.name_zh && <span className="text-gray-400 ml-1">· {s.name_zh}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 border-b border-black/[0.05]">{s.category || '-'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 border-b border-black/[0.05]">{s.series || '-'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 border-b border-black/[0.05]">{s.family || '-'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 border-b border-black/[0.05]">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${lifecycleBadge(s.lifecycle)}`}>
                      {s.lifecycle || '-'}
                    </span>
                  </td>
                  {warehouses.map((w, i) => {
                    const q = fmtQty(stockBySku[s.id]?.[w.name])
                    return (
                      <td key={w.name} className={`px-3 py-2 text-xs text-right tabular-nums border-b border-black/[0.05] bg-[#f0f6ff] group-hover:bg-[#e9f2ff] ${i === 0 ? 'border-l-2 border-l-[#eaf1fb]' : ''}`}>
                        {q ? <span className="text-gray-800">{q}</span> : <span className="text-gray-300">–</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-xs text-right tabular-nums font-bold border-b border-black/[0.05] bg-[#eef2f7] group-hover:bg-[#e6ebf1]">
                    {(() => { const t = rowTotal(s.id); return t > 0 ? <span className="text-gray-900">{t.toLocaleString()}</span> : <span className="text-gray-300">–</span> })()}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 text-right border-b border-black/[0.05] tabular-nums">{s.sort_order}</td>
                  <td className="px-3 py-2 text-center border-b border-black/[0.05]">
                    {s.is_active ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Active</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 text-gray-400">Inactive</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right border-b border-black/[0.05] whitespace-nowrap">
                    <button onClick={() => setEditingSku(s)} className="px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-black/[0.04] rounded-md transition">Edit</button>
                    {s.is_active ? (
                      <button onClick={() => onDeactivate(s)} disabled={isPending} className="px-2.5 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 rounded-md transition disabled:opacity-50 ml-1">Deactivate</button>
                    ) : (
                      <>
                        <button onClick={() => onReactivate(s)} disabled={isPending} className="px-2.5 py-1 text-xs font-medium text-green-600 hover:bg-green-50 rounded-md transition disabled:opacity-50 ml-1">Reactivate</button>
                        <DeleteButton sku={s} disabled={isPending} onDelete={() => onDelete(s)} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add SKU drawer */}
      <SkuFormDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="create"
        onSubmit={async (input) => {
          const r = await createSKU(input as SkuInput)
          if (!r.ok) { flash('error', r.error); return false }
          flash('success', `SKU ${input.code} created`)
          router.refresh()
          return true
        }}
      />

      {/* Edit SKU drawer */}
      {editingSku && (
        <SkuFormDrawer
          open
          onClose={() => setEditingSku(null)}
          mode="edit"
          initial={editingSku}
          onSubmit={async (input) => {
            const r = await updateSKU(editingSku.id, input)
            if (!r.ok) { flash('error', r.error); return false }
            flash('success', `${input.code ?? editingSku.code} updated`)
            router.refresh()
            return true
          }}
        />
      )}
    </div>
  )
}

// ── Lifecycle badge color ──
function lifecycleBadge(lifecycle: string | null): string {
  switch ((lifecycle || '').toLowerCase()) {
    case 'active':       return 'bg-blue-50 text-blue-700 border border-blue-200'
    case 'eol':          return 'bg-orange-50 text-orange-700 border border-orange-200'
    case 'discontinued': return 'bg-red-50 text-red-700 border border-red-200'
    case 'preview':
    case 'preorder':     return 'bg-purple-50 text-purple-700 border border-purple-200'
    default:             return 'bg-gray-100 text-gray-600 border border-gray-200'
  }
}

// ── Delete 按钮：异步检查 reference count，无引用才能点 ──
function DeleteButton({ sku, disabled, onDelete }: {
  sku: Sku
  disabled: boolean
  onDelete: () => void
}) {
  const [refs, setRefs] = useState<{ shipments: number; forecast_cells: number; psi_rows: number } | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!checked) {
      getSKUReferenceCount(sku.id).then(r => { setRefs(r); setChecked(true) })
    }
  }, [sku.id, checked])

  const hasHistory = refs ? (refs.shipments + refs.forecast_cells + refs.psi_rows) > 0 : true
  const title = checked
    ? (hasHistory
        ? `Has history: ${refs!.shipments} ship · ${refs!.forecast_cells} fcst · ${refs!.psi_rows} PSI — cannot delete`
        : 'No references — safe to permanently delete')
    : 'checking refs…'

  return (
    <button
      onClick={onDelete}
      disabled={disabled || hasHistory}
      title={title}
      className="px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition disabled:opacity-30 disabled:cursor-not-allowed ml-1"
    >
      Delete
    </button>
  )
}

// ────────────────────────────────────────────
// Drawer form — 共用 create/edit
// ────────────────────────────────────────────
function SkuFormDrawer({ open, onClose, mode, initial, onSubmit }: {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  initial?: Sku
  onSubmit: (input: SkuInput) => Promise<boolean>
}) {
  const [form, setForm] = useState<SkuInput>(() => normalize(initial))
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open) setForm(normalize(initial))
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const setField = <K extends keyof SkuInput>(k: K, v: SkuInput[K]) => setForm(prev => ({ ...prev, [k]: v }))
  const setNum = (k: keyof SkuInput, v: string) => {
    if (v === '') return setField(k, null as any)
    const n = Number(v)
    if (!isNaN(n)) setField(k, n as any)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const ok = await onSubmit(form)
      if (ok) onClose()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white w-full max-w-xl h-full flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            {mode === 'create' ? '+ Add new SKU' : `Edit · ${initial?.code}`}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 基础信息 */}
          <Section title="Basic">
            <Field label="SKU code" required>
              <input value={form.code} onChange={(e) => setField('code', e.target.value)} required maxLength={50} className={inputCls} placeholder="e.g. P75-P1-B" />
            </Field>
            <Field label="Name (EN)" required>
              <input value={form.name} onChange={(e) => setField('name', e.target.value)} required maxLength={200} className={inputCls} placeholder="e.g. Stellar 20k 45W" />
            </Field>
            <Field label="Name (中文)">
              <input value={form.name_zh ?? ''} onChange={(e) => setField('name_zh', e.target.value)} maxLength={200} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <input value={form.category ?? ''} onChange={(e) => setField('category', e.target.value)} className={inputCls} placeholder="Power Bank / Charger / …" />
              </Field>
              <Field label="Color">
                <input value={form.color ?? ''} onChange={(e) => setField('color', e.target.value)} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Series">
                <input value={form.series ?? ''} onChange={(e) => setField('series', e.target.value)} className={inputCls} placeholder="MagPro / Charger / …" />
              </Field>
              <Field label="Family">
                <input value={form.family ?? ''} onChange={(e) => setField('family', e.target.value)} className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* Physical */}
          <Section title="Physical">
            <Field label="EAN">
              <input value={form.ean ?? ''} onChange={(e) => setField('ean', e.target.value)} className={inputCls} placeholder="13-digit barcode" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Box qty">
                <input type="number" value={form.box_qty ?? ''} onChange={(e) => setNum('box_qty', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Unit weight (g)">
                <input type="number" value={form.unit_weight_g ?? ''} onChange={(e) => setNum('unit_weight_g', e.target.value)} className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* Pricing */}
          <Section title="Pricing (admin internal)">
            <div className="grid grid-cols-3 gap-3">
              <Field label="RRP €">
                <input type="number" step="0.01" value={form.rrp_eur ?? ''} onChange={(e) => setNum('rrp_eur', e.target.value)} className={inputCls} />
              </Field>
              <Field label="RRP $">
                <input type="number" step="0.01" value={form.rrp_usd ?? ''} onChange={(e) => setNum('rrp_usd', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Cost $">
                <input type="number" step="0.01" value={form.cost_usd ?? ''} onChange={(e) => setNum('cost_usd', e.target.value)} className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* Lifecycle */}
          <Section title="Lifecycle">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lifecycle">
                <select value={form.lifecycle ?? 'active'} onChange={(e) => setField('lifecycle', e.target.value)} className={inputCls}>
                  <option value="active">Active</option>
                  <option value="preview">Preview</option>
                  <option value="preorder">Pre-order</option>
                  <option value="eol">EOL (End-of-Life)</option>
                  <option value="discontinued">Discontinued</option>
                </select>
              </Field>
              <Field label="Launch date">
                <input type="date" value={form.launch_date ?? ''} onChange={(e) => setField('launch_date', e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Sort order">
              <input type="number" value={form.sort_order ?? 999} onChange={(e) => setNum('sort_order', e.target.value)} className={inputCls} />
              <div className="text-[11px] text-gray-500 mt-1">Lower = shown first. Default 999.</div>
            </Field>
          </Section>

          {/* Notes */}
          <Section title="Notes">
            <textarea value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} rows={3} className={`${inputCls} resize-y`} placeholder="Internal notes…" />
          </Section>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 bg-gray-50 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-md">Cancel</button>
          <button type="submit" disabled={isPending || !form.code?.trim() || !form.name?.trim()} className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50">
            {isPending ? 'Saving…' : (mode === 'create' ? 'Create SKU' : 'Save changes')}
          </button>
        </div>
      </form>
    </div>
  )
}

const inputCls = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <label className="text-xs font-medium text-gray-700 block mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-gray-500 tracking-wider mb-2 pb-1 border-b border-gray-200">{title}</div>
      {children}
    </div>
  )
}

function normalize(s: Sku | undefined): SkuInput {
  if (!s) {
    return {
      code: '', name: '', name_zh: null, category: null, color: null, ean: null,
      box_qty: null, unit_weight_g: null,
      rrp_eur: null, rrp_usd: null, cost_usd: null,
      lifecycle: 'active', launch_date: null, region_scope: null,
      sort_order: 999, notes: null, series: null, family: null,
    }
  }
  return {
    code: s.code,
    name: s.name,
    name_zh: s.name_zh,
    category: s.category,
    color: s.color,
    ean: s.ean,
    box_qty: s.box_qty,
    unit_weight_g: s.unit_weight_g,
    rrp_eur: s.rrp_eur,
    rrp_usd: s.rrp_usd,
    cost_usd: s.cost_usd,
    lifecycle: s.lifecycle,
    launch_date: s.launch_date,
    region_scope: s.region_scope,
    sort_order: s.sort_order,
    notes: s.notes,
    series: s.series,
    family: s.family,
  }
}
