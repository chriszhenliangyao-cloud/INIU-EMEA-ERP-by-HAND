'use client'

/**
 * SKU Product Map — admin only（与 /admin/ka 的 Channel Map 同构）
 *
 * 层级：Category 区块 → Family 节点（树状连接线）→ 型号卡片
 *  - 同型号的颜色变体聚合在一张卡片里，渲染成色点 chips（命名规范：code = <MODEL>-<颜色全称>）
 *  - 每个 SKU 显示 lifecycle 徽章 / active 状态 / 数据量（🚚 ship · 📊 PSI）/ notes ⓘ
 *  - chip / 卡片点击 → 行内编辑（name/code/category/series/family/lifecycle/active/notes）
 *  - 完整字段编辑（价格/EAN/箱规等）仍去 ⚙️ SKU Master Data 表格面板
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  updateSKU,
  deactivateSKU,
  reactivateSKU,
  deleteSKUPermanently,
  getSKUReferenceCount,
} from '../_actions/manage-sku'

type Sku = {
  id: number
  code: string
  name: string
  category: string | null
  series: string | null
  family: string | null
  color: string | null
  lifecycle: string | null
  is_active: boolean
  sort_order: number
  notes: string | null
  rrp_eur: number | null
}

type Props = {
  allSkus: Sku[]
  shipCount: Record<number, number>
  psiCount: Record<number, number>
  viewerName: string
}

// 颜色全称字典（与 code 后缀一致）→ 色点
const COLOR_DOT: Record<string, string> = {
  Black: '#1f2937', White: '#e5e7eb', Orange: '#f97316',
  Blue: '#3b82f6', Titan: '#9ca3af', DesertTitan: '#d6b88a',
}
const COLOR_WORDS = Object.keys(COLOR_DOT)

// code = <MODEL>-<颜色全称> → 拆出型号与颜色
function splitModel(code: string): { model: string; color: string | null } {
  const idx = code.lastIndexOf('-')
  if (idx > 0) {
    const tail = code.slice(idx + 1)
    if (COLOR_WORDS.includes(tail)) return { model: code.slice(0, idx), color: tail }
  }
  return { model: code, color: null }
}

const CATEGORY_ORDER: Record<string, number> = {
  'Power bank': 1,
  'Charger': 2,
  'Wireless charger': 3,
  'Cable': 4,
  'Bundle': 5,
}

const LIFECYCLE_STYLE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  npi: 'bg-blue-100 text-blue-700',
  eol: 'bg-amber-100 text-amber-700',
  discontinued: 'bg-gray-200 text-gray-500',
}

export function SkuMapView({ allSkus, shipCount, psiCount, viewerName }: Props) {
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)
  const flash = (kind: 'success' | 'error', msg: string) => {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), kind === 'error' ? 5000 : 2500)
  }

  const categories = useMemo(() => {
    const set = Array.from(new Set(allSkus.map(s => s.category ?? '(uncategorized)')))
    return set.sort((a, b) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99) || a.localeCompare(b))
  }, [allSkus])

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">🧬 SKU Product Map</h1>
        <div className="flex items-center gap-3">
          <Link href="/admin/sku" className="text-xs text-blue-600 hover:underline">
            ⚙️ 完整字段编辑（价格/EAN/箱规）→ SKU Master Data
          </Link>
          <span className="text-xs text-gray-500">Signed in as {viewerName}</span>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Category → Family → 型号（颜色变体聚合为色点）　·　{allSkus.length} SKUs · 全部变更进 audit log
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-md text-sm border ${
          toast.kind === 'success'
            ? 'bg-green-50 text-green-700 border-green-300'
            : 'bg-red-50 text-red-700 border-red-300'
        }`}>
          {toast.kind === 'success' ? '✓ ' : '⚠️ '}{toast.msg}
        </div>
      )}

      <div className="space-y-6">
        {categories.map(cat => (
          <CategorySection
            key={cat}
            category={cat}
            skus={allSkus.filter(s => (s.category ?? '(uncategorized)') === cat)}
            shipCount={shipCount}
            psiCount={psiCount}
            onSuccess={(m) => flash('success', m)}
            onError={(m) => flash('error', m)}
          />
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────────────────
// Category 区块 → Family 树
// ───────────────────────────────────────
function CategorySection({ category, skus, shipCount, psiCount, onSuccess, onError }: {
  category: string
  skus: Sku[]
  shipCount: Record<number, number>
  psiCount: Record<number, number>
  onSuccess: (m: string) => void
  onError: (m: string) => void
}) {
  // family 分组（含 series 标注）
  const families = useMemo(() => {
    const m = new Map<string, { series: string | null; skus: Sku[] }>()
    skus.forEach(s => {
      const key = s.family ?? '(no family)'
      if (!m.has(key)) m.set(key, { series: s.series, skus: [] })
      m.get(key)!.skus.push(s)
    })
    return Array.from(m.entries())
  }, [skus])

  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="px-5 py-3 border-b bg-gray-50 rounded-t-xl flex items-center gap-2">
        <span className="font-bold text-gray-900">{category}</span>
        <span className="ml-auto text-xs text-gray-500">
          {skus.filter(s => s.is_active).length} active / {skus.length} SKUs
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        {families.map(([family, group], fi) => (
          <FamilyBlock
            key={family}
            family={family}
            series={group.series}
            skus={group.skus}
            isLast={fi === families.length - 1}
            shipCount={shipCount}
            psiCount={psiCount}
            onSuccess={onSuccess}
            onError={onError}
          />
        ))}
      </div>
    </section>
  )
}

function FamilyBlock({ family, series, skus, isLast, shipCount, psiCount, onSuccess, onError }: {
  family: string
  series: string | null
  skus: Sku[]
  isLast: boolean
  shipCount: Record<number, number>
  psiCount: Record<number, number>
  onSuccess: (m: string) => void
  onError: (m: string) => void
}) {
  // 按型号聚合颜色变体
  const models = useMemo(() => {
    const m = new Map<string, Sku[]>()
    skus.forEach(s => {
      const { model } = splitModel(s.code)
      if (!m.has(model)) m.set(model, [])
      m.get(model)!.push(s)
    })
    return Array.from(m.entries())
  }, [skus])

  return (
    <div className="flex">
      {/* Family 节点 + 连接线 */}
      <div className="w-44 flex-shrink-0 relative pr-3">
        <div className="sticky top-2">
          <div className="text-sm font-semibold text-purple-700">{family}</div>
          {series && <div className="text-[10px] text-gray-400">{series} series</div>}
        </div>
        <div className={`absolute right-0 top-1 w-px bg-gray-300 ${isLast ? 'h-full' : 'h-full'}`} />
      </div>

      {/* 型号卡片列 */}
      <div className="flex-1 space-y-1.5 min-w-0">
        {models.map(([model, variants]) => (
          <ModelCard
            key={model}
            model={model}
            variants={variants}
            shipCount={shipCount}
            psiCount={psiCount}
            onSuccess={onSuccess}
            onError={onError}
          />
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────────────────
// 型号卡片：单体 SKU 或 颜色变体 chips
// ───────────────────────────────────────
function ModelCard({ model, variants, shipCount, psiCount, onSuccess, onError }: {
  model: string
  variants: Sku[]
  shipCount: Record<number, number>
  psiCount: Record<number, number>
  onSuccess: (m: string) => void
  onError: (m: string) => void
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const multi = variants.length > 1 || splitModel(variants[0].code).color !== null
  // 型号显示名：去掉颜色后缀的公共部分
  const baseName = variants[0].name.split(' - ')[0]
  const totalShip = variants.reduce((s, v) => s + (shipCount[v.id] ?? 0), 0)
  const totalPsi = variants.reduce((s, v) => s + (psiCount[v.id] ?? 0), 0)
  const anyActive = variants.some(v => v.is_active)
  const lifecycle = variants[0].lifecycle ?? 'active'

  const editing = editingId !== null ? variants.find(v => v.id === editingId) ?? null : null

  return (
    <div className="relative">
      {/* 横向连接线 + 箭头 */}
      <div className="absolute -left-3 top-1/2 w-3 h-px bg-gray-300" />

      <div className={`border rounded-lg px-3 py-1.5 ${anyActive ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-70'}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${anyActive ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="font-mono text-xs font-bold text-gray-800 flex-shrink-0">{model}</span>
          <span className="text-sm text-gray-900 truncate">{baseName}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${LIFECYCLE_STYLE[lifecycle] ?? 'bg-gray-100 text-gray-600'}`}>
            {lifecycle}
          </span>
          {variants.length === 1 && variants[0].notes && (
            <span className="text-gray-400 hover:text-gray-700 cursor-help text-xs" title={variants[0].notes}>ⓘ</span>
          )}
          <span className="ml-auto text-[11px] text-gray-400 tabular-nums flex-shrink-0">
            {totalShip > 0 && <span className="mr-2">🚚 {totalShip}</span>}
            {totalPsi > 0 && <span>📊 {totalPsi}</span>}
          </span>
          {!multi && (
            <button
              onClick={() => setEditingId(editingId === variants[0].id ? null : variants[0].id)}
              className="px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded flex-shrink-0"
            >
              Edit
            </button>
          )}
        </div>

        {/* 颜色变体 chips */}
        {multi && (
          <div className="flex flex-wrap gap-1.5 mt-1.5 ml-4">
            {variants.map(v => {
              const { color } = splitModel(v.code)
              return (
                <button
                  key={v.id}
                  onClick={() => setEditingId(editingId === v.id ? null : v.id)}
                  title={`${v.code} · ${v.name}${v.notes ? `\n${v.notes}` : ''}\n🚚 ${shipCount[v.id] ?? 0} · 📊 ${psiCount[v.id] ?? 0}`}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] transition
                    ${editingId === v.id ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'}
                    ${!v.is_active ? 'opacity-50 line-through' : ''}`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-gray-300 flex-shrink-0"
                    style={{ background: color ? COLOR_DOT[color] : '#fff' }}
                  />
                  {color ?? v.code}
                  <span className="text-gray-400 tabular-nums">
                    {(shipCount[v.id] ?? 0) + (psiCount[v.id] ?? 0) > 0 ? `· ${(shipCount[v.id] ?? 0) + (psiCount[v.id] ?? 0)}` : ''}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* 行内编辑 */}
        {editing && (
          <SkuEditor
            sku={editing}
            onDone={(msg) => { setEditingId(null); onSuccess(msg) }}
            onError={onError}
            onCancel={() => setEditingId(null)}
          />
        )}
      </div>
    </div>
  )
}

// ───────────────────────────────────────
// 行内编辑器
// ───────────────────────────────────────
const CATEGORY_OPTIONS = ['Power bank', 'Charger', 'Wireless charger', 'Cable', 'Bundle']
const LIFECYCLE_OPTIONS = ['active', 'npi', 'eol', 'discontinued']

function SkuEditor({ sku, onDone, onError, onCancel }: {
  sku: Sku
  onDone: (msg: string) => void
  onError: (msg: string) => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [code, setCode] = useState(sku.code)
  const [name, setName] = useState(sku.name)
  const [category, setCategory] = useState(sku.category ?? '')
  const [series, setSeries] = useState(sku.series ?? '')
  const [family, setFamily] = useState(sku.family ?? '')
  const [lifecycle, setLifecycle] = useState(sku.lifecycle ?? 'active')
  const [active, setActive] = useState(sku.is_active)
  const [notes, setNotes] = useState(sku.notes ?? '')

  const [refs, setRefs] = useState<{ shipments: number; forecast_cells: number; psi_rows: number } | null>(null)
  useEffect(() => {
    getSKUReferenceCount(sku.id).then(r => setRefs(r as any))
  }, [sku.id])
  const refTotal = refs ? refs.shipments + refs.forecast_cells + refs.psi_rows : null
  const canDelete = refTotal === 0

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateSKU(sku.id, {
        code, name,
        category: category || null,
        series: series || null,
        family: family || null,
        lifecycle: lifecycle || null,
        notes: notes || null,
      })
      if (!result.ok) { onError(result.error); return }
      // active 状态单独走 deactivate/reactivate（带 audit 语义）
      if (active !== sku.is_active) {
        const r2 = active ? await reactivateSKU(sku.id) : await deactivateSKU(sku.id)
        if (!r2.ok) { onError(r2.error); return }
      }
      onDone(`${code} updated`)
      router.refresh()
    })
  }

  const handleDelete = () => {
    if (!confirm(`Permanently delete "${sku.code}"? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteSKUPermanently(sku.id)
      if (!result.ok) { onError(result.error); return }
      onDone(`${sku.code} deleted`)
      router.refresh()
    })
  }

  return (
    <div className="mt-2 ml-4 border border-blue-200 rounded-lg p-3 bg-blue-50/40 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 block">Code</label>
          <input value={code} onChange={e => setCode(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono" />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-gray-500 block">Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block">Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white">
            <option value="">—</option>
            {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block">Series</label>
          <input value={series} onChange={e => setSeries(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block">Family</label>
          <input value={family} onChange={e => setFamily(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block">Lifecycle</label>
          <select value={lifecycle} onChange={e => setLifecycle(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white">
            {LIFECYCLE_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-gray-500 block">Notes / Tips</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Active
          </label>
          <button
            onClick={handleDelete}
            disabled={isPending || !canDelete}
            title={
              refs === null
                ? 'Checking references…'
                : canDelete
                  ? 'Permanently delete (no data attached)'
                  : `有数据无法硬删：${refs.shipments} ship · ${refs.psi_rows} PSI · ${refs.forecast_cells} fcst — 请改用停用`
            }
            className="px-2.5 py-1 text-xs text-red-700 hover:bg-red-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            🗑 Delete
          </button>
          {refs !== null && !canDelete && (
            <span className="text-[10px] text-gray-400">
              🚚 {refs.shipments} · 📊 {refs.psi_rows} · fcst {refs.forecast_cells}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200 rounded">
            Cancel
          </button>
          <button onClick={handleSave} disabled={isPending || !code.trim() || !name.trim()}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
