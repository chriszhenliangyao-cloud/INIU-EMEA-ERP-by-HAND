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
  carton_dim_cm: string | null
  carton_gross_kg: number | null
  cartons_per_pallet: number | null
  pallet_gross_kg: number | null
  colorbox_dim_cm: string | null
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

// 仓库展示：DB 中文名 → 仓库代码 / 全称。改这里只影响显示，不影响 hq_stock 的数据键。
const WH_CODE: Record<string, string> = {
  '生产部': 'HQ',
  '新欧达德国仓': 'DE2',
  '新欧达法国仓': 'FR1',
  '雨鹤德国仓': 'DE1',
}
const WH_FULL: Record<string, string> = {
  '生产部': 'HQ — Central Warehouse, China (domestic) · 生产部',
  '新欧达德国仓': 'DE2 — 3PL Distribution Centre, Germany · 新欧达德国仓',
  '新欧达法国仓': 'FR1 — 3PL Distribution Centre, France · 新欧达法国仓',
  '雨鹤德国仓': 'DE1 — 3PL Distribution Centre, Germany · 雨鹤德国仓',
}

type Toast = { kind: 'success' | 'error' | 'info'; msg: string; id: number }

type Warehouse = { name: string; location: string }
export function SkuManagementView({ allSkus, viewerName, canEdit, stockBySku, warehouses, stockAsOf }: {
  allSkus: Sku[]; viewerName: string
  canEdit: boolean                       // admin 才为 true；false = 销售只读，隐藏全部写操作
  stockBySku: Record<number, Record<string, number>>
  warehouses: Warehouse[]
  stockAsOf: string
}) {
  const router = useRouter()
  // 库存列：仓库显示码（DB 里的中文名是数据 key，这里只做展示映射）+ 数字格式化；行合计 = 各仓相加
  const shortWh = (name: string) => WH_CODE[name] ?? name.replace('国仓', '').replace('仓', '')
  const fullWh = (name: string) => WH_FULL[name] ?? name
  const fmtQty = (n?: number) => (n && n > 0 ? n.toLocaleString() : null)
  const rowTotal = (id: number) => warehouses.reduce((sum, w) => sum + (stockBySku[id]?.[w.name] ?? 0), 0)
  const CODE_W = 150, NAME_W = 210
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [showCarton, setShowCarton] = useState(false)   // 箱规明细列（EAN/Qty/Carton/尺寸/托盘…）默认收起，聚焦库存
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
  // 行内保存 EAN（可空清除）。返回是否成功，让单元格决定退出编辑态。
  const onSaveEan = async (sku: Sku, ean: string | null): Promise<boolean> => {
    const r = await updateSKU(sku.id, { ean })
    if (!r.ok) { flash('error', r.error); return false }
    flash('success', `${sku.code} EAN ${ean ? 'updated' : 'cleared'}`)
    router.refresh()
    return true
  }
  // 行内保存 Qty/Carton（box_qty，可空清除）。
  const onSaveBoxQty = async (sku: Sku, qty: number | null): Promise<boolean> => {
    const r = await updateSKU(sku.id, { box_qty: qty })
    if (!r.ok) { flash('error', r.error); return false }
    flash('success', `${sku.code} Qty/Carton ${qty != null ? 'updated' : 'cleared'}`)
    router.refresh()
    return true
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
            {canEdit
              ? <span className="text-base text-gray-500 ml-2 font-normal">· Admin only</span>
              : <span className="ml-2 align-middle text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 px-2 py-1 rounded-full">👁 Read-only</span>}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Signed in as <span className="text-purple-600 font-medium">🌍 {viewerName}</span>
            {' · '}<span className="text-green-600 font-medium">{activeCount} active</span>
            {' · '}<span className="text-gray-400">{inactiveCount} inactive</span>
            {canEdit ? ' · All changes auto-logged' : ' · 主数据由 HQ 维护，如需修改请联系 HQ'}
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

        {canEdit && (
          <button
            onClick={() => setAddOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl shadow-sm hover:bg-blue-700 active:scale-[0.98] transition flex items-center gap-1.5"
          >
            <span>+</span> Add SKU
          </button>
        )}
      </div>

      {/* 主表 */}
      <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-gray-500 border-b border-black/[0.06]">
          <span>📦 <b className="text-gray-700 font-semibold">Inventory</b> · HQ = 生产部 (domestic) · DE1 / DE2 / FR1 = overseas 3PL · Total = all warehouses · 只读（随供应链快照更新）</span>
          <button
            onClick={() => setShowCarton(v => !v)}
            className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-50 transition"
            title="展开 / 收起箱规明细列（每箱数量·重量·尺寸·托盘·彩盒）"
          >
            <span className="text-gray-400 transition-transform" style={{ display: 'inline-block', transform: showCarton ? 'rotate(90deg)' : 'none' }}>▸</span>
            {showCarton ? '收起箱规明细' : '展开箱规明细'}
          </button>
          {stockAsOf && <span className="shrink-0 text-[11px] font-semibold bg-[#e3eefc] text-[#1a56b3] px-2.5 py-1 rounded-full">as of {stockAsOf}</span>}
        </div>
        <div className="overflow-auto max-h-[750px]">
          <table className="w-full text-sm border-collapse" style={{ minWidth: CODE_W + NAME_W + 120 + warehouses.length * 84 + 90 + 150 }}>
            <thead>
              <tr className="bg-white">
                <th className="sticky top-0 left-0 z-30 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-black/[0.06]" style={{ minWidth: CODE_W, width: CODE_W }}>Code</th>
                <th className="sticky top-0 z-30 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-r-2 border-black/[0.06]" style={{ left: CODE_W, minWidth: NAME_W, width: NAME_W }}>Name</th>
                <th className="sticky top-0 z-20 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-black/[0.06]">EAN</th>
                {showCarton && <>
                  <th className="sticky top-0 z-20 bg-white px-3 py-2.5 text-right text-[11px] font-medium text-gray-400 border-b border-black/[0.06]">Qty/Carton</th>
                  <th title="每箱重量 (gross kg)" className="sticky top-0 z-20 bg-white px-3 py-2.5 text-right text-[11px] font-medium text-gray-400 border-b border-black/[0.06] whitespace-nowrap">Carton kg</th>
                  <th title="每箱尺寸 L*W*H" className="sticky top-0 z-20 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-black/[0.06] whitespace-nowrap">Carton size</th>
                  <th title="每托箱数" className="sticky top-0 z-20 bg-white px-3 py-2.5 text-right text-[11px] font-medium text-gray-400 border-b border-black/[0.06] whitespace-nowrap">Qty/Pallet</th>
                  <th title="每托重量 (gross kg)" className="sticky top-0 z-20 bg-white px-3 py-2.5 text-right text-[11px] font-medium text-gray-400 border-b border-black/[0.06] whitespace-nowrap">Pallet weight</th>
                  <th title="产品彩盒尺寸 L*W*H" className="sticky top-0 z-20 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-r-2 border-black/[0.06] whitespace-nowrap">Retail package size</th>
                </>}
                {warehouses.map((w, i) => (
                  <th key={w.name} title={fullWh(w.name)} className={`sticky top-0 z-20 px-3 py-2.5 text-right text-[11px] font-semibold text-[#1a56b3] bg-[#e3eefc] border-b border-black/[0.06] ${i === 0 ? 'border-l-2 border-l-[#cfe0f8]' : ''}`}>{shortWh(w.name)}</th>
                ))}
                <th title="Total on hand — all warehouses" className="sticky top-0 z-20 px-3 py-2.5 text-right text-[11px] font-bold text-gray-700 bg-[#eef2f7] border-b border-black/[0.06]">Total</th>
                <th className="sticky top-0 z-20 bg-white px-3 py-2.5 text-right text-[11px] font-medium text-gray-400 border-b border-black/[0.06]">Sort</th>
                {canEdit && <th className="sticky top-0 z-20 bg-white px-3 py-2.5 text-right text-[11px] font-medium text-gray-400 border-b border-black/[0.06]">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {filteredSkus.length === 0 && (
                <tr><td colSpan={(canEdit ? 12 : 11) - (showCarton ? 0 : 6) + warehouses.length} className="py-12 text-center text-gray-400">No SKUs match the filters</td></tr>
              )}
              {filteredSkus.map(s => (
                <tr key={s.id} className={`group hover:bg-[#f5f5f7] transition-colors ${!s.is_active ? 'opacity-55' : ''}`}>
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-[#f5f5f7] px-3 py-2 font-mono text-xs font-bold text-gray-900 border-b border-black/[0.05]" style={{ left: 0, minWidth: CODE_W, width: CODE_W }}>{s.code}</td>
                  <td className="sticky z-10 bg-white group-hover:bg-[#f5f5f7] px-3 py-2 text-xs text-gray-700 border-b border-r-2 border-black/[0.05]" style={{ left: CODE_W, minWidth: NAME_W, width: NAME_W }}>
                    {s.name}
                    {s.name_zh && <span className="text-gray-400 ml-1">· {s.name_zh}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs border-b border-black/[0.05] whitespace-nowrap">
                    <EanCell sku={s} onSave={onSaveEan} canEdit={canEdit} />
                  </td>
                  {showCarton && <>
                    <td className="px-3 py-2 text-xs text-right border-b border-black/[0.05]">
                      <BoxQtyCell sku={s} onSave={onSaveBoxQty} canEdit={canEdit} />
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums border-b border-black/[0.05]">
                      {s.carton_gross_kg != null ? <span className="text-gray-700">{s.carton_gross_kg}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-left border-b border-black/[0.05] whitespace-nowrap">
                      {s.carton_dim_cm ? <span className="text-gray-700">{s.carton_dim_cm}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums border-b border-black/[0.05]">
                      {s.cartons_per_pallet != null ? <span className="text-gray-700">{s.cartons_per_pallet}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums border-b border-black/[0.05]">
                      {s.pallet_gross_kg != null ? <span className="text-gray-700">{s.pallet_gross_kg}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-left border-b border-r-2 border-black/[0.05] whitespace-nowrap">
                      {s.colorbox_dim_cm ? <span className="text-gray-700">{s.colorbox_dim_cm}</span> : <span className="text-gray-300">—</span>}
                    </td>
                  </>}
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
                  {canEdit && (
                    <td className="px-3 py-2 text-right border-b border-black/[0.05] whitespace-nowrap">
                      <button onClick={() => setEditingSku(s)} className="px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-black/[0.04] rounded-md transition">Edit</button>
                    </td>
                  )}
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

// ── 行内可编辑 EAN 单元格 ──
function EanCell({ sku, onSave, canEdit }: { sku: Sku; onSave: (sku: Sku, ean: string | null) => Promise<boolean>; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(sku.ean ?? '')
  const [saving, setSaving] = useState(false)
  // 外部数据刷新后同步显示值（非编辑态时）
  useEffect(() => { if (!editing) setVal(sku.ean ?? '') }, [sku.ean, editing])

  // 只读（销售）：纯展示，不可点
  if (!canEdit) {
    return sku.ean
      ? <span className="font-mono text-[11px] text-gray-700">{sku.ean}</span>
      : <span className="text-gray-300">—</span>
  }

  const commit = async () => {
    const next = val.trim() || null
    if (next === (sku.ean ?? null)) { setEditing(false); return }   // 没变，直接退出
    if (next && !/^\d{8,14}$/.test(next)) { alert('EAN 应为 8–14 位数字'); return }
    setSaving(true)
    const ok = await onSave(sku, next)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        title="点击编辑 EAN"
        className="group inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 -ml-1.5 hover:bg-blue-50 transition-colors"
      >
        {sku.ean
          ? <span className="font-mono text-[11px] text-gray-700">{sku.ean}</span>
          : <span className="text-gray-300">—</span>}
        <span className="text-[10px] text-gray-300 opacity-0 group-hover:opacity-100">✎</span>
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={val}
        disabled={saving}
        onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') { setVal(sku.ean ?? ''); setEditing(false) }
        }}
        onBlur={commit}
        placeholder="13 位条码"
        className="w-36 font-mono text-[11px] rounded border border-blue-300 bg-white px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-blue-200"
      />
      {saving && <span className="text-[10px] text-gray-400">…</span>}
    </span>
  )
}

// ── 行内可编辑 Qty/Carton 单元格 ──
function BoxQtyCell({ sku, onSave, canEdit }: { sku: Sku; onSave: (sku: Sku, qty: number | null) => Promise<boolean>; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(sku.box_qty != null ? String(sku.box_qty) : '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!editing) setVal(sku.box_qty != null ? String(sku.box_qty) : '') }, [sku.box_qty, editing])

  // 只读（销售）：纯展示，不可点
  if (!canEdit) {
    return sku.box_qty != null
      ? <span className="tabular-nums text-gray-700">{sku.box_qty}</span>
      : <span className="text-gray-300">—</span>
  }

  const commit = async () => {
    const next = val.trim() ? parseInt(val.trim(), 10) : null
    if (next === (sku.box_qty ?? null)) { setEditing(false); return }
    if (next != null && (!Number.isFinite(next) || next <= 0)) { alert('每箱数量应为正整数'); return }
    setSaving(true)
    const ok = await onSave(sku, next)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        title="点击编辑每箱数量"
        className="group inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-blue-50 transition-colors"
      >
        {sku.box_qty != null
          ? <span className="tabular-nums text-gray-700">{sku.box_qty}</span>
          : <span className="text-gray-300">—</span>}
        <span className="text-[10px] text-gray-300 opacity-0 group-hover:opacity-100">✎</span>
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <input
        autoFocus
        value={val}
        disabled={saving}
        onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') { setVal(sku.box_qty != null ? String(sku.box_qty) : ''); setEditing(false) }
        }}
        onBlur={commit}
        placeholder="每箱数量"
        className="w-20 text-right tabular-nums text-[11px] rounded border border-blue-300 bg-white px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-blue-200"
      />
      {saving && <span className="text-[10px] text-gray-400">…</span>}
    </span>
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
              <Field label="Box qty（每箱数量）">
                <input type="number" value={form.box_qty ?? ''} onChange={(e) => setNum('box_qty', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Unit weight (g)（单品重量）">
                <input type="number" value={form.unit_weight_g ?? ''} onChange={(e) => setNum('unit_weight_g', e.target.value)} className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* Carton & Pallet（装箱 / 托盘）*/}
          <Section title="Carton & Pallet（装箱 / 托盘）">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Carton size（每箱尺寸）">
                <input value={form.carton_dim_cm ?? ''} onChange={(e) => setField('carton_dim_cm', e.target.value)} className={inputCls} placeholder="47*42*35cm" />
              </Field>
              <Field label="Carton weight kg（每箱重量）">
                <input type="number" step="0.1" value={form.carton_gross_kg ?? ''} onChange={(e) => setNum('carton_gross_kg', e.target.value)} className={inputCls} placeholder="15.2" />
              </Field>
              <Field label="Cartons / pallet（每托箱数）">
                <input type="number" value={form.cartons_per_pallet ?? ''} onChange={(e) => setNum('cartons_per_pallet', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Pallet weight kg（每托重量）">
                <input type="number" step="0.1" value={form.pallet_gross_kg ?? ''} onChange={(e) => setNum('pallet_gross_kg', e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Color box size（产品彩盒尺寸）">
              <input value={form.colorbox_dim_cm ?? ''} onChange={(e) => setField('colorbox_dim_cm', e.target.value)} className={inputCls} placeholder="16*8*3cm" />
            </Field>
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
      carton_dim_cm: null, carton_gross_kg: null, cartons_per_pallet: null, pallet_gross_kg: null, colorbox_dim_cm: null,
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
    carton_dim_cm: s.carton_dim_cm,
    carton_gross_kg: s.carton_gross_kg,
    cartons_per_pallet: s.cartons_per_pallet,
    pallet_gross_kg: s.pallet_gross_kg,
    colorbox_dim_cm: s.colorbox_dim_cm,
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
