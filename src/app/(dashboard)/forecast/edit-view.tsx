'use client'

import { useMemo, useState, useRef, useEffect, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils'
import { RunControls } from './run-controls'
import { ManageChannelsModal } from './manage-channels-modal'

type Run = { id: number; code: string; period_start: string; period_end: string; status: string; month_count?: number }
type Country = { id: number; code: string; name_en: string; flag_emoji: string; sort_order: number }
type Ka = {
  id: number
  name: string
  country_id: number
  parent_ka_id: number | null
  ka_type?: string | null
  sort_order: number
  is_active?: boolean
  notes?: string | null
}
type Sku = { id: number; code: string; name: string; category: string | null; sort_order: number; lifecycle: string }
type Cell = { run_id: number; sku_id: number; ka_id: number; month: string; qty: number; source?: string | null; updated_by: string | null; updated_at: string }

type CellKey = string  // `${sku_id}|${ka_id}|${YYYY-MM-01}`
const cellKey = (sku_id: number, ka_id: number, monthIso: string) => `${sku_id}|${ka_id}|${monthIso}`

export function ForecastEditView({
  runs, selectedRun, allCountries, initialCountryCode,
  allKas, allSkus, allCells,
  editorNameMap,
  poByCountrySku, soByKaSku,
  fdStockByKaSku, hqStockByKaSku,
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
  // Σ PO: shipment 出货 (country × sku 维度, 跨 KA 不细分)
  poByCountrySku: Record<number, Record<number, number>>
  // Σ SO: PSI 按 ka 类型 (ka × sku, retailer=SO / distributor=ST)
  soByKaSku: Record<number, Record<number, number>>
  // FD/HQ Stock（by ka × sku）
  fdStockByKaSku: Record<number, Record<number, number>>
  hqStockByKaSku: Record<number, Record<number, number>>
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

  // —— 按当前国家 + active 派生 kas / cells（in-memory filter，<1ms）——
  //  ⚠️ allKas 现在包含 inactive（给 Manage Channels modal 用），主表格仅展示 active
  const kas = useMemo(
    // group 节点（如 Eurotel）是结构层，不是动销终端，不进 forecast 表格
    () => allKas.filter(k => k.country_id === selectedCountry.id && k.is_active !== false && k.ka_type !== 'group'),
    [allKas, selectedCountry.id]
  )
  // Modal 用：当前国家所有 KA（含 inactive）
  const allKasInCountry = useMemo(
    () => allKas.filter(k => k.country_id === selectedCountry.id),
    [allKas, selectedCountry.id]
  )
  const [manageChannelsOpen, setManageChannelsOpen] = useState(false)
  const kaIdSet = useMemo(() => new Set(kas.map(k => k.id)), [kas])
  const cells = useMemo(
    () => allCells.filter(c => kaIdSet.has(c.ka_id)),
    [allCells, kaIdSet]
  )
  // 注：rolling / FD / HQ stock 已按 ka_id 索引，国家切换无需重派生

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

  // —— 动态月数：新 cycle = 3, 历史 = 4 ——
  const monthCount = selectedRun.month_count ?? 4

  const monthsIso = useMemo(() => {
    const result: string[] = []
    const d = new Date(selectedRun.period_start)
    for (let i = 0; i < monthCount; i++) {
      const md = new Date(d); md.setMonth(d.getMonth() + i)
      result.push(`${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}-01`)
    }
    return result
  }, [selectedRun, monthCount])

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

  // —— rollover cells：上期自动带入、还没被人工确认的格子（淡灰显示）——
  // 人工编辑（dirty）即视为确认转黑；保存后服务端 source 清空，刷新后自然消失
  const rolloverKeys = useMemo(() => {
    const s = new Set<CellKey>()
    allCells.forEach((c: Cell) => {
      if (c.source === 'rollover') s.add(cellKey(c.sku_id, c.ka_id, c.month))
    })
    return s
  }, [allCells])

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
      showToast('error', `Save failed: ${error.message}`)
      return
    }
    showToast('success', `Saved ${data ?? payload.length} change${(data ?? payload.length) === 1 ? '' : 's'}`)
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
  const [hideZero, setHideZero] = useState(false)
  const visibleSkus = useMemo(() => {
    if (!hideZero) return allSkus
    return allSkus.filter(s => rowSubtotal(s.id) > 0)
  }, [allSkus, hideZero, cellQty])

  // —— Run status badge ——
  const statusBadge = (() => {
    const map: Record<string, { bg: string; label: string }> = {
      draft: { bg: 'bg-gray-100 text-gray-700', label: '📝 Draft' },
      submitted: { bg: 'bg-blue-100 text-blue-700', label: '📤 Submitted' },
      approved: { bg: 'bg-purple-100 text-purple-700', label: '✓ Approved' },
      published: { bg: 'bg-green-100 text-green-700', label: '🎉 Published (read-only)' },
      archived: { bg: 'bg-gray-100 text-gray-500', label: '📦 Archived' },
    }
    const s = map[selectedRun.status] ?? { bg: 'bg-gray-100', label: selectedRun.status }
    return <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${s.bg}`}>{s.label}</span>
  })()

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      {/* ⚙️ Manage Channels modal — 销售自助管理本国 KA */}
      <ManageChannelsModal
        open={manageChannelsOpen}
        onClose={() => setManageChannelsOpen(false)}
        country={selectedCountry}
        allKas={allKasInCountry}
        viewerName={viewerName}
      />

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
            📈 Demand Forecast
            <span className="text-base text-gray-500 ml-2 font-normal">· Sales input view</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {viewerIsAdmin
              ? <>Signed in as <span className="text-purple-600 font-medium">🌍 Admin ({viewerName})</span> · in input mode · <Link href="/forecast?view=summary" prefetch className="text-purple-600 underline hover:text-purple-700">Switch back to summary</Link></>
              : <>Signed in as <span className="text-blue-600 font-medium">🧑‍💼 Sales ({viewerName})</span> · you can only fill KAs in your assigned countries</>}
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
          <label className="text-sm text-gray-600 font-medium">📅 Forecast cycle:</label>
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
          <label className="text-sm text-gray-600 font-medium ml-2">🌍 Country:</label>
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
                Switching cycle…
              </span>
            )}
          </div>

        </div>

        {/* 提示信息 */}
        <div className="mt-2 text-xs text-gray-500">
          💡 Filling for <span className="text-blue-600 font-medium">{selectedCountry.flag_emoji} {selectedCountry.name_en}</span>
          · <strong>{kas.length}</strong> KAs × <strong>{allSkus.length}</strong> SKUs × <strong>{monthsIso.length}</strong> months
          {editLockedForAll && <span className="text-red-500 ml-2">⚠️ This cycle is published / archived — editing locked</span>}
        </div>
      </div>

      {/* KPI — 列数动态：1 个总 KPI + monthCount 个月 KPI */}
      <div className={`grid grid-cols-2 gap-3 mb-4`} style={{ gridTemplateColumns: `repeat(${1 + monthCount}, minmax(0, 1fr))` }}>
        <KpiCard label={`${selectedCountry.flag_emoji} ${selectedCountry.code} ${monthCount}-month total`} value={fmtNum(grandTotal)} hint={`${kas.length} KAs × ${visibleSkus.length} SKUs`} big />
        {monthsYm.map((ym, i) => {
          let monthTotal = 0
          kas.forEach(ka => { monthTotal += colSubtotal(ka.id, monthsIso[i]) })
          return <KpiCard key={ym} label={ym} value={fmtNum(monthTotal)} hint={monthLabels[i]} color="blue" />
        })}
      </div>

      {/* 主表 wrapper：工具栏 + 表格滚动区 */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* 工具栏 — 删 LY/YTD peek 按钮（被左列 SI/SO 取代）*/}
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 bg-gray-50 border-b border-gray-200">
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
            Hide empty SKUs
          </label>

          <span className="ml-3 text-xs text-gray-500">
            <span className="inline-block w-2 h-2 rounded-sm bg-violet-200 mr-1 align-middle"></span>PO / <span className="inline-block w-2 h-2 rounded-sm bg-emerald-200 mr-1 ml-1 align-middle"></span>SO ref = past 3 complete months avg
          </span>

          {rolloverKeys.size > 0 && (
            <span className="ml-3 text-xs text-gray-500">
              <span className="text-gray-400 font-medium">gray numbers</span> = rolled over from previous cycle, edit to confirm
            </span>
          )}

          {/* ⚙️ 管理渠道 — 销售自助新增/停用本国 KA。挪到 Save 旁边，主表格附近显眼 */}
          <button
            onClick={() => setManageChannelsOpen(true)}
            className="ml-auto px-3 py-1.5 rounded-md text-sm font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 hover:border-blue-400 transition flex items-center gap-1.5"
            title="Add, edit, or deactivate channels in this country"
          >
            <span>⚙️</span>
            <span>Manage channels</span>
            <span className="text-xs text-gray-400">({kas.length})</span>
          </button>

          <button
            onClick={handleSave}
            disabled={saving || dirtyKeys.size === 0 || editLockedForAll}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
              dirtyKeys.size > 0
                ? 'bg-green-600 text-white hover:bg-green-700 shadow'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : dirtyKeys.size > 0 ? `💾 Save (${dirtyKeys.size} change${dirtyKeys.size === 1 ? '' : 's'})` : 'Saved'}
          </button>
        </div>

        {/* 表格滚动区 */}
        <div className="overflow-auto max-h-[700px]">
          <table className="text-sm border-collapse" style={{ minWidth: 1400 }}>
            <thead>
              {/* row 1: 分组表头（KA × N · SUB-TOTAL · TOTAL block）*/}
              <tr className="bg-gray-50">
                <th className="sticky left-0 top-0 bg-gray-50 z-30 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r border-gray-200"
                    rowSpan={2} style={{ minWidth: 90, maxWidth: 90 }}>SKU</th>
                <th className="sticky top-0 bg-gray-50 z-30 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r-2 border-gray-300"
                    rowSpan={2}
                    style={{ left: 90, minWidth: 200, maxWidth: 200, boxShadow: '6px 0 8px -4px rgba(91, 33, 182, 0.18)' }}>Product</th>
                {kas.map(ka => (
                  <th key={ka.id}
                      className="sticky top-0 z-20 px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r-2 border-gray-300 bg-blue-100 text-blue-700"
                      colSpan={monthsIso.length}>
                    {ka.name}
                  </th>
                ))}
                <th className="sticky top-0 z-20 px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r-2 border-gray-300 bg-gray-100 text-gray-700"
                    colSpan={1 + monthsIso.length}>
                  Sub-total
                </th>
                <th className="sticky top-0 z-20 px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r border-gray-300 bg-amber-100 text-amber-800"
                    colSpan={3}>
                  Total · Stock
                </th>
              </tr>
              {/* row 2: 子标签 — KA 下"Ref / 月份"，SUB-TOTAL 下"月份"，TOTAL block 下"Total/FD/HQ" */}
              <tr className="bg-gray-50">
                {kas.map(ka => (
                  monthsIso.map((m, i) => (
                    <th key={`${ka.id}-${m}`}
                        className={`sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-gray-600 border-b border-gray-200 bg-blue-50 ${i === monthsIso.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'}`}
                        style={{ top: 36 }}>
                      {monthLabels[i]}
                    </th>
                  ))
                ))}
                {/* SUB-TOTAL 区：Σ PO/SO 总览 + 各月 */}
                <th className="sticky z-20 px-2 py-1.5 text-center text-[10px] font-medium text-gray-500 border-b border-r border-gray-200 bg-slate-50"
                    style={{ top: 36, minWidth: 56 }}>
                  <div className="text-violet-600">Σ PO</div>
                  <div className="text-emerald-600">Σ SO</div>
                  <div className="text-[9px] text-gray-400 mt-0.5">all KAs</div>
                </th>
                {monthsIso.map((m, i) => (
                  <th key={`subtot-${m}`}
                      className={`sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-gray-600 border-b border-gray-200 bg-gray-50 ${i === monthsIso.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'}`}
                      style={{ top: 36 }}>
                    {monthLabels[i]}
                  </th>
                ))}
                {/* TOTAL block 3 列 */}
                <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" style={{ top: 36 }}>
                  Total
                </th>
                <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" style={{ top: 36 }} title="Stock from FD (channel distributor)">
                  Stock-FD
                </th>
                <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" style={{ top: 36 }} title="Stock from HQ (INIU warehouse)">
                  Stock-HQ
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleSkus.map(sku => {
                const subTotal = rowSubtotal(sku.id)
                // Σ PO: shipment 出货 — country × sku 级（不细分 KA, 因为出货跨 KA 汇总同义）
                const poTotal = poByCountrySku[selectedCountry.id]?.[sku.id] ?? 0
                // Σ SO: 跨所有 KA 求和（每个 KA 按类型已经选 SO 或 ST）
                let soTotal = 0
                let fdTotal = 0
                let hqTotal = 0
                kas.forEach(ka => {
                  soTotal += soByKaSku[ka.id]?.[sku.id] ?? 0
                  fdTotal += fdStockByKaSku[ka.id]?.[sku.id] ?? 0
                  hqTotal += hqStockByKaSku[ka.id]?.[sku.id] ?? 0
                })
                return (
                  <tr key={sku.id} className="hover:bg-gray-50 group">
                    <td className="sticky left-0 bg-white group-hover:bg-gray-50 z-10 px-3 py-1.5 font-mono text-xs font-bold text-gray-900 border-b border-r border-gray-100" style={{ minWidth: 90, maxWidth: 90 }}>
                      {sku.code}
                    </td>
                    <td className="sticky bg-white group-hover:bg-gray-50 z-10 px-3 py-1.5 text-xs text-gray-600 border-b border-r-2 border-gray-300" style={{ left: 90, minWidth: 200, maxWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.35', boxShadow: '6px 0 8px -4px rgba(91, 33, 182, 0.18)' }}>
                      {sku.name}
                    </td>
                    {kas.map(ka => (
                      monthsIso.map((m, i) => {
                        const key = cellKey(sku.id, ka.id, m)
                        const value = cellQty[key] ?? 0
                        const dirty = dirtyKeys.has(key)
                        const isLast = i === monthsIso.length - 1
                        return (
                          <td key={key} className={`px-1 py-1 text-right border-b border-gray-100 ${isLast ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'} ${dirty ? 'bg-yellow-50' : ''}`}>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={value === 0 ? '' : String(value)}
                              onChange={(e) => updateCell(sku.id, ka.id, m, e.target.value)}
                              placeholder="0"
                              disabled={editLockedForAll}
                              className={`w-full text-xs text-right tabular-nums bg-transparent focus:bg-white focus:ring-2 focus:ring-blue-300 rounded px-1 py-1 outline-none ${
                                value > 0
                                  ? (rolloverKeys.has(key) && !dirty ? 'text-gray-400' : 'text-gray-900 font-medium')
                                  : 'text-gray-300'
                              } ${editLockedForAll ? 'cursor-not-allowed' : ''}`}
                            />
                          </td>
                        )
                      })
                    ))}
                    {/* SUB-TOTAL 区：Σ PO/SO 总览 + 各月 */}
                    <td className="px-1 py-0 text-right border-b border-r border-gray-200 bg-slate-100/70 align-middle"
                        style={{ minWidth: 56 }}>
                      <div className="text-[10px] tabular-nums leading-tight border-b border-violet-100 py-0.5 px-1 text-violet-700 font-semibold">
                        {poTotal > 0 ? Math.round(poTotal) : <span className="text-gray-300">-</span>}
                      </div>
                      <div className="text-[10px] tabular-nums leading-tight py-0.5 px-1 text-emerald-700 font-semibold">
                        {soTotal > 0 ? Math.round(soTotal) : <span className="text-gray-300">-</span>}
                      </div>
                    </td>
                    {monthsIso.map((m, i) => {
                      let monthSubtotal = 0
                      kas.forEach(ka => { monthSubtotal += cellQty[cellKey(sku.id, ka.id, m)] ?? 0 })
                      const isLast = i === monthsIso.length - 1
                      return (
                        <td key={`subtot-${sku.id}-${m}`}
                            className={`px-2 py-1.5 text-right text-xs tabular-nums font-semibold bg-gray-100 text-gray-800 border-b border-gray-200 ${isLast ? 'border-r-2 border-gray-300' : 'border-r border-gray-200'}`}>
                          {monthSubtotal > 0 ? fmtNum(monthSubtotal) : <span className="text-gray-300">-</span>}
                        </td>
                      )
                    })}
                    {/* TOTAL block */}
                    <td className="px-2 py-1.5 text-right text-sm tabular-nums font-bold bg-amber-50 text-amber-900 border-b border-r border-amber-200">
                      {subTotal > 0 ? fmtNum(subTotal) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums bg-amber-50/60 text-gray-700 border-b border-r border-amber-200">
                      {fdTotal > 0 ? fmtNum(fdTotal) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums bg-amber-50/60 text-gray-700 border-b border-r border-amber-200">
                      {hqTotal > 0 ? fmtNum(hqTotal) : <span className="text-gray-300" title="HQ stock data not yet imported">-</span>}
                    </td>
                  </tr>
                )
              })}
              {!visibleSkus.length && (
                <tr>
                  <td colSpan={2 + kas.length * monthsIso.length + 1 + monthsIso.length + 3} className="py-16 text-center text-gray-400">
                    {hideZero ? 'No SKUs filled yet · uncheck "Hide empty SKUs" to see all' : 'No KAs / SKUs available for this country'}
                  </td>
                </tr>
              )}
            </tbody>
            {visibleSkus.length > 0 && (
              <tfoot>
                <tr>
                  <td className="sticky left-0 bg-gray-100 text-gray-700 z-10 px-3 py-2.5 text-xs font-bold uppercase border-r border-t-2 border-gray-300" style={{ minWidth: 90, maxWidth: 90 }}>TTL</td>
                  <td className="sticky bg-gray-100 text-gray-700 z-10 px-3 py-2.5 text-xs font-medium border-r-2 border-t-2 border-gray-300" style={{ left: 90, minWidth: 200, maxWidth: 200 }}>
                    All SKUs total
                  </td>
                  {kas.map(ka => (
                    monthsIso.map((m, i) => (
                      <td key={`ft-${ka.id}-${m}`}
                          className={`px-1 py-2 text-right text-xs font-bold tabular-nums bg-blue-50 text-blue-900 border-t-2 border-gray-300 ${i === monthsIso.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-r-blue-200'}`}>
                        {fmtNum(colSubtotal(ka.id, m))}
                      </td>
                    ))
                  ))}
                  {/* SUB-TOTAL 区底行：Σ PO (shipment) / Σ SO (跨 KA) + 各月汇总 */}
                  {(() => {
                    let poGrand = 0
                    let soGrand = 0
                    allSkus.forEach(s => {
                      poGrand += poByCountrySku[selectedCountry.id]?.[s.id] ?? 0
                    })
                    kas.forEach(ka => allSkus.forEach(s => {
                      soGrand += soByKaSku[ka.id]?.[s.id] ?? 0
                    }))
                    return (
                      <td className="px-1 py-0 text-right border-r border-t-2 border-gray-300 bg-slate-200/70 align-middle" style={{ minWidth: 56 }}>
                        <div className="text-[10px] tabular-nums leading-tight border-b border-violet-200 py-0.5 px-1 text-violet-800 font-bold">
                          {poGrand > 0 ? fmtNum(Math.round(poGrand)) : '-'}
                        </div>
                        <div className="text-[10px] tabular-nums leading-tight py-0.5 px-1 text-emerald-800 font-bold">
                          {soGrand > 0 ? fmtNum(Math.round(soGrand)) : '-'}
                        </div>
                      </td>
                    )
                  })()}
                  {monthsIso.map((m, i) => {
                    let total = 0
                    kas.forEach(ka => { total += colSubtotal(ka.id, m) })
                    return (
                      <td key={`ft-subtot-${m}`}
                          className={`px-2 py-2 text-right text-xs font-bold tabular-nums bg-gray-200 text-gray-900 border-t-2 border-gray-300 ${i === monthsIso.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-r-gray-300'}`}>
                        {fmtNum(total)}
                      </td>
                    )
                  })}
                  {/* TOTAL block 底行 */}
                  <td className="px-2 py-2 text-right text-sm font-bold tabular-nums bg-amber-100 text-amber-900 border-r border-t-2 border-amber-300">
                    {fmtNum(grandTotal)}
                  </td>
                  <td className="px-2 py-2 text-right text-xs font-bold tabular-nums bg-amber-50 text-gray-700 border-r border-t-2 border-amber-300">
                    {(() => {
                      let total = 0
                      kas.forEach(ka => allSkus.forEach(s => { total += fdStockByKaSku[ka.id]?.[s.id] ?? 0 }))
                      return total > 0 ? fmtNum(total) : '-'
                    })()}
                  </td>
                  <td className="px-2 py-2 text-right text-xs font-bold tabular-nums bg-amber-50 text-gray-700 border-r border-t-2 border-amber-300">
                    {(() => {
                      let total = 0
                      kas.forEach(ka => allSkus.forEach(s => { total += hqStockByKaSku[ka.id]?.[s.id] ?? 0 }))
                      return total > 0 ? fmtNum(total) : '-'
                    })()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 调试提示 */}
      <div className="mt-4 text-xs text-gray-400 text-center">
        💡 Edited cells show yellow until saved · click Save or press <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px]">⌘/Ctrl + S</kbd> ·
        PO (shipment) / SO (PSI) ref = avg of past 3 complete months (excl. current) · You'll be warned before leaving with unsaved changes ·
        Writes are RLS-protected — out-of-scope writes are auto-rejected
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
