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
      showToast('error', '请先保存当前未保存的改动')
      return
    }
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(action)
    const { error } = await supabase.rpc(rpcName, { p_run_id: selectedRun.id })
    setBusy(null)
    if (error) {
      showToast('error', `${action} 失败：${error.message}`)
      return
    }
    showToast('success', `${action} 成功`)
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
    setBusy(null)
    if (result.error) {
      showToast('error', `创建失败：${result.error.message}`)
      return
    }
    const newRun = result.data
    const newRunId = Array.isArray(newRun) ? newRun[0]?.id : newRun?.id
    showToast('success', cloneFromRunId !== null
      ? `已从 ${allRuns.find(r => r.id === cloneFromRunId)?.code} 克隆为新周期`
      : '已创建新周期')
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
          btn('📤 提交审批', 'submit', 'submit_forecast_run',
            'bg-blue-600 text-white border-blue-600 hover:bg-blue-700',
            '确定提交本期 FCST 进入审批流程吗？提交后 sales 将无法继续修改（仅 admin 可改）。'),
        ]
      case 'submitted':
        return [
          btn('✓ 审批通过', 'approve', 'approve_forecast_run',
            'bg-purple-600 text-white border-purple-600 hover:bg-purple-700',
            '审批通过后将进入"待发布"状态。'),
          btn('↩️ 退回草稿', 'reopen', 'reopen_forecast_run',
            'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
            '退回草稿后 sales 可重新编辑。本步骤会清空提交人记录。'),
        ]
      case 'approved':
        return [
          btn('🚀 发布', 'publish', 'publish_forecast_run',
            'bg-green-600 text-white border-green-600 hover:bg-green-700',
            '发布后本期 FCST 进入只读状态，任何人都不能再修改。确定继续？'),
          btn('↩️ 退回草稿', 'reopen', 'reopen_forecast_run',
            'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
            '退回草稿后 sales 可重新编辑。'),
        ]
      case 'published':
        return [<span key="locked" className="text-xs text-gray-500 italic">本期已发布锁定，如需修改请创建新周期</span>]
      case 'archived':
        return [<span key="archived" className="text-xs text-gray-500 italic">本期已归档</span>]
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
          ➕ 新建周期
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
        <h2 className="text-lg font-bold text-gray-900 mb-1">➕ 新建 FCST 周期</h2>
        <p className="text-sm text-gray-500 mb-5">
          为 EU 区域创建新的 4 个月预测窗口。窗口起始月份对齐到月初，自动生成 code。
        </p>

        {/* 起始月份 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">起始月份</label>
          <input
            type="month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <div className="text-xs text-gray-500 mt-1">
            预测窗口：<strong>{periodMonth}</strong> ~ {(() => {
              const [y, m] = periodMonth.split('-').map(Number)
              const end = new Date(y, m - 1 + 3, 1)
              return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
            })()} （4 个月）
            · 生成 code: <code className="bg-gray-100 px-1 rounded">EU-FCST-{periodMonth}</code>
          </div>
          {wouldConflict && (
            <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              ⚠️ 该月份已存在一个周期，创建会失败（code 唯一约束）
            </div>
          )}
        </div>

        {/* 起步方式 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">起步方式</label>
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
                <div className="font-medium text-sm">📋 空白起步</div>
                <div className="text-xs text-gray-500 mt-0.5">从零开始填，所有单元格初始为空</div>
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
                <div className="font-medium text-sm">📑 从已有周期克隆</div>
                <div className="text-xs text-gray-500 mt-0.5 mb-2">
                  复制源周期的所有 cell，月份按差额自动后挪
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
            取消
          </button>
          <button
            onClick={() => onSubmit(`${periodMonth}-01`, mode === 'clone' ? cloneFromId : null)}
            disabled={busy || wouldConflict || (mode === 'clone' && !cloneFromId)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? '创建中...' : (mode === 'clone' ? '📑 克隆创建' : '📋 空白创建')}
          </button>
        </div>
      </div>
    </div>
  )
}
