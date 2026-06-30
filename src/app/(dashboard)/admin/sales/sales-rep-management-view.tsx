'use client'

/**
 * Sales Rep Master Data 管理 UI
 *
 * - 表格：Name / Email / Role / Auth status / Countries (chips) / Hired / Status / Actions
 * - 顶部：search + role filter + status filter + Add 按钮
 * - Add/Edit Drawer：基本信息 + role（super_admin 才能改）+ 初始国家分配
 * - 国家管理：每个 chip 有 × 解除，顶部 + 加国家
 * - Mark as left (含日期) / Reactivate（不自动恢复国家）
 */

import { useState, useMemo, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  createSalesRep, updateSalesRep, changeSalesRepRole,
  assignRepCountry, unassignRepCountry,
  markRepLeft, reactivateSalesRep,
} from './_actions/manage-sales-rep'
import type { SalesRepInput } from './_actions/manage-sales-rep'

// 彩蛋徽章（按 email 挂，Chris 钦定 2026-06-10）
const FUN_BADGES: Record<string, { emoji: string; label: string; cls: string }> = {
  'jiwen.wang@iniushop.com': { emoji: '👑', label: 'Majesty', cls: 'bg-amber-50 text-amber-700 border-amber-300' },
  'julio.pu@iniushop.com':   { emoji: '🍞', label: 'Carbohydrate Killer', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
}

type Rep = {
  id: number
  user_id: string | null
  display_name: string
  email: string
  role: 'admin' | 'sales'
  is_active: boolean
  is_super_admin: boolean
  hired_at: string | null
  left_at: string | null
  locale: string
  notes: string | null
  last_login_at: string | null
  created_at: string
  updated_at: string
}

type Country = {
  id: number
  code: string
  name_en: string
  flag_emoji: string
  region: string
  is_active: boolean
}

type Assignment = {
  sales_rep_id: number
  country_id: number
  is_primary: boolean
  valid_from: string
  valid_to: string | null
}

type Toast = { kind: 'success' | 'error' | 'info'; msg: string; id: number }

export function SalesRepManagementView({
  allReps, allCountries, allAssignments, viewerName, viewerIsSuperAdmin,
}: {
  allReps: Rep[]
  allCountries: Country[]
  allAssignments: Assignment[]
  viewerName: string
  viewerIsSuperAdmin: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'sales'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [addOpen, setAddOpen] = useState(false)
  const [editingRep, setEditingRep] = useState<Rep | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [isPending, startTransition] = useTransition()

  const flash = (kind: Toast['kind'], msg: string) => {
    const id = Date.now()
    setToast({ kind, msg, id })
    setTimeout(() => setToast(prev => prev?.id === id ? null : prev), kind === 'error' ? 5000 : 2500)
  }

  // 每个 rep 的当前 active 国家
  const activeAssignmentsByRep = useMemo(() => {
    const m: Record<number, Assignment[]> = {}
    allAssignments.forEach(a => {
      if (a.valid_to !== null) return
      if (!m[a.sales_rep_id]) m[a.sales_rep_id] = []
      m[a.sales_rep_id].push(a)
    })
    return m
  }, [allAssignments])

  const countryById = useMemo(() => {
    const m: Record<number, Country> = {}
    allCountries.forEach(c => { m[c.id] = c })
    return m
  }, [allCountries])

  const filteredReps = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allReps.filter(r => {
      if (roleFilter !== 'all' && r.role !== roleFilter) return false
      if (statusFilter === 'active' && !r.is_active) return false
      if (statusFilter === 'inactive' && r.is_active) return false
      if (q && !`${r.display_name} ${r.email}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [allReps, search, roleFilter, statusFilter])

  const activeCount = useMemo(() => allReps.filter(r => r.is_active).length, [allReps])

  // ── Actions ──
  const onMarkLeft = (rep: Rep) => {
    const date = prompt(`Mark "${rep.display_name}" as left. Enter leave date (YYYY-MM-DD), or leave blank for today:`)
    if (date === null) return // cancel
    const leaveDate = date.trim() || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) {
      flash('error', 'Invalid date format, use YYYY-MM-DD')
      return
    }
    startTransition(async () => {
      const r = await markRepLeft(rep.id, leaveDate)
      if (!r.ok) flash('error', r.error)
      else { flash('success', `${rep.display_name} marked as left on ${leaveDate}`); router.refresh() }
    })
  }

  const onReactivate = (rep: Rep) => {
    if (!confirm(`Reactivate ${rep.display_name}? Note: country assignments are NOT automatically restored — you'll need to re-assign them.`)) return
    startTransition(async () => {
      const r = await reactivateSalesRep(rep.id)
      if (!r.ok) flash('error', r.error)
      else { flash('success', `${rep.display_name} reactivated`); router.refresh() }
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
            👤 Sales Rep Master Data
            <span className="text-base text-gray-500 ml-2 font-normal">· Admin only</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Signed in as <span className="text-purple-600 font-medium">🌍 {viewerName}{viewerIsSuperAdmin && ' (Super)'}</span>
            {' · '}<span className="text-green-600 font-medium">{activeCount} active</span> of {allReps.length}
            {viewerIsSuperAdmin
              ? ' · You can change roles'
              : ' · Role changes require super_admin'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/sku" className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md">→ SKU Master Data</Link>
          <Link href="/forecast" className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md">← Back</Link>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl p-4 mb-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / email…"
            className="w-full pl-9 pr-3 py-2 bg-gray-500/[0.08] rounded-xl text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)} className="px-3 py-2 bg-gray-500/[0.08] rounded-xl text-sm outline-none cursor-pointer hover:bg-gray-500/[0.12] transition">
          <option value="all">All roles</option>
          <option value="admin">Admin only</option>
          <option value="sales">Sales only</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="px-3 py-2 bg-gray-500/[0.08] rounded-xl text-sm outline-none cursor-pointer hover:bg-gray-500/[0.12] transition">
          <option value="active">✓ Active</option>
          <option value="inactive">⊘ Inactive</option>
          <option value="all">All status</option>
        </select>
        <div className="text-xs text-gray-500 ml-auto">
          Showing <strong>{filteredReps.length}</strong> of {allReps.length}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl shadow-sm hover:bg-blue-700 active:scale-[0.98] transition flex items-center gap-1.5"
        >
          <span>+</span> Add sales rep
        </button>
      </div>

      {/* 表格 */}
      <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl overflow-hidden">
        <div className="overflow-auto max-h-[750px]">
          <table className="w-full text-sm border-collapse" style={{ minWidth: 1100 }}>
            <thead>
              <tr className="bg-white">
                {[
                  ['Name', 'left'], ['Email', 'left'], ['Role', 'center'],
                  ['Auth', 'center'], ['Countries', 'left'], ['Hired', 'left'],
                  ['Status', 'center'], ['Actions', 'right'],
                ].map(([h, align]) => (
                  <th key={h} className={`sticky top-0 bg-white z-10 px-3 py-2.5 text-${align} text-[11px] font-medium text-gray-400 border-b border-black/[0.06]`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredReps.length === 0 && (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">No sales reps match the filters</td></tr>
              )}
              {filteredReps.map(rep => {
                const assignments = activeAssignmentsByRep[rep.id] ?? []
                return (
                  <tr key={rep.id} className={`hover:bg-[#f5f5f7] transition-colors ${!rep.is_active ? 'opacity-55' : ''}`}>
                    <td className="px-3 py-2.5 font-medium text-gray-900 border-b border-black/[0.05]">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold ${rep.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                          {rep.display_name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <span>{rep.display_name}</span>
                        {rep.is_super_admin && <span title="Super admin" className="text-yellow-500">⭐</span>}
                        {FUN_BADGES[rep.email] && (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${FUN_BADGES[rep.email].cls}`}>
                            {FUN_BADGES[rep.email].emoji} {FUN_BADGES[rep.email].label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 border-b border-black/[0.05]">{rep.email}</td>
                    <td className="px-3 py-2 text-center border-b border-black/[0.05]">
                      <span className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-medium ${rep.role === 'admin' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                        {rep.role}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center border-b border-black/[0.05]">
                      {rep.user_id
                        ? <span title={`Last login: ${rep.last_login_at ?? '-'}`} className="text-green-600 text-base">✓</span>
                        : <span title="Not logged in yet" className="text-orange-500 text-base">⚠</span>}
                    </td>
                    <td className="px-3 py-2 border-b border-black/[0.05]">
                      {assignments.length === 0 ? (
                        <span className="text-gray-300 text-xs">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {assignments.map(a => {
                            const c = countryById[a.country_id]
                            if (!c) return null
                            return (
                              <span key={a.country_id} title={a.is_primary ? 'Primary' : 'Secondary'}
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${a.is_primary ? 'bg-blue-50 text-blue-600 border-blue-300' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                                {c.flag_emoji} {c.code}{a.is_primary && '★'}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 border-b border-black/[0.05]">
                      {rep.hired_at ?? '-'}
                      {rep.left_at && <span className="block text-red-500 text-[10px]">Left {rep.left_at}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center border-b border-black/[0.05]">
                      <button
                        onClick={() => rep.is_active ? onMarkLeft(rep) : onReactivate(rep)}
                        disabled={isPending || (rep.is_active && rep.is_super_admin)}
                        title={rep.is_super_admin && rep.is_active ? 'Cannot mark super_admin as left from UI' : (rep.is_active ? 'Active — click to mark left' : 'Inactive — click to reactivate')}
                        className={`relative inline-flex h-[22px] w-[38px] items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${rep.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${rep.is_active ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right border-b border-black/[0.05] whitespace-nowrap">
                      <button onClick={() => setEditingRep(rep)} className="px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-black/[0.04] rounded-md transition">Edit</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add drawer */}
      <SalesRepFormDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="create"
        viewerIsSuperAdmin={viewerIsSuperAdmin}
        countries={allCountries.filter(c => c.is_active)}
        onSubmit={async (input) => {
          const r = await createSalesRep(input as SalesRepInput)
          if (!r.ok) { flash('error', r.error); return false }
          flash('success', `${input.display_name} added`)
          router.refresh()
          return true
        }}
      />

      {/* Edit drawer */}
      {editingRep && (
        <SalesRepFormDrawer
          open
          onClose={() => setEditingRep(null)}
          mode="edit"
          viewerIsSuperAdmin={viewerIsSuperAdmin}
          countries={allCountries.filter(c => c.is_active)}
          initial={editingRep}
          activeAssignments={activeAssignmentsByRep[editingRep.id] ?? []}
          onSubmit={async (input) => {
            const r = await updateSalesRep(editingRep.id, input)
            if (!r.ok) { flash('error', r.error); return false }
            flash('success', `${input.display_name ?? editingRep.display_name} updated`)
            router.refresh()
            return true
          }}
          onRoleChange={async (newRole) => {
            const r = await changeSalesRepRole(editingRep.id, newRole)
            if (!r.ok) { flash('error', r.error); return }
            flash('success', `Role changed to ${newRole}`)
            router.refresh()
          }}
          onAssignCountry={async (countryId, isPrimary) => {
            const r = await assignRepCountry(editingRep.id, countryId, isPrimary)
            if (!r.ok) { flash('error', r.error); return }
            flash('success', 'Country assigned')
            router.refresh()
          }}
          onUnassignCountry={async (countryId) => {
            if (!confirm('Remove this country assignment? History is preserved.')) return
            const r = await unassignRepCountry(editingRep.id, countryId)
            if (!r.ok) { flash('error', r.error); return }
            flash('success', 'Country removed')
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────
// Drawer form
// ────────────────────────────────────────────
function SalesRepFormDrawer({
  open, onClose, mode, initial, viewerIsSuperAdmin, countries,
  activeAssignments = [], onSubmit, onRoleChange, onAssignCountry, onUnassignCountry,
}: {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  initial?: Rep
  viewerIsSuperAdmin: boolean
  countries: Country[]
  activeAssignments?: Assignment[]
  onSubmit: (input: Partial<SalesRepInput>) => Promise<boolean>
  onRoleChange?: (newRole: 'admin' | 'sales') => Promise<void>
  onAssignCountry?: (countryId: number, isPrimary: boolean) => Promise<void>
  onUnassignCountry?: (countryId: number) => Promise<void>
}) {
  const [form, setForm] = useState<Partial<SalesRepInput>>(() => normalize(initial))
  const [addCountryId, setAddCountryId] = useState<number | ''>('')
  const [addPrimary, setAddPrimary] = useState(false)
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

  const setField = <K extends keyof SalesRepInput>(k: K, v: SalesRepInput[K]) => setForm(prev => ({ ...prev, [k]: v }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const ok = await onSubmit(form)
      if (ok) onClose()
    })
  }

  const assignedCountryIds = new Set(activeAssignments.map(a => a.country_id))
  const availableCountries = countries.filter(c => !assignedCountryIds.has(c.id))

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <form onSubmit={handleSubmit} className="bg-white w-full max-w-xl h-full flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            {mode === 'create' ? '+ Add sales rep' : `Edit · ${initial?.display_name}`}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Basic info */}
          <Section title="Basic">
            <Field label="Display name" required>
              <input value={form.display_name ?? ''} onChange={(e) => setField('display_name', e.target.value)} required maxLength={100} className={inputCls} placeholder="e.g. Marie Dupont" />
            </Field>
            <Field label="Email" required>
              <input type="email" value={form.email ?? ''} onChange={(e) => setField('email', e.target.value)} required maxLength={200} className={inputCls} placeholder="marie.dupont@iniushop.com" disabled={mode === 'edit'} />
              {mode === 'edit' && <div className="text-[11px] text-gray-500 mt-1">Email is locked once created (used for SSO auto-link)</div>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hired date">
                <input type="date" value={form.hired_at ?? ''} onChange={(e) => setField('hired_at', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Locale">
                <select value={form.locale ?? 'en-US'} onChange={(e) => setField('locale', e.target.value)} className={inputCls}>
                  <option value="en-US">English (US)</option>
                  <option value="zh-CN">中文 (简体)</option>
                  <option value="fr-FR">Français</option>
                  <option value="es-ES">Español</option>
                  <option value="pl-PL">Polski</option>
                </select>
              </Field>
            </div>
            <Field label="Notes">
              <textarea value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} rows={2} className={`${inputCls} resize-y`} />
            </Field>
          </Section>

          {/* Role */}
          <Section title="Role">
            {mode === 'create' ? (
              <Field label="Role" required>
                <select value={form.role ?? 'sales'} onChange={(e) => setField('role', e.target.value as any)} className={inputCls}>
                  <option value="sales">🧑‍💼 Sales</option>
                  <option value="admin">🌍 Admin</option>
                </select>
                {form.role === 'admin' && !viewerIsSuperAdmin && (
                  <div className="text-[11px] text-orange-600 mt-1">⚠ Only super_admin can create admin accounts</div>
                )}
              </Field>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-700">Current role: <strong>{initial?.role}</strong></span>
                {viewerIsSuperAdmin && initial && !initial.is_super_admin && (
                  <button
                    type="button"
                    onClick={() => onRoleChange?.(initial.role === 'admin' ? 'sales' : 'admin')}
                    className="px-3 py-1 text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100"
                  >
                    Change to {initial.role === 'admin' ? 'sales' : 'admin'}
                  </button>
                )}
                {!viewerIsSuperAdmin && (
                  <span className="text-[11px] text-gray-500">(super_admin required to change)</span>
                )}
              </div>
            )}
          </Section>

          {/* Countries — edit mode only */}
          {mode === 'edit' && initial && (
            <Section title="Active country assignments">
              {activeAssignments.length === 0 ? (
                <div className="text-xs text-gray-500 italic py-3 text-center bg-gray-50 rounded">No country assigned</div>
              ) : (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {activeAssignments.map(a => {
                    const c = countries.find(cc => cc.id === a.country_id)
                    if (!c) return null
                    return (
                      <span key={c.id} className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${a.is_primary ? 'bg-blue-50 text-blue-600 border-blue-300' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                        {c.flag_emoji} {c.code} {a.is_primary && '★'}
                        <button type="button" onClick={() => onUnassignCountry?.(c.id)} className="ml-1.5 text-red-500 hover:text-red-700 text-base leading-none" title="Remove">
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}

              {availableCountries.length > 0 && (
                <div className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200">
                  <select value={addCountryId} onChange={(e) => setAddCountryId(e.target.value === '' ? '' : Number(e.target.value))} className={`${inputCls} flex-1`}>
                    <option value="">Choose a country to add…</option>
                    {availableCountries.map(c => (
                      <option key={c.id} value={c.id}>{c.flag_emoji} {c.name_en}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
                    <input type="checkbox" checked={addPrimary} onChange={(e) => setAddPrimary(e.target.checked)} />
                    Primary
                  </label>
                  <button
                    type="button"
                    disabled={addCountryId === ''}
                    onClick={() => {
                      if (addCountryId === '') return
                      onAssignCountry?.(Number(addCountryId), addPrimary)
                      setAddCountryId('')
                      setAddPrimary(false)
                    }}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    + Add
                  </button>
                </div>
              )}
            </Section>
          )}
        </div>

        <div className="border-t px-5 py-3 bg-gray-50 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-md">Cancel</button>
          <button type="submit" disabled={isPending} className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50">
            {isPending ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save changes')}
          </button>
        </div>
      </form>
    </div>
  )
}

const inputCls = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 disabled:bg-gray-100 disabled:text-gray-500'

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

function normalize(r: Rep | undefined): Partial<SalesRepInput> {
  if (!r) {
    return { display_name: '', email: '', role: 'sales', locale: 'en-US', hired_at: null, notes: null }
  }
  return {
    display_name: r.display_name,
    email: r.email,
    role: r.role,
    locale: r.locale,
    hired_at: r.hired_at,
    notes: r.notes,
  }
}
