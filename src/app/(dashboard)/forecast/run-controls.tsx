'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Run = {
  id: number
  code: string
  period_start: string
  period_end: string
  status: string
  month_count?: number
}

type Toast = { kind: 'success' | 'error' | 'info'; msg: string; id: number } | null

export function RunControls({
  selectedRun, allRuns, viewerIsAdmin, hasUnsaved, onAfterAction,
}: {
  selectedRun: Run
  allRuns: Run[]
  viewerIsAdmin: boolean
  hasUnsaved?: boolean              // 当前视图是否有未保存的改动
  onAfterAction?: () => void        // 工作流动作完成后回调（关闭 toast / 刷新等）
}) {
  const router = useRouter()
  const supabase = useRef(createClient()).current
  const [busy, setBusy] = useState<string | null>(null)   // 当前正在执行的动作名（按钮 loading）
  const [toast, setToast] = useState<Toast>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const showToast = useCallback((kind: 'success' | 'error' | 'info', msg: string) => {
    const id = Date.now()
    setToast({ kind, msg, id })
    setTimeout(() => setToast(prev => (prev?.id === id ? null : prev)), kind === 'error' ? 5000 : 2500)
  }, [])

  // —— 工作流动作（admin only）——
  const runRpc = useCallback(async (action: string, rpcName: string, confirmMsg?: string) => {
    if (hasUnsaved) {
      showToast('error', 'Please save your unsaved changes first')
      return
    }
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(action)
    const { error } = await supabase.rpc(rpcName, { p_run_id: selectedRun.id })
    setBusy(null)
    if (error) {
      showToast('error', `${action} failed: ${error.message}`)
      return
    }
    showToast('success', `${action} succeeded`)
    onAfterAction?.()
    router.refresh()
  }, [selectedRun.id, hasUnsaved, supabase, router, showToast, onAfterAction])

  // —— 创建新 run ——
  const handleCreateRun = useCallback(async (periodStart: string, cloneFromRunId: number | null) => {
    setBusy('create')
    let result
    if (cloneFromRunId !== null) {
      result = await supabase.rpc('clone_forecast_run', {
        p_source_run_id: cloneFromRunId,
        p_new_period_start: periodStart,
      })
    } else {
      result = await supabase.rpc('create_forecast_run', {
        p_region: 'EU',
        p_period_start: periodStart,
      })
    }
    if (result.error) {
      setBusy(null)
      showToast('error', `Create failed: ${result.error.message}`)
      return
    }
    const newRun = result.data
    const newRunId = Array.isArray(newRun) ? newRun[0]?.id : newRun?.id

    // —— Rolling 带入：从上一周期按【同日历月】预填（source='rollover'，表格里淡灰显示）——
    // 仅普通新建走带入；clone 本身已复制 cells（平移语义），不再叠加
    let rolledOver = 0
    if (cloneFromRunId === null && newRunId) {
      const ro = await supabase.rpc('rollover_forecast_run', { p_run_id: newRunId })
      if (ro.error) {
        showToast('error', `Cycle created, but rollover failed: ${ro.error.message}`)
      } else {
        rolledOver = ro.data ?? 0
      }
    }
    setBusy(null)
    showToast('success', cloneFromRunId !== null
      ? `Cloned from ${allRuns.find(r => r.id === cloneFromRunId)?.code} into new cycle`
      : rolledOver > 0
        ? `New cycle created · ${rolledOver} cells rolled over from previous cycle`
        : 'New cycle created')
    setShowCreateModal(false)
    onAfterAction?.()
    // 跳到新 run
    if (newRunId) {
      router.push(`/forecast?run=${newRunId}`)
    } else {
      router.refresh()
    }
  }, [supabase, router, showToast, onAfterAction, allRuns])

  // —— 按 status 渲染按钮组 ——
  const workflowButtons = (() => {
    if (!viewerIsAdmin) return null

    const btn = (
      label: string, action: string, rpc: string, color: string,
      confirmMsg?: string
    ) => (
      <button
        key={action}
        onClick={() => runRpc(action, rpc, confirmMsg)}
        disabled={!!busy}
        className={`px-3 py-1.5 text-xs font-medium rounded-md border transition disabled:opacity-50 disabled:cursor-not-allowed ${color}`}
      >
        {busy === action ? '...' : label}
      </button>
    )

    switch (selectedRun.status) {
      case 'draft':
        return [
          btn('📤 Submit for review', 'submit', 'submit_forecast_run',
            'bg-blue-600 text-white border-blue-600 hover:bg-blue-700',
            'Submit this forecast cycle for review? Sales will no longer be able to edit (only admin can).'),
        ]
      case 'submitted':
        return [
          btn('✓ Approve', 'approve', 'approve_forecast_run',
            'bg-purple-600 text-white border-purple-600 hover:bg-purple-700',
            'Approving will move this cycle to "pending publish" state.'),
          btn('↩️ Revert to draft', 'reopen', 'reopen_forecast_run',
            'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
            'Reverting to draft will let sales edit again. The submitter record will be cleared.'),
        ]
      case 'approved':
        return [
          btn('🚀 Publish', 'publish', 'publish_forecast_run',
            'bg-green-600 text-white border-green-600 hover:bg-green-700',
            'Publishing locks this cycle as read-only — nobody can edit it after. Continue?'),
          btn('↩️ Revert to draft', 'reopen', 'reopen_forecast_run',
            'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
            'Reverting to draft will let sales edit again.'),
        ]
      case 'published':
        return [<span key="locked" className="text-xs text-gray-500 italic">This cycle is published & locked — create a new cycle to make changes</span>]
      case 'archived':
        return [<span key="archived" className="text-xs text-gray-500 italic">This cycle is archived</span>]
      default:
        return null
    }
  })()

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div
            className={`pointer-events-auto px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium border flex items-center gap-2 ${
              toast.kind === 'success' ? 'bg-green-50 text-green-700 border-green-300' :
              toast.kind === 'error' ? 'bg-red-50 text-red-700 border-red-300' :
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

      {/* 工作流按钮组 */}
      {workflowButtons && (
        <div className="flex items-center gap-2 flex-wrap">
          {workflowButtons}
        </div>
      )}

      {/* 新建周期按钮 */}
      {viewerIsAdmin && (
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={!!busy}
          className="px-3 py-1.5 text-xs font-medium rounded-md border-2 border-dashed border-blue-400 text-blue-600 hover:bg-blue-50 transition"
        >
          ➕ New cycle
        </button>
      )}

      {/* 创建 run 弹窗 */}
      {showCreateModal && (
        <CreateRunModal
          allRuns={allRuns}
          busy={busy === 'create'}
          onCancel={() => setShowCreateModal(false)}
          onSubmit={handleCreateRun}
        />
      )}
    </>
  )
}

// ============ 创建 Run Modal ============
function CreateRunModal({
  allRuns, busy, onCancel, onSubmit,
}: {
  allRuns: Run[]
  busy: boolean
  onCancel: () => void
  onSubmit: (periodStart: string, cloneFromRunId: number | null) => void
}) {
  // 默认起始月份：所有 run 中最晚的 period_start 再 +1 月；如果没有就用下个月
  const defaultPeriod = (() => {
    if (allRuns.length === 0) {
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    const latestStart = allRuns
      .map(r => new Date(r.period_start))
      .sort((a, b) => b.getTime() - a.getTime())[0]
    latestStart.setMonth(latestStart.getMonth() + 1)
    return `${latestStart.getFullYear()}-${String(latestStart.getMonth() + 1).padStart(2, '0')}`
  })()

  const [periodMonth, setPeriodMonth] = useState(defaultPeriod)
  const [mode, setMode] = useState<'blank' | 'clone'>(allRuns.length > 0 ? 'clone' : 'blank')
  const [cloneFromId, setCloneFromId] = useState<number>(
    allRuns.length > 0 ? allRuns[0].id : 0
  )

  // 检查是否会冲突（同月已有 run）
  const wouldConflict = allRuns.some(r => r.period_start.slice(0, 7) === periodMonth)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900 mb-1">➕ New forecast cycle</h2>
        <p className="text-sm text-gray-500 mb-5">
          Create a new rolling forecast window for the EU region. Default 3 months; start month aligned to the 1st; code auto-generated.
        </p>

        {/* Start month */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Start month</label>
          <input
            type="month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <div className="text-xs text-gray-500 mt-1">
            Window: <strong>{periodMonth}</strong> ~ {(() => {
              const [y, m] = periodMonth.split('-').map(Number)
              const end = new Date(y, m - 1 + 2, 1)  // +2 = 3 个月窗口的最后一个月
              return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
            })()} (3 months · rolling)
            · Code: <code className="bg-gray-100 px-1 rounded">EU-FCST-{periodMonth}</code>
          </div>
          {wouldConflict && (
            <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              ⚠️ A cycle already exists for this month — creation will fail (code uniqueness)
            </div>
          )}
        </div>

        {/* Starting mode */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Starting mode</label>
          <div className="space-y-2">
            <label className={`flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer transition ${
              mode === 'blank' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}>
              <input
                type="radio"
                checked={mode === 'blank'}
                onChange={() => setMode('blank')}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-sm">📋 Start blank</div>
                <div className="text-xs text-gray-500 mt-0.5">Empty grid — fill from scratch</div>
              </div>
            </label>

            <label className={`flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer transition ${
              mode === 'clone' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            } ${allRuns.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input
                type="radio"
                checked={mode === 'clone'}
                onChange={() => setMode('clone')}
                disabled={allRuns.length === 0}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium text-sm">📑 Clone from existing</div>
                <div className="text-xs text-gray-500 mt-0.5 mb-2">
                  Copy all cells from source cycle, months auto-shifted by the offset
                </div>
                {mode === 'clone' && (
                  <select
                    value={cloneFromId}
                    onChange={(e) => setCloneFromId(Number(e.target.value))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    {allRuns.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.code} ({r.status}) · {r.period_start.slice(0, 7)} ~ {r.period_end.slice(0, 7)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          </div>
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(`${periodMonth}-01`, mode === 'clone' ? cloneFromId : null)}
            disabled={busy || wouldConflict || (mode === 'clone' && !cloneFromId)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Creating...' : (mode === 'clone' ? '📑 Clone & create' : '📋 Create blank')}
          </button>
        </div>
      </div>
    </div>
  )
}
