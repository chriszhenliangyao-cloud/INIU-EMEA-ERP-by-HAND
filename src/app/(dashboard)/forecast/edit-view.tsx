'use client'

import { useMemo, useState, useRef, useEffect, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils'
import { RunControls } from './run-controls'

type Run = { id: number; code: string; period_start: string; period_end: string; status: string }
type Country = { id: number; code: string; name_zh: string; flag_emoji: string; sort_order: number }
type Ka = { id: number; name: string; country_id: number; parent_distributor: string | null; tier: string; sort_order: number }
type Sku = { id: number; code: string; name: string; category: string | null; sort_order: number; lifecycle: string }
type Cell = { run_id: number; sku_id: number; ka_id: number; month: string; qty: number; updated_by: string | null; updated_at: string }

type CellKey = string  // `${sku_id}|${ka_id}|${YYYY-MM-01}`
const cellKey = (sku_id: number, ka_id: number, monthIso: string) => `${sku_id}|${ka_id}|${monthIso}`

type PeekMode = null | 'ly' | 'ytd'

export function ForecastEditView({
  runs, selectedRun, allCountries, initialCountryCode,
  allKas, allSkus, allCells,
  editorNameMap,
  lyByCountrySku, ytdByCountrySku, ytdMonthsCount,
  viewerIsAdmin, viewerName,
}: {
  runs: Run[]
  selectedRun: Run
  allCountries: Country[]
  initialCountryCode: string
  allKas: Ka[]
  allSkus: Sku[]
  allCells: Cell[]
  editorNameMap: Record<string, string>
  lyByCountrySku: Record<number, Record<string, Record<string, number>>>
  ytdByCountrySku: Record<number, Record<string, number>>
  ytdMonthsCount: number
  viewerIsAdmin: boolean
  viewerName: string
}) {
  const router = useRouter()
  const supabase = useRef(createClient()).current

  // —— 🚀 国家选择改为纯客户端 state：切国家 0 网络请求 ——
  const [selectedCountryCode, setSelectedCountryCode] = useState<string>(initialCountryCode)
  const selectedCountry = useMemo(
    () => allCountries.find(c => c.code === selectedCountryCode) ?? allCountries[0],
    [selectedCountryCode, allCountries]
  )

  // —— 按当前国家派生 kas / cells / lyBySku / ytdAvgBySku（in-memory filter，<1ms）——
  const kas = useMemo(
    () => allKas.filter(k => k.country_id === selectedCountry.id),
    [allKas, selectedCountry.id]
  )
  const kaIdSet = useMemo(() => new Set(kas.map(k => k.id)), [kas])
  const cells = useMemo(
    () => allCells.filter(c => kaIdSet.has(c.ka_id)),
    [allCells, kaIdSet]
  )
  const lyBySku = useMemo(
    () => lyByCountrySku[selectedCountry.id] ?? {},
    [lyByCountrySku, selectedCountry.id]
  )
  const ytdAvgBySku = useMemo(
    () => ytdByCountrySku[selectedCountry.id] ?? {},
    [ytdByCountrySku, selectedCountry.id]
  )

  // —— 切国家（纯客户端 + URL 同步，不触发 server fetch）——
  const switchCountry = useCallback((code: string) => {
    if (code === selectedCountryCode) return
    setSelectedCountryCode(code)
    // 用 history.replaceState 静默同步 URL，避免 router.push 触发 server component 重跑
    const url = new URL(window.location.href)
    url.searchParams.set('country', code)
    window.history.replaceState({}, '', url.toString())
  }, [selectedCountryCode])

  // —— Run 切换仍走 server route（因为换 run 数据全变了，预拉数据失效）——
  const [isPending, startTransition] = useTransition()
  const navigateRun = (runId: string) => {
    startTransition(() => {
      router.push(`/forecast?view=edit&run=${runId}&country=${selectedCountryCode}`)
    })
  }

  // —— 计算 4 个月（YYYY-MM-01 / YYYY-MM 双格式）——
  const monthsIso = useMemo(() => {
    const result: string[] = []
    const d = new Date(selectedRun.period_start)
    for (let i = 0; i < 4; i++) {
      const md = new Date(d); md.setMonth(d.getMonth() + i)
      result.push(`${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}-01`)
    }
    return result
  }, [selectedRun])

  const monthsYm = monthsIso.map(m => m.slice(0, 7))
  const monthLabels = monthsIso.map(m => {
    const moNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const mo = Number(m.slice(5, 7))
    return moNames[mo - 1]
  })

  // —— 工具函数：从服务端 cells 构造 cellQty map ——
  const buildQtyMap = (rows: Cell[]) => {
    const m: Record<CellKey, number> = {}
    rows.forEach(c => { m[cellKey(c.sku_id, c.ka_id, c.month)] = c.qty })
    return m
  }

  // —— 本地状态：cellQty[key] = qty 当前值（含未保存的）——
  // ⚠️ 多国家共享一份 map：因为 cellKey 包含 ka_id（唯一），不同国家的 KA 不会冲突
  const [cellQty, setCellQty] = useState<Record<CellKey, number>>(() => buildQtyMap(allCells))

  // —— dirty cells（修改过未保存的）——
  const [dirtyKeys, setDirtyKeys] = useState<Set<CellKey>>(new Set())
  const [saving, setSaving] = useState(false)
  const [peekMode, setPeekMode] = useState<PeekMode>(null)

  // —— Toast 通知（替代 alert）——
  type Toast = { kind: 'success' | 'error' | 'info'; msg: string; id: number }
  const [toast, setToast] = useState<Toast | null>(null)
  const showToast = useCallback((kind: Toast['kind'], msg: string) => {
    const id = Date.now()
    setToast({ kind, msg, id })
    setTimeout(() => setToast(prev => (prev?.id === id ? null : prev)), kind === 'error' ? 5000 : 2500)
  }, [])

  // —— 当服务端 allCells 变化（保存后 router.refresh / 切 run）→ 重置本地 state ——
  // 国家切换不在此处重置，因为 cellQty 跨国家共享（cellKey 含 ka_id，天然唯一）
  useEffect(() => {
    setCellQty(buildQtyMap(allCells))
    setDirtyKeys(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCells, selectedRun.id])

  const editLocked = selectedRun.status !== 'draft' && !viewerIsAdmin
  const editLockedForAll = selectedRun.status === 'published' || selectedRun.status === 'archived'

  // —— 修改单元格 ——
  const updateCell = (sku_id: number, ka_id: number, monthIso: string, value: string) => {
    const numStr = value.replace(/[^\d]/g, '')
    const num = numStr ? parseInt(numStr) : 0
    const key = cellKey(sku_id, ka_id, monthIso)
    setCellQty(prev => ({ ...prev, [key]: num }))
    setDirtyKeys(prev => new Set(prev).add(key))
  }

  // —— 保存 ——
  // 把最新的 dirtyKeys / cellQty / saving 通过 ref 暴露给 keydown handler，避免每次重新绑事件
  const stateRef = useRef({ dirtyKeys, cellQty, saving, runId: selectedRun.id, locked: false })
  stateRef.current = { dirtyKeys, cellQty, saving, runId: selectedRun.id, locked: editLockedForAll }

  const handleSave = useCallback(async () => {
    const { dirtyKeys: dk, cellQty: cq, saving: sv, runId, locked } = stateRef.current
    if (sv || dk.size === 0 || locked) return
    setSaving(true)
    const payload = Array.from(dk).map(key => {
      const [sku_id, ka_id, month] = key.split('|')
      return { sku_id: Number(sku_id), ka_id: Number(ka_id), month, qty: cq[key] ?? 0 }
    })
    const { error, data } = await supabase.rpc('upsert_forecast_cells', {
      p_run_id: runId,
      p_cells: payload,
    })
    setSaving(false)
    if (error) {
      showToast('error', `保存失败：${error.message}`)
      return
    }
    showToast('success', `已保存 ${data ?? payload.length} 个改动`)
    setDirtyKeys(new Set())  // 立即清掉，避免双击保存
    router.refresh()  // 触发服务端重新拉 cells；useEffect 监听到后会重置 cellQty 为新值
  }, [supabase, router, showToast])

  // —— 全局 Ctrl/Cmd + S 触发保存 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave])

  // —— 离开页面前提醒未保存 ——
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyKeys.size > 0) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyKeys.size])

  // —— SKU 行小计（合计该 SKU 在所有 KA × 4 月的总量）——
  const rowSubtotal = (sku_id: number) => {
    let total = 0
    kas.forEach(ka => {
      monthsIso.forEach(m => {
        total += cellQty[cellKey(sku_id, ka.id, m)] ?? 0
      })
    })
    return total
  }

  // —— 各列底部小计（特定 KA × 特定月份所有 SKU 之和）——
  const colSubtotal = (ka_id: number, monthIso: string) => {
    let total = 0
    allSkus.forEach(sku => {
      total += cellQty[cellKey(sku.id, ka_id, monthIso)] ?? 0
    })
    return total
  }
  const grandTotal = useMemo(() => {
    let t = 0
    kas.forEach(ka => monthsIso.forEach(m => { t += colSubtotal(ka.id, m) }))
    return t
  }, [cellQty, kas, monthsIso])

  // —— 隐藏空白 SKU ——
  const [hideZero, setHideZero] = useState(true)
  const visibleSkus = useMemo(() => {
    if (!hideZero) return allSkus
    return allSkus.filter(s => rowSubtotal(s.id) > 0)
  }, [allSkus, hideZero, cellQty])

  // —— Run status badge ——
  const statusBadge = (() => {
    const map: Record<string, { bg: string; label: string }> = {
      draft: { bg: 'bg-gray-100 text-gray-700', label: '📝 草稿' },
      submitted: { bg: 'bg-blue-100 text-blue-700', label: '📤 已提交' },
      approved: { bg: 'bg-purple-100 text-purple-700', label: '✓ 已审批' },
      published: { bg: 'bg-green-100 text-green-700', label: '🎉 已发布（只读）' },
      archived: { bg: 'bg-gray-100 text-gray-500', label: '📦 已归档' },
    }
    const s = map[selectedRun.status] ?? { bg: 'bg-gray-100', label: selectedRun.status }
    return <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${s.bg}`}>{s.label}</span>
  })()

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      {/* Toast 通知（fixed top-center） */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div
            className={`pointer-events-auto px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium border flex items-center gap-2 animate-fade-in ${
              toast.kind === 'success' ? 'bg-green-50 text-green-700 border-green-300' :
              toast.kind === 'error'   ? 'bg-red-50 text-red-700 border-red-300' :
                                         'bg-blue-50 text-blue-700 border-blue-300'
            }`}
            role="status" aria-live="polite"
          >
            <span>{toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span>{toast.msg}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      )}

      {/* 页头 */}
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            📈 需求预测
            <span className="text-base text-gray-500 ml-2 font-normal">· 销售填表视图</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {viewerIsAdmin
              ? <>当前以 <span className="text-purple-600 font-medium">🌍 Admin（{viewerName}）</span> 身份进入填表视图 · <Link href="/forecast?view=summary" prefetch className="text-purple-600 underline hover:text-purple-700">切回汇总视图</Link></>
              : <>当前以 <span className="text-blue-600 font-medium">🧑‍💼 Sales（{viewerName}）</span> 身份填写 · 仅可填写你负责国家的 KA</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {statusBadge}
          <RunControls
            selectedRun={selectedRun}
            allRuns={runs}
            viewerIsAdmin={viewerIsAdmin}
            hasUnsaved={dirtyKeys.size > 0}
          />
        </div>
      </div>

      {/* 选择器栏 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Run 选择（换 run 仍走 server route：4 个月数据完全变了）*/}
          <label className="text-sm text-gray-600 font-medium">📅 预测周期：</label>
          <select
            value={selectedRun.id}
            onChange={(e) => navigateRun(e.target.value)}
            disabled={isPending}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium disabled:opacity-60"
          >
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {r.code} · {r.period_start.slice(0, 7)} ~ {r.period_end.slice(0, 7)} · {r.status}
              </option>
            ))}
          </select>

          {/* 国家选择（纯客户端切换：0 RTT，瞬时响应）*/}
          <label className="text-sm text-gray-600 font-medium ml-2">🌍 国家：</label>
          <div className="flex gap-1.5 flex-wrap">
            {allCountries.map(c => {
              const isActive = c.code === selectedCountry.code
              return (
                <button
                  key={c.code}
                  onClick={() => switchCountry(c.code)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600 shadow'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  {c.flag_emoji} {c.code}
                </button>
              )
            })}
            {isPending && (
              <span className="ml-2 self-center text-xs text-gray-500 flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                切换周期…
              </span>
            )}
          </div>

          {/* 隐藏空白 SKU */}
          <label className="ml-auto flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
            隐藏空白 SKU
          </label>

          {/* Hover peek 按钮 */}
          <div className="flex gap-0 rounded-lg overflow-hidden border border-gray-300">
            <button
              onMouseEnter={() => setPeekMode('ly')}
              onMouseLeave={() => setPeekMode(null)}
              onFocus={() => setPeekMode('ly')}
              onBlur={() => setPeekMode(null)}
              className={`px-3 py-1.5 text-sm font-medium border-r border-gray-300 transition ${
                peekMode === 'ly' ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-purple-50'
              }`}
            >
              👻 去年同期
            </button>
            <button
              onMouseEnter={() => setPeekMode('ytd')}
              onMouseLeave={() => setPeekMode(null)}
              onFocus={() => setPeekMode('ytd')}
              onBlur={() => setPeekMode(null)}
              className={`px-3 py-1.5 text-sm font-medium transition ${
                peekMode === 'ytd' ? 'bg-cyan-600 text-white' : 'bg-white text-gray-700 hover:bg-cyan-50'
              }`}
            >
              📊 今年月均
            </button>
          </div>

          {/* 保存按钮 */}
          <button
            onClick={handleSave}
            disabled={saving || dirtyKeys.size === 0 || editLockedForAll}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
              dirtyKeys.size > 0
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saving ? '保存中...' : dirtyKeys.size > 0 ? `💾 保存 (${dirtyKeys.size} 个改动)` : '已保存'}
          </button>
        </div>

        {/* 提示信息 */}
        <div className="mt-2 text-xs text-gray-500">
          💡 在 <span className="text-blue-600 font-medium">{selectedCountry.flag_emoji} {selectedCountry.name_zh}</span> 填表
          · 共 <strong>{kas.length}</strong> 个 KA × <strong>{allSkus.length}</strong> 个 SKU × <strong>{monthsIso.length}</strong> 个月
          {editLockedForAll && <span className="text-red-500 ml-2">⚠️ 本期已发布/归档，禁止编辑</span>}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label={`${selectedCountry.flag_emoji} ${selectedCountry.code} 4个月合计`} value={fmtNum(grandTotal)} hint={`${kas.length} KA × ${visibleSkus.length} SKU`} big />
        {monthsYm.map((ym, i) => {
          let monthTotal = 0
          kas.forEach(ka => { monthTotal += colSubtotal(ka.id, monthsIso[i]) })
          return <KpiCard key={ym} label={ym} value={fmtNum(monthTotal)} hint={monthLabels[i]} color="blue" />
        })}
      </div>

      {/* 主表 */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[700px]">
          <table className="text-sm border-collapse" style={{ minWidth: 1200 }}>
            <thead>
              <tr className="bg-gray-50">
                <th className="sticky left-0 bg-gray-50 z-20 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r border-gray-200"
                    rowSpan={2} style={{ minWidth: 90, maxWidth: 90 }}>SKU</th>
                <th className="sticky bg-gray-50 z-20 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r-2 border-gray-300"
                    rowSpan={2}
                    style={{ left: 90, minWidth: 200, maxWidth: 200, boxShadow: '6px 0 8px -4px rgba(91, 33, 182, 0.18)' }}>产品名称</th>
                {kas.map((ka, ki) => (
                  <th key={ka.id} className="px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r-2 border-gray-300 bg-blue-100 text-blue-700" colSpan={monthsIso.length}>
                    {ka.name}
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r border-gray-300 bg-gray-900 text-white" rowSpan={2}>
                  Sub-total<br /><span className="text-[10px] font-normal opacity-80">(4 个月)</span>
                </th>
              </tr>
              <tr className="bg-gray-50">
                {kas.map(ka => (
                  monthsIso.map((m, i) => (
                    <th key={`${ka.id}-${m}`} className={`px-2 py-1.5 text-center text-[11px] font-medium text-gray-600 border-b border-gray-200 bg-blue-50 ${i === monthsIso.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'}`}>
                      {monthLabels[i]}
                    </th>
                  ))
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleSkus.map(sku => {
                const subTotal = rowSubtotal(sku.id)
                const lyTotal = monthsYm.reduce((s, ym) => s + ((lyBySku[sku.code] ?? {})[ym] ?? 0), 0)
                const ytd = ytdAvgBySku[sku.code] ?? 0
                return (
                  <tr key={sku.id} className="hover:bg-gray-50 group">
                    <td className="sticky left-0 bg-white group-hover:bg-gray-50 z-10 px-3 py-1.5 font-mono text-xs font-bold text-gray-900 border-b border-r border-gray-100" style={{ minWidth: 90, maxWidth: 90 }}>
                      {sku.code}
                      {peekMode === 'ly' && lyTotal > 0 && (
                        <div className="text-[10px] text-purple-500 font-normal mt-0.5">LY {fmtNum(lyTotal)}</div>
                      )}
                      {peekMode === 'ytd' && ytd > 0 && (
                        <div className="text-[10px] text-cyan-500 font-normal mt-0.5">YTD月均 {fmtNum(ytd)}</div>
                      )}
                    </td>
                    <td className="sticky bg-white group-hover:bg-gray-50 z-10 px-3 py-1.5 text-xs text-gray-600 border-b border-r-2 border-gray-300" style={{ left: 90, minWidth: 200, maxWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.35', boxShadow: '6px 0 8px -4px rgba(91, 33, 182, 0.18)' }}>
                      {sku.name}
                    </td>
                    {kas.map(ka => (
                      monthsIso.map((m, i) => {
                        const key = cellKey(sku.id, ka.id, m)
                        const value = cellQty[key] ?? 0
                        const dirty = dirtyKeys.has(key)
                        const lyVal = (lyBySku[sku.code] ?? {})[monthsYm[i]] ?? 0
                        const isLast = i === monthsIso.length - 1
                        return (
                          <td key={key} className={`px-1 py-1 text-right border-b border-gray-100 ${isLast ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'} ${dirty ? 'bg-yellow-50' : ''} relative`}>
                            {/* hover peek overlay */}
                            {peekMode === 'ly' && lyVal > 0 && (
                              <div className="absolute inset-0 flex items-center justify-center bg-purple-100 text-purple-700 font-medium text-xs pointer-events-none">
                                {fmtNum(lyVal)}
                              </div>
                            )}
                            {peekMode === 'ytd' && ytd > 0 && (
                              <div className="absolute inset-0 flex items-center justify-center bg-cyan-100 text-cyan-700 font-medium text-xs pointer-events-none">
                                {fmtNum(ytd)}
                              </div>
                            )}
                            <input
                              type="text"
                              inputMode="numeric"
                              value={value === 0 ? '' : String(value)}
                              onChange={(e) => updateCell(sku.id, ka.id, m, e.target.value)}
                              placeholder="0"
                              disabled={editLockedForAll}
                              className={`w-full text-xs text-right tabular-nums bg-transparent focus:bg-white focus:ring-2 focus:ring-blue-300 rounded px-1 py-1 outline-none ${value > 0 ? 'text-gray-900 font-medium' : 'text-gray-300'} ${editLockedForAll ? 'cursor-not-allowed' : ''}`}
                            />
                          </td>
                        )
                      })
                    ))}
                    {/* Sub-total */}
                    <td className="px-3 py-1.5 text-right text-sm tabular-nums font-bold bg-gray-900 text-white border-b border-gray-700">
                      {subTotal > 0 ? fmtNum(subTotal) : '-'}
                    </td>
                  </tr>
                )
              })}
              {!visibleSkus.length && (
                <tr>
                  <td colSpan={3 + kas.length * monthsIso.length + 1} className="py-16 text-center text-gray-400">
                    {hideZero ? '所有 SKU 都还没填写 · 取消"隐藏空白 SKU"查看全部' : '该国家暂无可填的 KA / SKU'}
                  </td>
                </tr>
              )}
            </tbody>
            {visibleSkus.length > 0 && (
              <tfoot>
                <tr>
                  <td className="sticky left-0 bg-gray-900 text-white z-10 px-3 py-2.5 text-xs font-bold uppercase border-r" style={{ minWidth: 90, maxWidth: 90 }}>TTL</td>
                  <td className="sticky bg-gray-900 text-white z-10 px-3 py-2.5 text-xs font-medium border-r-2 border-gray-700" style={{ left: 90, minWidth: 200, maxWidth: 200 }}>
                    所有 SKU 合计
                  </td>
                  {kas.map(ka => (
                    monthsIso.map((m, i) => (
                      <td key={`ft-${ka.id}-${m}`} className={`px-1 py-2 text-right text-xs font-bold tabular-nums text-white bg-blue-700 ${i === monthsIso.length - 1 ? 'border-r-2 border-blue-500' : 'border-r border-blue-600'}`}>
                        {fmtNum(colSubtotal(ka.id, m))}
                      </td>
                    ))
                  ))}
                  <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white bg-black">
                    {fmtNum(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 调试提示 */}
      <div className="mt-4 text-xs text-gray-400 text-center">
        💡 修改后单元格背景变黄表示未保存 · 点保存按钮 或 <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px]">⌘/Ctrl + S</kbd> 提交 ·
        悬停"去年同期/今年月均"按钮查看历史参考 · 离开未保存改动会提醒 ·
        所有数据写入受 RLS 保护，越权写自动拒绝
      </div>
    </div>
  )
}

function KpiCard({ label, value, hint, color, big }: { label: string; value: string; hint?: string; color?: string; big?: boolean }) {
  const cMap: Record<string, string> = { blue: 'text-blue-600', amber: 'text-amber-600', purple: 'text-purple-600', green: 'text-green-600' }
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 ${big ? 'ring-2 ring-blue-200' : ''}`}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ? cMap[color] : 'text-gray-900'} tabular-nums`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  )
}
