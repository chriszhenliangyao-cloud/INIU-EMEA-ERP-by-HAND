'use client'

/**
 * KA Channel Map — admin only
 *
 * 渠道层级映射图：国家 → FD(📦 distributor) → 集团(🏢 group) → retailer(🛒)
 *  - 每个国家一个 section，树状箭头展示供货链
 *  - 节点显示：类型徽章 / active 状态 / 数据量（ship · PSI）/ notes tooltip
 *  - 行内编辑：name / type / parent / active / notes（层级合法性由 DB trigger 把关）
 *  - 已合并/停用且无下游的 KA 收进底部折叠区
 *
 * 颜色约定（项目惯例）：紫=FD/Master、琥珀=group、蓝=retailer/KA、绿=active
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { adminCreateKa, adminDeleteKa, adminGetKaRefs, adminUpdateKa } from './_actions/manage-ka-admin'

type Ka = {
  id: number
  name: string
  country_id: number
  ka_type: string | null
  parent_ka_id: number | null
  sort_order: number
  is_active: boolean
  notes: string | null
  updated_at: string
}

type Country = {
  id: number
  code: string
  name_en: string
  flag_emoji: string
  sort_order: number
  is_active: boolean
}

type Props = {
  allKas: Ka[]
  countries: Country[]
  shipCount: Record<number, number>
  psiCount: Record<number, number>
  viewerName: string
}

export function KaManagementView({ allKas, countries, shipCount, psiCount, viewerName }: Props) {
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  const flash = (kind: 'success' | 'error', msg: string) => {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), kind === 'error' ? 5000 : 2500)
  }

  // 有 KA 的国家（按 sort_order）
  const countriesWithKas = useMemo(() => {
    const idsWithKa = new Set(allKas.map(k => k.country_id))
    return countries.filter(c => idsWithKa.has(c.id))
  }, [allKas, countries])

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">🗺️ KA Channel Map</h1>
        <span className="text-xs text-gray-500">Signed in as {viewerName} · All changes audit-logged</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        渠道供货链映射：国家 → <Badge type="distributor" /> → <Badge type="group" />（可选）→ <Badge type="retailer" />
        　·　箭头 = 供货方向
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
        {countriesWithKas.map(country => (
          <CountrySection
            key={country.id}
            country={country}
            kas={allKas.filter(k => k.country_id === country.id)}
            shipCount={shipCount}
            psiCount={psiCount}
            onSuccess={(msg) => flash('success', msg)}
            onError={(msg) => flash('error', msg)}
          />
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────────────────
// 国家 section：树 + 折叠的 inactive 区
// ───────────────────────────────────────
function CountrySection({ country, kas, shipCount, psiCount, onSuccess, onError }: {
  country: Country
  kas: Ka[]
  shipCount: Record<number, number>
  psiCount: Record<number, number>
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [showInactive, setShowInactive] = useState(false)

  const childrenOf = useMemo(() => {
    const m: Record<number, Ka[]> = {}
    kas.forEach(k => {
      if (k.parent_ka_id != null) (m[k.parent_ka_id] ??= []).push(k)
    })
    const sortFn = (a: Ka, b: Ka) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    Object.values(m).forEach(arr => arr.sort(sortFn))
    return m
  }, [kas])

  const hasChildren = (id: number) => (childrenOf[id]?.length ?? 0) > 0

  // 树根：无 parent 的节点。inactive 且无下游的根（已合并废弃）收进折叠区
  const roots = kas
    .filter(k => k.parent_ka_id == null && (k.is_active || hasChildren(k.id)))
    .sort((a, b) => {
      const rank = (k: Ka) => (k.ka_type === 'distributor' ? 0 : k.ka_type === 'group' ? 1 : 2)
      return rank(a) - rank(b) || a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    })
  const buried = kas
    .filter(k => k.parent_ka_id == null && !k.is_active && !hasChildren(k.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  // parent 候选：本国 active 的 distributor / group
  const parentOptions = kas.filter(k => (k.ka_type === 'distributor' || k.ka_type === 'group') && k.is_active)

  return (
    <section className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl shadow-sm">
      <div className="px-5 py-3 border-b bg-gray-50 rounded-t-xl flex items-center gap-2">
        <span className="text-xl">{country.flag_emoji}</span>
        <span className="font-bold text-gray-900">{country.name_en}</span>
        <span className="text-xs text-gray-400">({country.code})</span>
        <span className="ml-auto text-xs text-gray-500">
          {kas.filter(k => k.is_active).length} active / {kas.length} total
        </span>
      </div>

      <div className="px-5 py-4 space-y-3">
        {roots.map(root => (
          <TreeNode
            key={root.id}
            ka={root}
            depth={0}
            childrenOf={childrenOf}
            parentOptions={parentOptions}
            shipCount={shipCount}
            psiCount={psiCount}
            onSuccess={onSuccess}
            onError={onError}
          />
        ))}

        <AddChannelInline
          countryId={country.id}
          parentOptions={parentOptions}
          onSuccess={onSuccess}
          onError={onError}
        />

        {buried.length > 0 && (
          <div className="pt-2 border-t border-dashed">
            <button
              onClick={() => setShowInactive(!showInactive)}
              className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"
            >
              <span>{showInactive ? '▼' : '▶'}</span>
              已停用 / 已合并 ({buried.length})
            </button>
            {showInactive && (
              <div className="mt-2 space-y-1.5 opacity-75">
                {buried.map(ka => (
                  <TreeNode
                    key={ka.id}
                    ka={ka}
                    depth={0}
                    childrenOf={childrenOf}
                    parentOptions={parentOptions}
                    shipCount={shipCount}
                    psiCount={psiCount}
                    onSuccess={onSuccess}
                    onError={onError}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ───────────────────────────────────────
// 新增 KA（行内表单）
// ───────────────────────────────────────
function AddChannelInline({ countryId, parentOptions, onSuccess, onError }: {
  countryId: number
  parentOptions: Ka[]
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<'retailer' | 'distributor' | 'group'>('retailer')
  const [parentId, setParentId] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()

  const reset = () => { setName(''); setType('retailer'); setParentId(''); setNotes('') }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      const result = await adminCreateKa({
        country_id: countryId,
        name: name.trim(),
        ka_type: type,
        parent_ka_id: type === 'distributor' ? null : (parentId === '' ? null : parentId),
        notes: notes.trim() || null,
      })
      if (!result.ok) { onError(result.error); return }
      onSuccess(`${name.trim()} added`)
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full px-3 py-2 bg-blue-50 hover:bg-blue-50 text-blue-600 font-medium rounded-lg border border-blue-200 border-dashed text-sm"
      >
        + Add channel
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50/50 border border-blue-200 rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 block">Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus maxLength={100} required
            placeholder="e.g. T-Mobile"
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block">Type</label>
          <select value={type} onChange={e => setType(e.target.value as any)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white">
            <option value="retailer">🛒 Retailer</option>
            <option value="distributor">📦 FD (distributor)</option>
            <option value="group">🏢 Group</option>
          </select>
        </div>
        {type !== 'distributor' && (
          <div>
            <label className="text-[10px] text-gray-500 block">Parent (供货来源)</label>
            <select value={parentId} onChange={e => setParentId(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white">
              <option value="">— Direct（无 parent）—</option>
              {parentOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {(TYPE_STYLE[p.ka_type ?? 'retailer'] ?? TYPE_STYLE.retailer).emoji} {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="text-[10px] text-gray-500 block">Notes / Tips（可选）</label>
        <input value={notes} onChange={e => setNotes(e.target.value)}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { reset(); setOpen(false) }}
          className="px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200 rounded">
          Cancel
        </button>
        <button type="submit" disabled={isPending || !name.trim()}
          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  )
}

// ───────────────────────────────────────
// 树节点（递归）：连接线 + 箭头 + 节点卡片
// ───────────────────────────────────────
function TreeNode({ ka, depth, childrenOf, parentOptions, shipCount, psiCount, onSuccess, onError, isLast = true, prefix = [] }: {
  ka: Ka
  depth: number
  childrenOf: Record<number, Ka[]>
  parentOptions: Ka[]
  shipCount: Record<number, number>
  psiCount: Record<number, number>
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
  isLast?: boolean
  prefix?: boolean[]  // 每层祖先"是否还有后续兄弟"→ 画竖线
}) {
  const children = childrenOf[ka.id] ?? []

  return (
    <div>
      <div className="flex items-stretch">
        {/* 连接线 + 箭头（每层 28px）*/}
        {prefix.map((hasMore, i) => (
          <div key={i} className="w-7 flex-shrink-0 relative">
            {hasMore && <div className="absolute left-3 top-0 bottom-0 w-px bg-black/[0.1]" />}
          </div>
        ))}
        {depth > 0 && (
          <div className="w-7 flex-shrink-0 relative">
            <div className={`absolute left-3 top-0 w-px bg-black/[0.1] ${isLast ? 'h-1/2' : 'h-full'}`} />
            <div className="absolute left-3 top-1/2 right-0 h-px bg-black/[0.1]" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] leading-none">▶</div>
          </div>
        )}

        <NodeCard
          ka={ka}
          parentOptions={parentOptions}
          ship={shipCount[ka.id] ?? 0}
          psi={psiCount[ka.id] ?? 0}
          onSuccess={onSuccess}
          onError={onError}
        />
      </div>

      {children.length > 0 && (
        <div>
          {children.map((child, i) => (
            <TreeNode
              key={child.id}
              ka={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              parentOptions={parentOptions}
              shipCount={shipCount}
              psiCount={psiCount}
              onSuccess={onSuccess}
              onError={onError}
              isLast={i === children.length - 1}
              prefix={[...prefix, ...(depth > 0 ? [!isLast] : [])]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────
// 节点卡片 + 行内编辑
// ───────────────────────────────────────
const TYPE_STYLE: Record<string, { emoji: string; label: string; cls: string; border: string }> = {
  distributor: { emoji: '📦', label: 'FD', cls: 'bg-purple-50 text-purple-600', border: 'border-purple-300' },
  group:       { emoji: '🏢', label: 'Group', cls: 'bg-amber-50 text-amber-700', border: 'border-amber-300' },
  retailer:    { emoji: '🛒', label: 'Retailer', cls: 'bg-blue-50 text-blue-600', border: 'border-blue-200' },
}

function Badge({ type }: { type: string }) {
  const s = TYPE_STYLE[type] ?? TYPE_STYLE.retailer
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${s.cls}`}>
      {s.emoji} {s.label}
    </span>
  )
}

function NodeCard({ ka, parentOptions, ship, psi, onSuccess, onError }: {
  ka: Ka
  parentOptions: Ka[]
  ship: number
  psi: number
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState(ka.name)
  const [type, setType] = useState(ka.ka_type ?? 'retailer')
  const [parentId, setParentId] = useState<number | ''>(ka.parent_ka_id ?? '')
  const [active, setActive] = useState(ka.is_active)
  const [notes, setNotes] = useState(ka.notes ?? '')

  // 进入编辑态时拉引用计数（决定能否硬删）
  const [refs, setRefs] = useState<{ forecast_cells: number; shipments: number; psi_rows: number; children: number } | null>(null)
  useEffect(() => {
    if (editing && refs === null) {
      adminGetKaRefs(ka.id).then(setRefs)
    }
  }, [editing, refs, ka.id])
  const refTotal = refs ? refs.forecast_cells + refs.shipments + refs.psi_rows + refs.children : null
  const canDelete = refTotal === 0

  const handleDelete = () => {
    if (!confirm(`Permanently delete "${ka.name}"? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await adminDeleteKa(ka.id)
      if (!result.ok) { onError(result.error); return }
      onSuccess(`${ka.name} deleted`)
      router.refresh()
    })
  }

  const style = TYPE_STYLE[ka.ka_type ?? 'retailer'] ?? TYPE_STYLE.retailer

  const resetForm = () => {
    setName(ka.name)
    setType(ka.ka_type ?? 'retailer')
    setParentId(ka.parent_ka_id ?? '')
    setActive(ka.is_active)
    setNotes(ka.notes ?? '')
  }

  const handleSave = () => {
    startTransition(async () => {
      const result = await adminUpdateKa({
        id: ka.id,
        name,
        ka_type: type as any,
        parent_ka_id: parentId === '' ? null : parentId,
        is_active: active,
        notes,
      })
      if (!result.ok) {
        onError(result.error)
        return
      }
      onSuccess(`${name} updated`)
      setEditing(false)
      router.refresh()
    })
  }

  if (editing) {
    return (
      <div className={`flex-1 my-1 border ${style.border} rounded-lg p-3 bg-gray-50 space-y-2`}>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-gray-500 block">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block">Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white">
              <option value="distributor">📦 FD (distributor)</option>
              <option value="group">🏢 Group</option>
              <option value="retailer">🛒 Retailer</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block">Parent (供货来源)</label>
            <select value={parentId} onChange={e => setParentId(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white">
              <option value="">— Direct（无 parent）—</option>
              {parentOptions.filter(p => p.id !== ka.id).map(p => (
                <option key={p.id} value={p.id}>
                  {(TYPE_STYLE[p.ka_type ?? 'retailer'] ?? TYPE_STYLE.retailer).emoji} {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block">Notes / Tips</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-y" />
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
                    : `有数据无法硬删：${refs.forecast_cells} fcst · ${refs.shipments} ship · ${refs.psi_rows} PSI · ${refs.children} 下游 KA — 请改用停用`
              }
              className="px-2.5 py-1 text-xs text-red-700 hover:bg-red-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              🗑 Delete
            </button>
            {refs !== null && !canDelete && (
              <span className="text-[10px] text-gray-400">
                {refs.shipments} ship · {refs.psi_rows} PSI · {refs.forecast_cells} fcst{refs.children > 0 ? ` · ${refs.children} 下游` : ''}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setEditing(false) }}
              className="px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200 rounded">
              Cancel
            </button>
            <button onClick={handleSave} disabled={isPending || !name.trim()}
              className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex-1 my-1 flex items-center gap-2 border ${style.border} rounded-xl px-3 py-2 ${
      ka.is_active ? 'bg-white' : 'bg-gray-50'
    } hover:bg-[#fafafa] hover:shadow-sm transition group`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ka.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
        title={ka.is_active ? 'Active' : 'Inactive'} />
      <span className={`font-medium text-sm truncate ${ka.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
        {ka.name}
      </span>
      <Badge type={ka.ka_type ?? 'retailer'} />
      {ka.notes && (
        <span className="text-gray-400 hover:text-gray-700 cursor-help text-xs flex-shrink-0" title={ka.notes}>
          ⓘ
        </span>
      )}
      <span className="ml-auto text-[11px] text-gray-400 flex-shrink-0 tabular-nums">
        {ship > 0 && <span className="mr-2">🚚 {ship}</span>}
        {psi > 0 && <span>📊 {psi}</span>}
      </span>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-black/[0.06] rounded-md transition flex-shrink-0"
      >
        Edit
      </button>
    </div>
  )
}
