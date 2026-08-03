'use client'

/**
 * SKU Master Data 管理 — admin 自助 UI
 *
 * - 顶部：搜索 + 状态 filter + Add SKU 按钮
 * - 主表：8 列核心信息 + 状态徽章 + Edit / Deactivate / Reactivate / Delete
 * - Edit Drawer：右侧划入，所有字段编辑 + 保存
 * - 删除时检查 reference count，有引用就提示用 deactivate
 */

import { useState, useMemo, useTransition, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  createSKU, updateSKU, deactivateSKU, reactivateSKU,
  deleteSKUPermanently, getSKUReferenceCount, saveSkuCountryPricing,
} from './_actions/manage-sku'
import type { SkuInput } from './_actions/manage-sku'
import { buildWorkbook, downloadWorkbook, type XRow } from '@/lib/spreadsheet'

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
  bom_cost_rmb: number | null
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
type CountryOpt = { id: number; code: string; name_en: string; flag_emoji: string | null; currency: string | null }
export function SkuManagementView({ allSkus, viewerName, canEdit, stockBySku, warehouses, stockAsOf, cnyToEur = 0.13, countries = [], rrpBySku = {}, fdBySku = {} }: {
  allSkus: Sku[]; viewerName: string
  canEdit: boolean                       // admin 才为 true；false = 销售只读，隐藏全部写操作
  stockBySku: Record<number, Record<string, number>>
  warehouses: Warehouse[]
  stockAsOf: string
  cnyToEur?: number                      // 实时 CNY→EUR，用于 BOM(RMB) 旁的 €≈ 提示
  countries?: CountryOpt[]               // 活跃国家（每国定价用）
  rrpBySku?: Record<number, Record<number, number>>  // sku_id → country_id → RRP（RLS 已过滤）
  fdBySku?: Record<number, Record<number, number>>   // sku_id → country_id → FD buying price
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
  const [exportOpen, setExportOpen] = useState(false)   // 箱规导出选择器
  const [editingSku, setEditingSku] = useState<Sku | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [viewMode, setViewMode] = useState<'stock' | 'pricing'>('stock')   // 主表切换：库存 / 各国定价
  const [priceMetric, setPriceMetric] = useState<'rrp' | 'fd'>('rrp')       // 定价视图内切换：RRP / FD buying price
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

  // 按系列(series)分组显示：同系列聚在一起，组内保持原有 sort_order/code 顺序（纯展示，不改数据）
  const groupedSkus = useMemo(() => {
    const map = new Map<string, Sku[]>()
    filteredSkus.forEach(s => {
      const key = s.series?.trim() || 'Other'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    })
    // 组排序：SKU 数量多的系列在前；'Other' 永远垫底
    return Array.from(map.entries())
      .sort((a, b) => (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : 0) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([series, skus]) => ({ series, skus }))
  }, [filteredSkus])

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

      {/* 视图切换：库存 / 各国定价 */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl bg-gray-100 border border-gray-200 w-fit">
        {([['stock', '📦 Inventory / Specs'], ['pricing', '💶 Pricing (RRP / FD)']] as ['stock' | 'pricing', string][]).map(([v, label]) => (
          <button key={v} onClick={() => setViewMode(v)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition ${viewMode === v ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 定价表：SKU × 各国 RRP / FD buying price（本币，只读；编辑仍在 SKU 抽屉里） */}
      {viewMode === 'pricing' && (
        <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-gray-500 border-b border-black/[0.06] flex-wrap">
            <span>💶 <b className="text-gray-700 font-semibold">Per-country pricing</b> · 各国本币 · 销售只看得到自己国家（RLS）· 编辑请在 SKU 抽屉里</span>
            <div className="ml-auto inline-flex bg-slate-100 border border-slate-200 rounded-lg p-0.5">
              {([['rrp', 'RRP'], ['fd', 'FD buying price']] as ['rrp' | 'fd', string][]).map(([m, label]) => (
                <button key={m} onClick={() => setPriceMetric(m)}
                  className={`text-xs font-semibold px-3 py-1 rounded-md transition ${priceMetric === m ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
              ))}
            </div>
          </div>
          {countries.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">无可显示的国家。</div>
          ) : (
            <div className="overflow-auto max-h-[750px]">
              <table className="w-full text-sm border-collapse tabular-nums" style={{ minWidth: CODE_W + NAME_W + countries.length * 110 }}>
                <thead>
                  <tr className="bg-white">
                    <th className="sticky top-0 left-0 z-30 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-black/[0.06]" style={{ minWidth: CODE_W, width: CODE_W }}>Code</th>
                    <th className="sticky top-0 z-30 bg-white px-3 py-2.5 text-left text-[11px] font-medium text-gray-400 border-b border-r-2 border-black/[0.06]" style={{ left: CODE_W, minWidth: NAME_W, width: NAME_W }}>Name</th>
                    {countries.map(c => (
                      <th key={c.id} className="sticky top-0 z-20 bg-white px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 border-b border-black/[0.06] whitespace-nowrap">
                        {c.flag_emoji} {c.code} <span className="text-gray-400 font-normal">{c.currency}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSkus.length === 0 && (
                    <tr><td colSpan={2 + countries.length} className="py-12 text-center text-gray-400">No SKUs match the filters</td></tr>
                  )}
                  {filteredSkus.map(s => {
                    const src = priceMetric === 'rrp' ? rrpBySku : fdBySku
                    return (
                      <tr key={s.id} className="hover:bg-gray-50/60 group">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-3 py-1.5 font-mono text-xs font-semibold text-gray-900 border-b border-black/[0.04]" style={{ minWidth: CODE_W, width: CODE_W }}>{s.code}</td>
                        <td className="sticky z-10 bg-white group-hover:bg-gray-50 px-3 py-1.5 text-xs text-gray-600 border-b border-r-2 border-black/[0.06]" style={{ left: CODE_W, minWidth: NAME_W, width: NAME_W }}>{s.name}</td>
                        {countries.map(c => {
                          const v = src[s.id]?.[c.id]
                          return <td key={c.id} className={`px-3 py-1.5 text-right border-b border-black/[0.04] ${v != null ? 'text-gray-900 font-medium' : 'text-gray-300'}`}>{v != null ? v.toFixed(2) : '—'}</td>
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 主表：库存 / 箱规 */}
      {viewMode === 'stock' && (
      <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-gray-500 border-b border-black/[0.06]">
          <span>📦 <b className="text-gray-700 font-semibold">Inventory</b> · HQ = 生产部 (domestic) · DE1 / DE2 / FR1 = overseas 3PL · Total = all warehouses · 只读（随供应链快照更新）</span>
          <button
            onClick={() => setShowCarton(v => !v)}
            className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-50 transition"
            title="展开 / 收起箱规明细列（每箱数量·重量·尺寸·托盘·彩盒）"
          >
            <span className="text-gray-400 transition-transform" style={{ display: 'inline-block', transform: showCarton ? 'rotate(90deg)' : 'none' }}>▸</span>
            {showCarton ? 'Hide carton specs' : 'Show carton specs'}
          </button>
          <button
            onClick={() => setExportOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition"
            title="导出箱规（可勾选要导出的 SKU）"
          >⬇️ Export carton specs</button>
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
                  <th title="每托箱数" className="sticky top-0 z-20 bg-white px-3 py-2.5 text-right text-[11px] font-medium text-gray-400 border-b border-black/[0.06] whitespace-nowrap">Carton qty/Pallet</th>
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
              {groupedSkus.map(g => (
                <Fragment key={g.series}>
                  <tr>
                    <td colSpan={(canEdit ? 12 : 11) - (showCarton ? 0 : 6) + warehouses.length}
                        className="sticky left-0 bg-[#f3f4f6] border-y border-black/[0.06] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                      {g.series} <span className="ml-1.5 font-normal text-gray-400 normal-case tracking-normal">· {g.skus.length}</span>
                    </td>
                  </tr>
                  {g.skus.map(s => (
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
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Add SKU drawer */}
      <SkuFormDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="create"
        cnyToEur={cnyToEur}
        countries={countries}
        onSubmit={async (input, priceRows) => {
          const r = await createSKU(input as SkuInput)
          if (!r.ok) { flash('error', r.error); return false }
          const newId = (r.data as any)?.id
          if (newId && priceRows.some(x => x.rrp != null || x.fd_buying_price != null)) await saveSkuCountryPricing(newId, priceRows)
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
          cnyToEur={cnyToEur}
          countries={countries}
          initialRrp={rrpBySku[editingSku.id]}
          initialFd={fdBySku[editingSku.id]}
          onSubmit={async (input, priceRows) => {
            const r = await updateSKU(editingSku.id, input)
            if (!r.ok) { flash('error', r.error); return false }
            const rr = await saveSkuCountryPricing(editingSku.id, priceRows)
            if (!rr.ok) { flash('error', `Pricing: ${rr.error}`); return false }
            flash('success', `${input.code ?? editingSku.code} updated`)
            router.refresh()
            return true
          }}
        />
      )}

      {exportOpen && <CartonExportModal skus={allSkus} onClose={() => setExportOpen(false)} />}
    </div>
  )
}

// ── 箱规导出选择器（勾选 SKU → 导出 .xls，交互仿 Shipment Workflow）──
function CartonExportModal({ skus, onClose }: { skus: Sku[]; onClose: () => void }) {
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [onlyFilled, setOnlyFilled] = useState(false)
  const hasSpec = (s: Sku) => s.box_qty != null || s.carton_gross_kg != null || s.carton_dim_cm != null ||
    s.cartons_per_pallet != null || s.pallet_gross_kg != null || s.colorbox_dim_cm != null
  const cats = useMemo(() => Array.from(new Set(skus.map(s => s.category).filter(Boolean) as string[])).sort(), [skus])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return skus.filter(s =>
      (!t || `${s.code} ${s.name} ${s.name_zh ?? ''}`.toLowerCase().includes(t)) &&
      (!cat || s.category === cat) &&
      (!onlyFilled || hasSpec(s)))
  }, [skus, q, cat, onlyFilled])
  const allShownSelected = shown.length > 0 && shown.every(s => sel.has(s.id))
  const toggle = (id: number) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel(s => { const n = new Set(s); if (allShownSelected) shown.forEach(x => n.delete(x.id)); else shown.forEach(x => n.add(x.id)); return n })

  const doExport = () => {
    const picked = skus.filter(s => sel.has(s.id))
    if (!picked.length) { alert('Please select at least one SKU to export.'); return }
    const dash = (v: any): any => v == null || v === '' ? '' : v
    const head: XRow = ['SKU', 'Product', 'EAN', 'Qty/Carton', 'Carton weight (kg)', 'Carton size', 'Carton qty/Pallet', 'Pallet weight (kg)', 'Retail package size', 'Unit weight (g)']
      .map(h => ({ v: h, s: 'hdrL' }))
    const rows: XRow[] = [head]
    picked.forEach(s => rows.push([
      { v: s.code, s: 'code' }, { v: s.name }, { v: dash(s.ean) },
      s.box_qty != null ? { v: s.box_qty, num: true, s: 'n0' } : { v: '' },
      s.carton_gross_kg != null ? { v: Number(s.carton_gross_kg), num: true, s: 'n2' } : { v: '' },
      { v: dash(s.carton_dim_cm) },
      s.cartons_per_pallet != null ? { v: s.cartons_per_pallet, num: true, s: 'n0' } : { v: '' },
      s.pallet_gross_kg != null ? { v: Number(s.pallet_gross_kg), num: true, s: 'n2' } : { v: '' },
      { v: dash(s.colorbox_dim_cm) },
      s.unit_weight_g != null ? { v: s.unit_weight_g, num: true, s: 'n0' } : { v: '' },
    ]))
    const today = new Date().toISOString().slice(0, 10)
    downloadWorkbook(buildWorkbook([{ name: 'Carton specs', rows, freezeRows: 1, widths: [90, 175, 105, 60, 90, 130, 60, 95, 130, 75] }]), `INIU Carton Specs-${today.replace(/-/g, '')}`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[720px] p-5 max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-lg font-semibold text-gray-900">⬇️ Export carton specs</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-400 mb-3">Select the SKUs to export. Carton specs only: Qty/Carton · carton weight &amp; size · Qty/Pallet &amp; weight · retail package size · unit weight (EAN included for reference). Inventory not included.</div>

        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-[240px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code / name…" className="w-full pl-7 pr-3 h-[32px] text-[13px] border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-300" />
          </div>
          <select value={cat} onChange={e => setCat(e.target.value)} className="h-[32px] text-[13px] border border-gray-300 rounded-md px-2 outline-none">
            <option value="">All categories</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={onlyFilled} onChange={e => setOnlyFilled(e.target.checked)} />Only with specs</label>
          <button onClick={toggleAll} className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">{allShownSelected ? 'Clear' : 'Select all'} ({shown.length})</button>
          <span className="ml-auto text-xs text-gray-500">Selected <strong className="text-gray-800">{sel.size}</strong></span>
        </div>

        <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 w-8 text-left"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /></th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400">Code</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400">Name</th>
                <th className="px-3 py-2 text-center text-[11px] font-medium text-gray-400">Specs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map(s => {
                const on = sel.has(s.id)
                return (
                  <tr key={s.id} className={`cursor-pointer ${on ? 'bg-emerald-50/60' : 'hover:bg-gray-50/60'} ${!s.is_active ? 'opacity-55' : ''}`} onClick={() => toggle(s.id)}>
                    <td className="px-3 py-2 text-center"><input type="checkbox" checked={on} onChange={() => toggle(s.id)} onClick={e => e.stopPropagation()} /></td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{s.code}</td>
                    <td className="px-3 py-2 text-gray-600">{s.name}</td>
                    <td className="px-3 py-2 text-center">{hasSpec(s) ? <span className="text-emerald-600 text-xs">✓</span> : <span className="text-gray-300 text-xs">—</span>}</td>
                  </tr>
                )
              })}
              {!shown.length && <tr><td colSpan={4} className="py-10 text-center text-gray-300">No matching SKU</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={doExport} disabled={!sel.size} className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">⬇️ Export ({sel.size})</button>
        </div>
      </div>
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
function SkuFormDrawer({ open, onClose, mode, initial, onSubmit, cnyToEur = 0.13, countries = [], initialRrp, initialFd }: {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  initial?: Sku
  onSubmit: (input: SkuInput, priceRows: { country_id: number; rrp: number | null; fd_buying_price: number | null; currency: string | null }[]) => Promise<boolean>
  cnyToEur?: number
  countries?: CountryOpt[]
  initialRrp?: Record<number, number>   // country_id → RRP（编辑时已存的每国定价）
  initialFd?: Record<number, number>    // country_id → FD buying price
}) {
  const [form, setForm] = useState<SkuInput>(() => normalize(initial))
  const [rrpByCountry, setRrpByCountry] = useState<Record<number, string>>({})   // country_id → RRP 输入值
  const [fdByCountry, setFdByCountry] = useState<Record<number, string>>({})     // country_id → FD buying price 输入值
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open) {
      setForm(normalize(initial))
      setRrpByCountry(Object.fromEntries((countries ?? []).map(c => [c.id, initialRrp?.[c.id] != null ? String(initialRrp[c.id]) : ''])))
      setFdByCountry(Object.fromEntries((countries ?? []).map(c => [c.id, initialFd?.[c.id] != null ? String(initialFd[c.id]) : ''])))
    }
  }, [open, initial, initialRrp, initialFd, countries])

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
    const priceRows = (countries ?? []).map(c => {
      const rraw = (rrpByCountry[c.id] ?? '').trim(), fraw = (fdByCountry[c.id] ?? '').trim()
      return { country_id: c.id, rrp: rraw === '' ? null : Number(rraw), fd_buying_price: fraw === '' ? null : Number(fraw), currency: c.currency }
    })
    startTransition(async () => {
      const ok = await onSubmit(form, priceRows)
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
            <Field label="BOM ¥ (RMB · 成本)">
              <input type="number" step="0.01" value={form.bom_cost_rmb ?? ''} onChange={(e) => setNum('bom_cost_rmb', e.target.value)} className={inputCls} />
              <p className="mt-1 text-[11px] text-gray-400">
                {form.bom_cost_rmb != null && form.bom_cost_rmb !== undefined && Number(form.bom_cost_rmb) > 0
                  ? <>≈ €{(Number(form.bom_cost_rmb) * cnyToEur).toFixed(2)} @ live rate · used in GP</>
                  : <>Stored in RMB; GP uses the live CNY→EUR rate</>}
              </p>
            </Field>

            {/* 每国定价：RRP（建议零售价）+ FD buying price（对分销商出货价），各国不同 */}
            <div className="mt-4">
              <div className="text-[13px] font-medium text-gray-700 mb-1">Per-country pricing · 各国定价</div>
              <p className="text-[11px] text-gray-400 mb-2">同一产品各国 <b>RRP</b>(建议零售价)与 <b>FD buying price</b>(对分销商出货价)都不同,按各国本币填写。销售只看得到自己负责国家的定价(RLS)。</p>
              {countries.length === 0 ? (
                <p className="text-[12px] text-gray-400">无可编辑的国家。</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <div className="grid grid-cols-[auto_1fr_1fr] items-center bg-gray-50 text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
                    <span className="px-3 py-1.5">Country</span>
                    <span className="px-3 py-1.5 border-l border-gray-200">RRP</span>
                    <span className="px-3 py-1.5 border-l border-gray-200">FD buying price</span>
                  </div>
                  {countries.map(c => (
                    <div key={c.id} className="grid grid-cols-[auto_1fr_1fr] items-center border-t border-gray-100">
                      <span className="px-3 py-1.5 w-16 text-[13px] text-gray-600 whitespace-nowrap">{c.flag_emoji} {c.code}</span>
                      {([['rrp', rrpByCountry, setRrpByCountry], ['fd', fdByCountry, setFdByCountry]] as const).map(([kind, state, setState]) => (
                        <div key={kind} className="relative border-l border-gray-100">
                          <input type="number" step="0.01" min={0} value={state[c.id] ?? ''}
                            onChange={(e) => setState(p => ({ ...p, [c.id]: e.target.value }))}
                            className="w-full bg-transparent px-3 py-1.5 pr-12 text-[13px] outline-none focus:bg-yellow-50" placeholder="—" />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 pointer-events-none">{c.currency || ''}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
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
      rrp_eur: null, rrp_usd: null, cost_usd: null, bom_cost_rmb: null,
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
    bom_cost_rmb: s.bom_cost_rmb,
    lifecycle: s.lifecycle,
    launch_date: s.launch_date,
    region_scope: s.region_scope,
    sort_order: s.sort_order,
    notes: s.notes,
    series: s.series,
    family: s.family,
  }
}
