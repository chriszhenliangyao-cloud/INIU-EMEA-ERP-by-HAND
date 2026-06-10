'use client'

/**
 * Manage Channels Modal — 销售自助管理本国渠道（KA）
 *
 * 功能：
 *  - 列出当前国家的所有 active KA，可编辑名字/类型/sort_order，可停用
 *  - 顶部「+ Add new channel」按钮
 *  - 底部折叠区显示 inactive KA：可 Reactivate / Delete permanently（仅无引用时）
 *  - 关闭 modal 自动 router.refresh() 让父页面更新 KA 列表
 */

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  createKA,
  updateKA,
  deactivateKA,
  reactivateKA,
  deleteKAPermanently,
  getKAReferenceCount,
} from './_actions/manage-ka'

type Ka = {
  id: number
  name: string
  country_id: number
  ka_type?: string | null
  parent_ka_id: number | null
  sort_order: number
  is_active?: boolean
  notes?: string | null
}

type Country = {
  id: number
  code: string
  name_en: string
  flag_emoji: string
}

type Props = {
  open: boolean
  onClose: () => void
  country: Country
  allKas: Ka[]   // 当前国家所有 KA（包含 inactive）
  viewerName: string
}

export function ManageChannelsModal({ open, onClose, country, allKas, viewerName }: Props) {
  const router = useRouter()
  const [showInactive, setShowInactive] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error' | 'info'; msg: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 关闭时自动刷新父页面
  const handleClose = () => {
    router.refresh()
    onClose()
  }

  const flash = (kind: 'success' | 'error' | 'info', msg: string) => {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), kind === 'error' ? 4000 : 2000)
  }

  const activeKas = allKas.filter(k => k.is_active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const inactiveKas = allKas.filter(k => !k.is_active).sort((a, b) => a.name.localeCompare(b.name))

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              ⚙️ Manage Channels — {country.flag_emoji} {country.name_en}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Signed in as <span className="font-medium">{viewerName}</span> · All changes are audit-logged
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className={`mx-6 mt-3 px-3 py-2 rounded-md text-sm border ${
            toast.kind === 'success' ? 'bg-green-50 text-green-700 border-green-300' :
            toast.kind === 'error'   ? 'bg-red-50 text-red-700 border-red-300' :
                                       'bg-blue-50 text-blue-700 border-blue-300'
          }`}>
            <span className="mr-2">{toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '⚠️' : 'ℹ️'}</span>
            {toast.msg}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Add new */}
          <AddChannelForm
            countryId={country.id}
            parentOptions={activeKas.filter(k => k.ka_type === 'distributor' || k.ka_type === 'group')}
            onSuccess={() => flash('success', 'Channel added')}
            onError={(msg) => flash('error', msg)}
          />

          {/* Active list */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Active channels ({activeKas.length})</h3>
            </div>
            {activeKas.length === 0 ? (
              <div className="text-sm text-gray-500 italic py-4 text-center bg-gray-50 rounded">
                No active channels yet. Add one above to start filling forecast.
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg divide-y">
                {activeKas.map(ka => (
                  <KaRow
                    key={ka.id}
                    ka={ka}
                    parentOptions={activeKas.filter(k => (k.ka_type === 'distributor' || k.ka_type === 'group') && k.id !== ka.id)}
                    onChange={() => flash('success', 'Channel updated')}
                    onError={(msg) => flash('error', msg)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Inactive list */}
          {inactiveKas.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowInactive(!showInactive)}
                className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
              >
                <span>{showInactive ? '▼' : '▶'}</span>
                Show inactive ({inactiveKas.length})
              </button>
              {showInactive && (
                <div className="mt-2 border border-gray-200 rounded-lg divide-y opacity-80">
                  {inactiveKas.map(ka => (
                    <InactiveKaRow
                      key={ka.id}
                      ka={ka}
                      onSuccess={(msg) => flash('success', msg)}
                      onError={(msg) => flash('error', msg)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-3 bg-gray-50 rounded-b-2xl flex justify-between items-center">
          <span className="text-xs text-gray-500">
            💡 Deactivated channels keep history but hide from forecast/PSI/shipment views
          </span>
          <button
            onClick={handleClose}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────
// Add form
// ───────────────────────────────────────
function AddChannelForm({ countryId, parentOptions, onSuccess, onError }: {
  countryId: number
  parentOptions: Ka[]
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<'retailer' | 'distributor'>('retailer')
  const [parentId, setParentId] = useState<number | ''>('')
  const [isPending, startTransition] = useTransition()

  const reset = () => {
    setName('')
    setType('retailer')
    setParentId('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      const result = await createKA({
        country_id: countryId,
        name: name.trim(),
        ka_type: type,
        parent_ka_id: type === 'retailer' && parentId !== '' ? parentId : null,
      })
      if (!result.ok) {
        onError(result.error)
        return
      }
      onSuccess()
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium rounded-lg border border-blue-200 border-dashed text-sm"
      >
        + Add new channel
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50/50 border border-blue-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">New channel</h4>
        <button type="button" onClick={() => { reset(); setOpen(false) }} className="text-gray-400 hover:text-gray-700 text-lg">×</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-600 block mb-1">Name <span className="text-red-500">*</span></label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Carrefour"
            autoFocus
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
            maxLength={100}
            required
          />
        </div>
        <div>
          <label className="text-xs text-gray-600 block mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
          >
            <option value="retailer">🛒 Retailer</option>
            <option value="distributor">📦 Distributor</option>
          </select>
        </div>
      </div>

      {type === 'retailer' && (
        <div>
          <label className="text-xs text-gray-600 block mb-1">
            Parent distributor / group <span className="text-gray-400">(optional, leave blank if direct)</span>
          </label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
          >
            <option value="">— Direct (no parent) —</option>
            {parentOptions.map(p => (
              <option key={p.id} value={p.id}>
                {p.ka_type === 'group' ? '🏢' : '📦'} {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !name.trim()}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? 'Adding…' : 'Add channel'}
        </button>
      </div>
    </form>
  )
}

// ───────────────────────────────────────
// Active KA row (with inline edit)
// ───────────────────────────────────────
function KaRow({ ka, parentOptions, onChange, onError }: {
  ka: Ka
  parentOptions: Ka[]
  onChange: () => void
  onError: (msg: string) => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(ka.name)
  const [type, setType] = useState<'retailer' | 'distributor'>((ka.ka_type ?? 'retailer') as any)
  const [parentId, setParentId] = useState<number | ''>(ka.parent_ka_id ?? '')
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateKA({
        id: ka.id,
        name,
        ka_type: type,
        parent_ka_id: type === 'retailer' && parentId !== '' ? parentId : null,
      })
      if (!result.ok) {
        onError(result.error)
        return
      }
      onChange()
      setEditing(false)
      router.refresh()
    })
  }

  const handleDeactivate = () => {
    if (!confirm(`Deactivate "${ka.name}"? Its historical forecast/PSI/shipment data will stay, but it will be hidden from dashboards. You can reactivate later.`)) return
    startTransition(async () => {
      const result = await deactivateKA(ka.id)
      if (!result.ok) {
        onError(result.error)
        return
      }
      onChange()
      router.refresh()
    })
  }

  if (editing) {
    return (
      <div className="p-3 bg-blue-50/40 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
            placeholder="Channel name"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            className="px-2 py-1 border border-gray-300 rounded text-sm bg-white"
          >
            <option value="retailer">🛒 Retailer</option>
            <option value="distributor">📦 Distributor</option>
          </select>
          {type === 'retailer' && (
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value === '' ? '' : Number(e.target.value))}
              className="px-2 py-1 border border-gray-300 rounded text-sm bg-white"
            >
              <option value="">— Direct (no parent) —</option>
              {parentOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.ka_type === 'group' ? '🏢' : '📦'} {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => { setName(ka.name); setType((ka.ka_type ?? 'retailer') as any); setParentId(ka.parent_ka_id ?? ''); setEditing(false) }}
            className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || !name.trim()}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  const parentName = ka.parent_ka_id != null
    ? parentOptions.find(p => p.id === ka.parent_ka_id)?.name ?? null
    : null

  return (
    <div className="px-3 py-2 flex items-center gap-2 hover:bg-gray-50">
      <span className="text-base">{ka.ka_type === 'distributor' ? '📦' : ka.ka_type === 'group' ? '🏢' : '🛒'}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-gray-900 truncate">{ka.name}</div>
        {parentName && (
          <div className="text-xs text-gray-500">via {parentName}</div>
        )}
      </div>
      <button
        onClick={() => setEditing(true)}
        className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded"
      >
        Edit
      </button>
      <button
        onClick={handleDeactivate}
        disabled={isPending}
        className="px-2 py-1 text-xs text-orange-700 hover:bg-orange-100 rounded disabled:opacity-50"
      >
        Deactivate
      </button>
    </div>
  )
}

// ───────────────────────────────────────
// Inactive KA row
// ───────────────────────────────────────
function InactiveKaRow({ ka, onSuccess, onError }: {
  ka: Ka
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [refs, setRefs] = useState<{ forecast_cells: number; shipments: number; psi_rows: number } | null>(null)
  const [checkedRefs, setCheckedRefs] = useState(false)

  useEffect(() => {
    if (!checkedRefs) {
      getKAReferenceCount(ka.id).then(r => { setRefs(r); setCheckedRefs(true) })
    }
  }, [ka.id, checkedRefs])

  const hasHistory = refs ? (refs.forecast_cells + refs.shipments + refs.psi_rows) > 0 : true

  const handleReactivate = () => {
    startTransition(async () => {
      const result = await reactivateKA(ka.id)
      if (!result.ok) { onError(result.error); return }
      onSuccess(`${ka.name} reactivated`)
      router.refresh()
    })
  }

  const handleDelete = () => {
    if (!confirm(`Permanently delete "${ka.name}"? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteKAPermanently(ka.id)
      if (!result.ok) { onError(result.error); return }
      onSuccess(`${ka.name} deleted permanently`)
      router.refresh()
    })
  }

  return (
    <div className="px-3 py-2 flex items-center gap-2 hover:bg-gray-50">
      <span className="text-base grayscale">{ka.ka_type === 'distributor' ? '📦' : '🛒'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-600 line-through truncate">{ka.name}</div>
        <div className="text-[10px] text-gray-400">
          {checkedRefs
            ? `${refs?.forecast_cells ?? 0} fcst · ${refs?.shipments ?? 0} ship · ${refs?.psi_rows ?? 0} PSI`
            : 'checking refs…'}
        </div>
      </div>
      <button
        onClick={handleReactivate}
        disabled={isPending}
        className="px-2 py-1 text-xs text-green-700 hover:bg-green-100 rounded disabled:opacity-50"
      >
        Reactivate
      </button>
      <button
        onClick={handleDelete}
        disabled={isPending || hasHistory}
        title={hasHistory ? 'Has historical data — cannot permanently delete' : 'Permanently delete'}
        className="px-2 py-1 text-xs text-red-700 hover:bg-red-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Delete
      </button>
    </div>
  )
}
