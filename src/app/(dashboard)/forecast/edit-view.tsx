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

// FD 分组：distributor（有在售子 retailer）渲染成跨列「大表头」，子 retailer 作输入列，FD 本身不输入。
// 例外（保持扁平、不动现状/不丢数据）：
//   ① 下列国家整国不启用分组，维持原来的扁平表头：
//      - ES：FD 数据结构特殊
//      - PL：Komsa 有真实的直发(FD 层)数据，硬分组会破坏数据准确性，按要求保持扁平
//   ② FD 在当前周期已有直接 forecast 数据 → 保持扁平叶子列，避免隐藏已填数据
const FD_GROUPING_DISABLED_COUNTRIES = new Set(['ES', 'PL'])
type ColGroup = { fd: Ka | null; leaves: Ka[] }
const byOrder = (a: Ka, b: Ka) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)

export function ForecastEditView({
  runs, selectedRun, allCountries, initialCountryCode,
  allKas, allSkus, allCells,
  editorNameMap,
  poByCountrySku, soByKaSku,
  fdStockByKaSku, hqCnStockBySku, hqOvsStockBySku,
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
  hqCnStockBySku: Record<number, number>   // HQ 国内库存（共享池，SKU 级）
  hqOvsStockBySku: Record<number, number>  // HQ 海外仓库存（共享池，SKU 级）
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
  //  group 节点（如 Eurotel）是结构层，不是动销终端，不进 forecast 表格
  //  kas = 实际输入列（叶子）；columnGroups = 表头分组结构（FD 大表头 + 其子列）
  const { kas, allCountryKas, columnGroups, hasGroups } = useMemo(() => {
    const countryKas = allKas.filter(
      k => k.country_id === selectedCountry.id && k.is_active !== false && k.ka_type !== 'group'
    )
    // 整国不启用分组（如 ES）→ 完全保持原有扁平顺序与行为
    if (FD_GROUPING_DISABLED_COUNTRIES.has(selectedCountry.code)) {
      return {
        kas: countryKas,
        allCountryKas: countryKas,
        columnGroups: countryKas.map(k => ({ fd: null, leaves: [k] })) as ColGroup[],
        hasGroups: false,
      }
    }
    const directCellKaIds = new Set(allCells.map(c => c.ka_id))  // 本周期已有数据的 KA → 保持扁平
    const childrenOf = (id: number) => countryKas.filter(k => k.parent_ka_id === id).sort(byOrder)
    const topLevel = countryKas.filter(k => k.parent_ka_id == null).sort(byOrder)

    const columnGroups: ColGroup[] = []
    for (const k of topLevel) {
      const kids = childrenOf(k.id)
      const isGroupedFd = k.ka_type === 'distributor' && kids.length > 0 && !directCellKaIds.has(k.id)
      if (isGroupedFd) {
        columnGroups.push({ fd: k, leaves: kids })  // FD 大表头 + 子 retailer 输入列
      } else {
        columnGroups.push({ fd: null, leaves: [k] })          // 叶子（独立 retailer / 无子 FD / 有数据的 FD）
        for (const c of kids) columnGroups.push({ fd: null, leaves: [c] })  // 罕见：未分组父的子也扁平列出
      }
    }
    // 兜底完整性：确保每个在售 KA 都出现一次。父节点是 group 类型（如 iDream 挂在 Eurotel 下）
    // 的 KA 既不是 top-level 也不是某 top-level 的直接子，会从上面漏掉 → 这里补成扁平叶子列，绝不丢列/丢数据。
    const fdIds = new Set(columnGroups.filter(g => g.fd).map(g => g.fd!.id))
    const leafIds = new Set(columnGroups.flatMap(g => g.leaves).map(l => l.id))
    for (const k of countryKas) {
      if (!leafIds.has(k.id) && !fdIds.has(k.id)) columnGroups.push({ fd: null, leaves: [k] })
    }
    return {
      kas: columnGroups.flatMap(g => g.leaves),
      allCountryKas: countryKas,
      columnGroups,
      hasGroups: columnGroups.some(g => g.fd != null),
    }
  }, [allKas, allCells, selectedCountry.id, selectedCountry.code])
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

  // —— dirty cells（改了还没落库的，失焦即存）+ 每格保存状态 + 已存基线 ——
  const [dirtyKeys, setDirtyKeys] = useState<Set<CellKey>>(new Set())
  const [saving, setSaving] = useState(false)
  const [cellStatus, setCellStatus] = useState<Record<CellKey, 'saving' | 'saved' | 'error'>>({})
  const savedQty = useRef<Record<CellKey, number>>(buildQtyMap(allCells))
  // 每格「停手即存」防抖计时器：输入停顿 AUTOSAVE_MS 后自动落库（失焦/回车仍立即存）
  const AUTOSAVE_MS = 400
  const saveTimers = useRef<Record<CellKey, ReturnType<typeof setTimeout>>>({})

  // 注：上期 rollover 预填值与人工值同等显示（销售要求：实体数据、免重复填报）
  // source 字段仅作为来源痕迹保留（admin 的 Forecast Activity 用它区分 人工/预填）

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
    savedQty.current = buildQtyMap(allCells)
    setCellStatus({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCells, selectedRun.id])

  // sales 在「非 draft」周期一律只读（提交审核后即冻结，只有 admin 仍可改）
  const editLocked = selectedRun.status !== 'draft' && !viewerIsAdmin
  // published / archived → 对所有人（含 admin）只读
  const editLockedForAll = selectedRun.status === 'published' || selectedRun.status === 'archived'
  // 输入框 / Save 的统一锁定判据
  const locked = editLocked || editLockedForAll

  // —— 修改单元格 ——
  const updateCell = (sku_id: number, ka_id: number, monthIso: string, value: string) => {
    const numStr = value.replace(/[^\d]/g, '')
    const num = numStr ? parseInt(numStr) : 0
    const key = cellKey(sku_id, ka_id, monthIso)
    setCellQty(prev => ({ ...prev, [key]: num }))
    setDirtyKeys(prev => new Set(prev).add(key))
    // 停手即存：每次输入重置该格计时器，停顿 AUTOSAVE_MS 后落库
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key])
    saveTimers.current[key] = setTimeout(() => { saveCell(sku_id, ka_id, monthIso) }, AUTOSAVE_MS)
  }

  // —— 保存 ——
  // 把最新的 dirtyKeys / cellQty / saving 通过 ref 暴露给 keydown handler，避免每次重新绑事件
  const stateRef = useRef({ dirtyKeys, cellQty, saving, runId: selectedRun.id, locked: false })
  stateRef.current = { dirtyKeys, cellQty, saving, runId: selectedRun.id, locked }

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

  // —— 单格即时保存（失焦/回车触发）：只提交这一格，审计触发器自动记日志；无变化则不保存 ——
  const saveCell = useCallback(async (sku_id: number, ka_id: number, monthIso: string) => {
    const key = cellKey(sku_id, ka_id, monthIso)
    if (saveTimers.current[key]) { clearTimeout(saveTimers.current[key]); delete saveTimers.current[key] }
    const { cellQty: cq, runId, locked } = stateRef.current
    if (locked) return
    const cur = cq[key] ?? 0
    const base = savedQty.current[key] ?? 0
    if (cur === base) return  // 值没变 → 不落库、不写日志
    setCellStatus(s => ({ ...s, [key]: 'saving' }))
    const { error } = await supabase.rpc('upsert_forecast_cells', {
      p_run_id: runId,
      p_cells: [{ sku_id, ka_id, month: monthIso, qty: cur }],
    })
    if (error) {
      setCellStatus(s => ({ ...s, [key]: 'error' }))
      showToast('error', `Save failed: ${error.message}`)
      return
    }
    savedQty.current[key] = cur
    setDirtyKeys(prev => { const n = new Set(prev); n.delete(key); return n })
    setCellStatus(s => ({ ...s, [key]: 'saved' }))
    setTimeout(() => setCellStatus(s => { if (s[key] !== 'saved') return s; const { [key]: _drop, ...rest } = s; return rest }), 1500)
  }, [supabase, showToast])

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

  // —— 卸载时清掉所有待触发的自动保存计时器，避免泄漏 ——
  useEffect(() => {
    const timers = saveTimers.current
    return () => { Object.values(timers).forEach(clearTimeout) }
  }, [])

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
          {editLockedForAll
            ? <span className="text-red-500 ml-2">⚠️ This cycle is published / archived — editing locked</span>
            : editLocked && <span className="text-red-500 ml-2">🔒 Submitted for review — editing locked. Contact HQ to make changes.</span>}
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


          {/* ⚙️ 管理渠道 — 销售自助新增/停用本国 KA。挪到 Save 旁边，主表格附近显眼 */}
          <button
            onClick={() => setManageChannelsOpen(true)}
            className="ml-auto px-3 py-1.5 rounded-md text-sm font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 hover:border-blue-400 transition flex items-center gap-1.5"
            title="Add, edit, or deactivate channels in this country"
          >
            <span>⚙️</span>
            <span>Manage channels</span>
            <span className="text-xs text-gray-400">({allKasInCountry.filter(k => k.is_active !== false && k.ka_type !== 'group').length})</span>
          </button>

          {locked ? (
            <span className="px-3 py-1.5 text-sm font-medium rounded-md bg-gray-100 text-gray-400">🔒 Read-only</span>
          ) : (() => {
            const busy = saving || Object.values(cellStatus).some(v => v === 'saving') || dirtyKeys.size > 0
            const err = Object.values(cellStatus).some(v => v === 'error')
            if (err) return (
              <button onClick={handleSave} className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition" title="Some cells failed to save — click to retry">
                ⚠️ Retry save
              </button>
            )
            return (
              <span className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 ${busy ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                {busy ? '⏳ Saving…' : '✓ Auto-save on'}
              </span>
            )
          })()}
        </div>

        {/* 表格滚动区 */}
        <div className="overflow-auto max-h-[700px]">
          <table className="text-sm border-collapse" style={{ minWidth: 1400 }}>
            <thead>
              {hasGroups ? (
                <>
                  {/* === 3 行表头：FD 大表头 / 子 retailer / 月份 === */}
                  {/* row 1: FD 分组大表头（独立 retailer 跨两行）*/}
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 top-0 bg-gray-50 z-30 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r border-gray-200"
                        rowSpan={3} style={{ minWidth: 90, maxWidth: 90 }}>SKU</th>
                    <th className="sticky top-0 bg-gray-50 z-30 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r-2 border-gray-300"
                        rowSpan={3}
                        style={{ left: 90, minWidth: 200, maxWidth: 200, boxShadow: '6px 0 8px -4px rgba(91, 33, 182, 0.18)' }}>Product</th>
                    {columnGroups.map((g, gi) => g.fd ? (
                      <th key={`fd-${g.fd.id}`}
                          className="sticky z-20 px-3 py-2 text-center text-xs font-bold uppercase border-b border-r-2 border-gray-300 bg-blue-100 text-blue-800"
                          style={{ top: 0 }}
                          colSpan={g.leaves.length * monthsIso.length}>
                        {g.fd.name} <span className="text-[9px] font-semibold text-blue-500 align-middle">FD</span>
                      </th>
                    ) : (
                      <th key={`top-${g.leaves[0].id}-${gi}`}
                          className="sticky z-20 px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r-2 border-gray-300 bg-blue-100 text-blue-700 align-middle"
                          style={{ top: 0 }}
                          rowSpan={2} colSpan={monthsIso.length}>
                        {g.leaves[0].name}
                      </th>
                    ))}
                    <th className="sticky z-20 px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r-2 border-gray-300 bg-gray-100 text-gray-700 align-middle"
                        style={{ top: 0 }} rowSpan={2} colSpan={1 + monthsIso.length}>
                      Sub-total
                    </th>
                    <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-bold uppercase text-amber-800 border-b border-r border-gray-200 bg-amber-100 align-middle" style={{ top: 0 }} rowSpan={3}>
                      Total
                    </th>
                    <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-bold uppercase text-amber-800 border-b border-r border-gray-200 bg-amber-100 align-middle" style={{ top: 0 }} rowSpan={3} title="Stock from FD (channel distributor)">
                      Stock-FD
                    </th>
                    <th className="sticky z-20 px-3 py-2 text-center text-xs font-bold uppercase border-b border-r border-gray-300 bg-amber-100 text-amber-800 align-middle" style={{ top: 0 }} rowSpan={2} colSpan={2}>
                      Stock-HQ
                    </th>
                  </tr>
                  {/* row 2: 子 retailer 名（FD 之下）*/}
                  <tr className="bg-gray-50">
                    {columnGroups.map(g => g.fd
                      ? g.leaves.map(leaf => (
                          <th key={`leaf-${leaf.id}`}
                              className="sticky z-20 px-3 py-1.5 text-center text-[11px] font-bold uppercase border-b border-r-2 border-gray-300 bg-blue-50 text-blue-700"
                              style={{ top: 36 }}
                              colSpan={monthsIso.length}>
                            {leaf.name}
                          </th>
                        ))
                      : null)}
                  </tr>
                  {/* row 3: 月份 + Σ PO/SO + Sub-total 月份 + Stock-HQ 子列 */}
                  <tr className="bg-gray-50">
                    {kas.map(ka => (
                      monthsIso.map((m, i) => (
                        <th key={`${ka.id}-${m}`}
                            className={`sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-gray-600 border-b border-gray-200 bg-blue-50 ${i === monthsIso.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'}`}
                            style={{ top: 72 }}>
                          {monthLabels[i]}
                        </th>
                      ))
                    ))}
                    <th className="sticky z-20 px-2 py-1.5 text-center text-[10px] font-medium text-gray-500 border-b border-r border-gray-200 bg-slate-50"
                        style={{ top: 72, minWidth: 56 }}>
                      <div className="text-violet-600">Σ PO</div>
                      <div className="text-emerald-600">Σ SO</div>
                      <div className="text-[9px] text-gray-400 mt-0.5">all KAs</div>
                    </th>
                    {monthsIso.map((m, i) => (
                      <th key={`subtot-${m}`}
                          className={`sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-gray-600 border-b border-gray-200 bg-gray-50 ${i === monthsIso.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'}`}
                          style={{ top: 72 }}>
                        {monthLabels[i]}
                      </th>
                    ))}
                    <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" style={{ top: 72 }} title="HQ 国内库存 (domestic warehouse)">
                      CN
                    </th>
                    <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" style={{ top: 72 }} title="HQ 海外仓库存 (overseas warehouse)">
                      Oversea
                    </th>
                  </tr>
                </>
              ) : (
                <>
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
                    {/* TOTAL block：Total / Stock-FD 占双行，Stock-HQ 分组下挂 CN / Oversea */}
                    <th className="sticky top-0 z-20 px-2 py-1.5 text-center text-[11px] font-bold uppercase text-amber-800 border-b border-r border-gray-200 bg-amber-100 align-middle" rowSpan={2}>
                      Total
                    </th>
                    <th className="sticky top-0 z-20 px-2 py-1.5 text-center text-[11px] font-bold uppercase text-amber-800 border-b border-r border-gray-200 bg-amber-100 align-middle" rowSpan={2} title="Stock from FD (channel distributor)">
                      Stock-FD
                    </th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-center text-xs font-bold uppercase border-b border-r border-gray-300 bg-amber-100 text-amber-800" colSpan={2}>
                      Stock-HQ
                    </th>
                  </tr>
                  {/* row 2: 子标签 — KA 下"月份"，SUB-TOTAL 下"月份"，TOTAL block 下"Total/FD/HQ" */}
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
                    {/* Stock-HQ 子列 */}
                    <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" style={{ top: 36 }} title="HQ 国内库存 (domestic warehouse)">
                      CN
                    </th>
                    <th className="sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" style={{ top: 36 }} title="HQ 海外仓库存 (overseas warehouse)">
                      Oversea
                    </th>
                  </tr>
                </>
              )}
            </thead>
            <tbody>
              {visibleSkus.map(sku => {
                const subTotal = rowSubtotal(sku.id)
                // Σ PO: shipment 出货 — country × sku 级（不细分 KA, 因为出货跨 KA 汇总同义）
                const poTotal = poByCountrySku[selectedCountry.id]?.[sku.id] ?? 0
                // Σ SO / Stock-FD: 跨该国全部 KA 求和（含被分组的 FD 自身的 PSI/库存，
                // 因此用 allCountryKas 而非仅输入列 kas — 否则 FD 分组后会漏掉分销商自身的量）
                let soTotal = 0
                let fdTotal = 0
                allCountryKas.forEach(ka => {
                  soTotal += soByKaSku[ka.id]?.[sku.id] ?? 0
                  fdTotal += fdStockByKaSku[ka.id]?.[sku.id] ?? 0
                })
                // HQ 库存是共享池（SKU 级），不随国家/KA 变化
                const hqCnTotal = hqCnStockBySku[sku.id] ?? 0
                const hqOvsTotal = hqOvsStockBySku[sku.id] ?? 0
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
                        const st = cellStatus[key]
                        const dirty = dirtyKeys.has(key)
                        const isLast = i === monthsIso.length - 1
                        const tint = st === 'saving' ? 'bg-blue-50' : st === 'saved' ? 'bg-green-50' : st === 'error' ? 'bg-red-50' : dirty ? 'bg-yellow-50' : ''
                        return (
                          <td key={key} className={`px-1 py-1 text-right border-b border-gray-100 ${isLast ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'} ${tint} transition-colors`}>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={value === 0 ? '' : String(value)}
                              onChange={(e) => updateCell(sku.id, ka.id, m, e.target.value)}
                              onBlur={() => saveCell(sku.id, ka.id, m)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                              placeholder="0"
                              disabled={locked}
                              className={`w-full text-xs text-right tabular-nums bg-transparent focus:bg-white focus:ring-2 focus:ring-blue-300 rounded px-1 py-1 outline-none ${value > 0 ? 'text-gray-900 font-medium' : 'text-gray-300'} ${locked ? 'cursor-not-allowed' : ''}`}
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
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums bg-amber-50 text-gray-700 border-b border-r border-amber-200">
                      {fdTotal > 0 ? fmtNum(fdTotal) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums bg-amber-50 text-gray-700 border-b border-r border-amber-200">
                      {hqCnTotal > 0 ? fmtNum(hqCnTotal) : <span className="text-gray-300" title="HQ domestic stock not yet imported">-</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums bg-amber-50 text-gray-700 border-b border-r border-amber-200">
                      {hqOvsTotal > 0 ? fmtNum(hqOvsTotal) : <span className="text-gray-300" title="HQ overseas stock not yet imported">-</span>}
                    </td>
                  </tr>
                )
              })}
              {!visibleSkus.length && (
                <tr>
                  <td colSpan={2 + kas.length * monthsIso.length + 1 + monthsIso.length + 4} className="py-16 text-center text-gray-400">
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
                    allCountryKas.forEach(ka => allSkus.forEach(s => {
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
                      allCountryKas.forEach(ka => allSkus.forEach(s => { total += fdStockByKaSku[ka.id]?.[s.id] ?? 0 }))
                      return total > 0 ? fmtNum(total) : '-'
                    })()}
                  </td>
                  <td className="px-2 py-2 text-right text-xs font-bold tabular-nums bg-amber-50 text-gray-700 border-r border-t-2 border-amber-300">
                    {(() => {
                      let total = 0
                      allSkus.forEach(s => { total += hqCnStockBySku[s.id] ?? 0 })
                      return total > 0 ? fmtNum(total) : '-'
                    })()}
                  </td>
                  <td className="px-2 py-2 text-right text-xs font-bold tabular-nums bg-amber-50 text-gray-700 border-r border-t-2 border-amber-300">
                    {(() => {
                      let total = 0
                      allSkus.forEach(s => { total += hqOvsStockBySku[s.id] ?? 0 })
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
        💡 Edits <b className="text-gray-500">auto-save as you type — save when you pause, or on blur / Enter — and are logged</b> (🟦 saving · 🟩 saved · 🟥 failed, retryable) · <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px]">⌘/Ctrl + S</kbd> flushes any pending ·
        PO (shipment) / SO (PSI) ref = avg of past 3 complete months (excl. current) ·
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
