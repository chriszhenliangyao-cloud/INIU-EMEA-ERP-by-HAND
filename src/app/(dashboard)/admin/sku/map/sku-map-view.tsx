'use client'

/**
 * SKU Product Map — admin only（与 /admin/ka 的 Channel Map 同构）
 *
 * 层级：Category 区块 → Family 节点（树状连接线）→ 型号卡片
 *  - 同型号的颜色变体聚合在一张卡片里，渲染成色点 chips（命名规范：code = <MODEL>-<颜色全称>）
 *  - 每个 SKU 显示 lifecycle 徽章 / active 状态 / notes ⓘ
 *  - chip / 卡片点击 → 行内编辑（name/code/category/series/family/lifecycle/active/notes）
 *  - 完整字段编辑（价格/EAN/箱规等）仍去 ⚙️ SKU Master Data 表格面板
 */

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  createSKU,
  updateSKU,
  deactivateSKU,
  reactivateSKU,
  deleteSKUPermanently,
  getSKUReferenceCount,
} from '../_actions/manage-sku'
import { LifecycleGantt } from './lifecycle-gantt'

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
  viewerName: string
}

// 颜色全称字典（与 code 后缀一致）→ 色点。新增颜色在此补一行即可归卡。
const COLOR_DOT: Record<string, string> = {
  Black: '#1f2937', White: '#e5e7eb', Orange: '#f97316',
  Blue: '#3b82f6', Titan: '#9ca3af', DesertTitan: '#d6b88a',
  Red: '#ef4444', LB: '#7dd3fc',
}
const COLOR_WORDS = Object.keys(COLOR_DOT)
// chip 显示名（缩写后缀 → 全称），缺省用后缀本身
const COLOR_LABEL: Record<string, string> = { LB: 'Light Blue' }

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
  active: 'bg-green-50 text-green-700',
  npi: 'bg-blue-50 text-blue-600',
  eol: 'bg-amber-50 text-amber-700',
  discontinued: 'bg-gray-200 text-gray-500',
}

export function SkuMapView({ allSkus, viewerName }: Props) {
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)
  const [addingGlobal, setAddingGlobal] = useState(false)
  const [view, setView] = useState<'list' | 'graph'>('list')
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
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">🧬 SKU Product Map</h1>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg bg-gray-500/10 p-0.5 text-xs font-medium">
            <button onClick={() => setView('list')} className={`px-2.5 py-1 rounded-md transition ${view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>☰ 列表</button>
            <button onClick={() => setView('graph')} className={`px-2.5 py-1 rounded-md transition ${view === 'graph' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>🕸 图谱</button>
          </div>
          <button onClick={() => setAddingGlobal(v => !v)}
            className="px-3 py-1 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700">
            ＋ New SKU
          </button>
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

      {addingGlobal && (
        <div className="mb-5">
          <AddSkuForm
            prefill={{}}
            title="New SKU（任意产品）"
            onDone={(m) => { flash('success', m); setAddingGlobal(false) }}
            onError={(m) => flash('error', m)}
            onCancel={() => setAddingGlobal(false)}
          />
        </div>
      )}

      {view === 'list' ? (
        <div className="space-y-6">
          {categories.map(cat => (
            <CategorySection
              key={cat}
              category={cat}
              skus={allSkus.filter(s => (s.category ?? '(uncategorized)') === cat)}
              onSuccess={(m) => flash('success', m)}
              onError={(m) => flash('error', m)}
            />
          ))}
        </div>
      ) : (
        <SkuGraphView allSkus={allSkus} categories={categories}
          onSuccess={(m) => flash('success', m)} onError={(m) => flash('error', m)} />
      )}
    </div>
  )
}

// ───────────────────────────────────────
// 图谱视图（node-graph mind-map）：Category(根) → Series → Family → 型号 → 颜色叶子
// 贝塞尔曲线按 family 配色；点中型号/颜色 → 右侧固定抽屉复用 ModelCard（编辑/+颜色/生命周期甘特全在）
// ───────────────────────────────────────
function SkuGraphView({ allSkus, categories, onSuccess, onError }: {
  allSkus: Sku[]; categories: string[]; onSuccess: (m: string) => void; onError: (m: string) => void
}) {
  const [selModel, setSelModel] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ category: string; series: string | null; family: string } | null>(null)
  const selVariants = useMemo(() => (selModel ? allSkus.filter(s => splitModel(s.code).model === selModel) : []), [selModel, allSkus])
  const PAL = ['#0071e3', '#1d7a3d', '#c77800', '#e3326a', '#9333ea', '#0d9488', '#b45309', '#5e5ce6', '#db2777', '#0a84c9']
  const ROOT_X = 8, ROOT_W = 120, SER_X = 156, SER_W = 124, FAM_X = 308, FAM_W = 134, MOD_X = 470, MOD_W = 118, COL_X = 614, COL_W = 122
  const LEAF = 44, FGAP = 16, SGAP = 24, W = COL_X + COL_W + 16
  const card = 'bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)]'
  const bz = (x1: number, y1: number, x2: number, y2: number) => { const mx = (x1 + x2) / 2; return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}` }

  return (
    <div className="space-y-6">
      {categories.map(cat => {
        const catSkus = allSkus.filter(s => (s.category ?? '(uncategorized)') === cat)
        const sMap = new Map<string, Map<string, Sku[]>>()
        catSkus.forEach(s => {
          const ser = s.series ?? 'Other', fam = s.family ?? '(no family)'
          if (!sMap.has(ser)) sMap.set(ser, new Map())
          const fm = sMap.get(ser)!; if (!fm.has(fam)) fm.set(fam, []); fm.get(fam)!.push(s)
        })
        // ── tidy-tree 布局：叶子（颜色或单色型号）逐个排 y，父节点居中其子 ──
        let y = 14, famIdx = 0
        const seriesNodes = Array.from(sMap.entries()).map(([ser, fm]) => {
          const families = Array.from(fm.entries()).map(([fam, skus]) => {
            const color = PAL[famIdx++ % PAL.length]
            const mMap = new Map<string, Sku[]>()
            skus.forEach(s => { const { model } = splitModel(s.code); if (!mMap.has(model)) mMap.set(model, []); mMap.get(model)!.push(s) })
            const models = Array.from(mMap.entries()).map(([model, variants]) => {
              if (variants.length > 1) {
                const leaves = variants.map(v => { const { color: c } = splitModel(v.code); const ly = y + LEAF / 2; y += LEAF; return { id: v.id, label: c ?? 'base', hex: c ? (COLOR_DOT[c] ?? '#ccc') : '#e5e7eb', y: ly } })
                return { model, variants, leaves, my: (leaves[0].y + leaves[leaves.length - 1].y) / 2 }
              }
              const my = y + LEAF / 2; y += LEAF
              return { model, variants, leaves: [] as { id: number; label: string; hex: string; y: number }[], my }
            })
            const plusY = y + 15; y += 30 + FGAP
            return { fam, color, models, plusY, fy: (models[0].my + models[models.length - 1].my) / 2 }
          })
          y += SGAP
          return { ser, families, sy: (families[0].fy + families[families.length - 1].fy) / 2 }
        })
        const totalH = Math.max(y, LEAF)
        const rootY = (seriesNodes[0].sy + seriesNodes[seriesNodes.length - 1].sy) / 2
        return (
          <div key={cat} className={`${card} p-4`}>
            <div className="overflow-x-auto">
              <div className="relative" style={{ height: totalH, minWidth: W }}>
                <svg className="absolute inset-0 pointer-events-none" width={W} height={totalH}>
                  {seriesNodes.map((s, si) => (
                    <Fragment key={si}>
                      <path d={bz(ROOT_X + ROOT_W, rootY, SER_X, s.sy)} fill="none" stroke="#cbd5e1" strokeWidth={1.8} />
                      {s.families.map((f, fi) => (
                        <Fragment key={fi}>
                          <path d={bz(SER_X + SER_W, s.sy, FAM_X, f.fy)} fill="none" stroke={f.color} strokeWidth={2} opacity={0.85} />
                          {f.models.map((m, mi) => (
                            <Fragment key={mi}>
                              <path d={bz(FAM_X + FAM_W, f.fy, MOD_X, m.my)} fill="none" stroke={f.color} strokeWidth={1.8} opacity={0.8} />
                              {m.leaves.map((l, li) => <path key={li} d={bz(MOD_X + MOD_W, m.my, COL_X, l.y)} fill="none" stroke={f.color} strokeWidth={1.5} opacity={0.5} />)}
                            </Fragment>
                          ))}
                          <path d={bz(FAM_X + FAM_W, f.fy, MOD_X, f.plusY)} fill="none" stroke={f.color} strokeWidth={1.4} strokeDasharray="4 4" opacity={0.45} />
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </svg>

                {/* root = Category */}
                <div className="absolute flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ left: ROOT_X, top: rootY - 17, width: ROOT_W, background: '#1c1c1e' }}>
                  <span className="text-[12.5px] font-semibold text-white truncate">{cat}</span>
                  <span className="ml-auto text-[9px] text-white/55 tabular-nums">{catSkus.length}</span>
                </div>

                {seriesNodes.map((s, si) => (
                  <Fragment key={si}>
                    {/* series */}
                    <div className="absolute rounded-xl px-3 py-1.5" style={{ left: SER_X, top: s.sy - 15, width: SER_W, background: '#eef0f3' }}>
                      <span className="block text-[12px] font-semibold truncate" style={{ color: '#475569' }}>{s.ser}</span>
                    </div>
                    {s.families.map((f, fi) => (
                      <Fragment key={fi}>
                        {/* family */}
                        <div className="absolute rounded-xl px-3 py-1.5" style={{ left: FAM_X, top: f.fy - 15, width: FAM_W, background: f.color }}>
                          <span className="block text-[12px] font-semibold text-white truncate">{f.fam}</span>
                        </div>
                        {/* 型号 */}
                        {f.models.map((m, mi) => {
                          const active = selModel === m.model
                          const anyActive = m.variants.some(v => v.is_active)
                          return (
                            <button key={mi} onClick={() => { setAdding(null); setSelModel(active ? null : m.model) }} title={m.variants[0]?.name ?? ''}
                              className="absolute rounded-xl border transition flex items-center gap-1.5 px-2.5 py-1.5"
                              style={{ left: MOD_X, top: m.my - 16, width: MOD_W, color: f.color, background: active ? f.color + '2e' : f.color + '14', borderColor: active ? f.color : f.color + '40', boxShadow: active ? `0 0 0 3px ${f.color}22` : 'none', zIndex: active ? 10 : 1 }}>
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: anyActive ? '#34c759' : '#c7c7cc' }} />
                              <span className="font-mono text-[11px] font-bold truncate">{m.model}</span>
                            </button>
                          )
                        })}
                        {/* 颜色叶子 */}
                        {f.models.map((m, mi) => m.leaves.map((l, li) => (
                          <button key={`${mi}-${li}`} onClick={() => { setAdding(null); setSelModel(m.model) }} title={`${m.model} · ${l.label}`}
                            className="absolute rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition flex items-center gap-1.5 px-2 py-1"
                            style={{ left: COL_X, top: l.y - 13, width: COL_W }}>
                            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: l.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)' }} />
                            <span className="text-[11px] text-gray-700 truncate">{l.label}</span>
                          </button>
                        )))}
                        {/* 「＋型号」幽灵节点 → 右侧抽屉展开表单 */}
                        <button onClick={() => { setSelModel(null); setAdding({ category: cat, series: s.ser === 'Other' ? null : s.ser, family: f.fam === '(no family)' ? '' : f.fam }) }}
                          className="absolute rounded-lg border border-dashed bg-white text-[10.5px] font-medium transition flex items-center justify-center"
                          style={{ left: MOD_X, top: f.plusY - 11, width: MOD_W, height: 22, color: f.color, borderColor: f.color + '66' }}>＋ 型号</button>
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        )
      })}

      {/* 右侧固定抽屉：点中型号/颜色即开，永远可见 */}
      {selModel && selVariants.length > 0 && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setSelModel(null)} />
          <div className="absolute right-0 top-0 bottom-0 w-[600px] max-w-[94vw] bg-white shadow-2xl overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-900">{selModel} · 详情与生命周期</span>
              <button onClick={() => setSelModel(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <ModelCard key={selModel} model={selModel} variants={selVariants} onSuccess={onSuccess} onError={onError} />
          </div>
        </div>
      )}

      {/* 右侧固定抽屉：新增型号表单（与详情同款，不再落到页面底部） */}
      {adding && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setAdding(null)} />
          <div className="absolute right-0 top-0 bottom-0 w-[460px] max-w-[94vw] bg-white shadow-2xl overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-900">在 {adding.family || '(no family)'} 下新增型号</span>
              <button onClick={() => setAdding(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <AddSkuForm prefill={{ category: adding.category, series: adding.series, family: adding.family }}
              title={`在 ${adding.family || '(no family)'} 下新增型号`}
              onDone={(m) => { onSuccess(m); setAdding(null) }} onError={onError} onCancel={() => setAdding(null)} />
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────
// Category 区块 → Family 树
// ───────────────────────────────────────
function CategorySection({ category, skus, onSuccess, onError }: {
  category: string
  skus: Sku[]
  onSuccess: (m: string) => void
  onError: (m: string) => void
}) {
  const [adding, setAdding] = useState(false)
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
    <section className="bg-white border border-black/[0.06] rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)]">
      <div className="px-5 py-3 border-b bg-gray-50 rounded-t-xl flex items-center gap-2">
        <span className="font-bold text-gray-900">{category}</span>
        <span className="ml-auto text-xs text-gray-500">
          {skus.filter(s => s.is_active).length} active / {skus.length} SKUs
        </span>
        <button onClick={() => setAdding(v => !v)}
          className="text-xs text-green-700 hover:bg-green-100 rounded px-2 py-0.5 font-medium">＋ Add product</button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {adding && (
          <AddSkuForm
            prefill={{ category: category === '(uncategorized)' ? '' : category }}
            title={`Add a new product / family under ${category}`}
            onDone={(m) => { onSuccess(m); setAdding(false) }}
            onError={onError}
            onCancel={() => setAdding(false)}
          />
        )}
        {families.map(([family, group], fi) => (
          <FamilyBlock
            key={family}
            family={family}
            series={group.series}
            skus={group.skus}
            isLast={fi === families.length - 1}
            onSuccess={onSuccess}
            onError={onError}
          />
        ))}
      </div>
    </section>
  )
}

function FamilyBlock({ family, series, skus, isLast, onSuccess, onError }: {
  family: string
  series: string | null
  skus: Sku[]
  isLast: boolean
  onSuccess: (m: string) => void
  onError: (m: string) => void
}) {
  const [adding, setAdding] = useState(false)
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
            onSuccess={onSuccess}
            onError={onError}
          />
        ))}
        {adding ? (
          <AddSkuForm
            prefill={{ category: skus[0]?.category ?? '', series, family: family === '(no family)' ? '' : family }}
            title={`Add a new model under ${family}`}
            onDone={(m) => { onSuccess(m); setAdding(false) }}
            onError={onError}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button onClick={() => setAdding(true)}
            className="text-xs text-green-700 hover:bg-green-100 rounded px-2 py-0.5 font-medium">＋ Add model</button>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────────────────
// 型号卡片：单体 SKU 或 颜色变体 chips
// ───────────────────────────────────────
function ModelCard({ model, variants, onSuccess, onError }: {
  model: string
  variants: Sku[]
  onSuccess: (m: string) => void
  onError: (m: string) => void
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [showLife, setShowLife] = useState(false)
  const multi = variants.length > 1 || splitModel(variants[0].code).color !== null
  // 型号显示名：去掉颜色后缀的公共部分
  const baseName = variants[0].name.split(' - ')[0]
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
          <span className="ml-auto flex-shrink-0" />
          {!multi && (
            <button
              onClick={() => setEditingId(editingId === variants[0].id ? null : variants[0].id)}
              className="px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded flex-shrink-0"
            >
              Edit
            </button>
          )}
          <button onClick={() => setAdding(v => !v)} title={`给 ${model} 加一个颜色 / 变体`}
            className="px-1.5 py-0.5 text-xs text-green-700 hover:bg-green-100 rounded flex-shrink-0 font-medium">
            ＋ 颜色
          </button>
          <button onClick={() => setShowLife(v => !v)} title={`查看 ${model} 生命周期`}
            className={`px-1.5 py-0.5 text-xs rounded flex-shrink-0 font-medium transition ${showLife ? 'bg-indigo-600 text-white' : 'text-indigo-700 hover:bg-indigo-100'}`}>
            📅 生命周期 <span className="text-[9px]">{showLife ? '▲' : '▼'}</span>
          </button>
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
                  title={`${v.code} · ${v.name}${v.notes ? `\n${v.notes}` : ''}`}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] transition
                    ${editingId === v.id ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'}
                    ${!v.is_active ? 'opacity-50 line-through' : ''}`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-gray-300 flex-shrink-0"
                    style={{ background: color ? COLOR_DOT[color] : '#fff' }}
                  />
                  {color ? (COLOR_LABEL[color] ?? color) : v.code}
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

        {/* 加颜色 / 变体（预填该型号的基号与家族） */}
        {adding && (
          <AddSkuForm
            prefill={{
              code: `${model}-`,
              name: `${baseName} - `,
              category: variants[0].category,
              series: variants[0].series,
              family: variants[0].family,
              lifecycle: variants[0].lifecycle ?? 'active',
            }}
            title={`Add a colour / variant to ${model}`}
            onDone={(m) => { setAdding(false); onSuccess(m) }}
            onError={onError}
            onCancel={() => setAdding(false)}
          />
        )}

        {/* 生命周期甘特图（下拉展开） */}
        {showLife && (
          <LifecycleGantt modelCode={model} modelName={baseName}
            subtitle={[variants[0].category, variants[0].series, variants[0].family].filter(Boolean).join(' / ')}
            currentLifecycle={lifecycle} skuVariants={variants.map(v => ({ id: v.id, color: splitModel(v.code).color }))} />
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

// ───────────────────────────────────────
// 新增 SKU 表单（4 个入口复用；精简字段，按上下文预填）
// ───────────────────────────────────────
type AddPrefill = Partial<Pick<Sku, 'code' | 'name' | 'color' | 'category' | 'series' | 'family' | 'lifecycle'>>
function AddSkuForm({ prefill, title, onDone, onError, onCancel }: {
  prefill: AddPrefill
  title: string
  onDone: (m: string) => void
  onError: (m: string) => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [code, setCode] = useState(prefill.code ?? '')
  const [name, setName] = useState(prefill.name ?? '')
  const [color, setColor] = useState(prefill.color ?? '')
  const [category, setCategory] = useState(prefill.category ?? '')
  const [series, setSeries] = useState(prefill.series ?? '')
  const [family, setFamily] = useState(prefill.family ?? '')
  const [lifecycle, setLifecycle] = useState(prefill.lifecycle ?? 'active')
  const [err, setErr] = useState<string | null>(null)

  const submit = () => startTransition(async () => {
    setErr(null)
    const r = await createSKU({
      code, name,
      color: color || null, category: category || null,
      series: series || null, family: family || null, lifecycle,
    })
    if (!r.ok) { setErr(r.error); onError(r.error); return }
    onDone(`${code.trim()} created`)
    router.refresh()
  })

  return (
    <div className="mt-2 border border-green-300 rounded-lg p-3 bg-green-50/50 space-y-2">
      <div className="text-xs font-semibold text-green-800">➕ {title}</div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 block">Code *</label>
          <input value={code} onChange={e => setCode(e.target.value)} autoFocus
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono" placeholder="e.g. P75-P1-Green" />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-gray-500 block">Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="e.g. MagPro Slim 5K - Green" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block">Color</label>
          <input value={color} onChange={e => setColor(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="e.g. Green" />
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
      </div>
      {err && (
        <div className="px-2 py-1.5 rounded bg-red-50 border border-red-300 text-xs text-red-700">⚠️ {err}</div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400">价格 / EAN / 箱规等请到 ⚙️ Master Data 补</span>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200 rounded">Cancel</button>
          <button onClick={submit} disabled={isPending || !code.trim() || !name.trim()}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
            {isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

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
