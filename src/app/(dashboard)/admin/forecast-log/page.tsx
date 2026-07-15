import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { ForecastLogView } from './forecast-log-view'

/**
 * /admin/forecast-log — Forecast Activity（admin only）
 *
 * 销售填报监控：
 *  - 顶部：每个销售一张监控卡（负责国家 / 当前 run 进度 / 最近活动 / 今日·本周修改数）
 *  - 主体：保存批次日志（同一事务时间戳 = 一次 Save），展开看格子级 旧值→新值
 * 数据源：forecast_cell_audit_log（trigger 自动写，零额外记录成本）
 */
export default async function AdminForecastLogPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) {
    redirect('/po')
  }

  const supabase = createClient()

  const [
    { data: logs, error: logError },
    { data: reps },
    { data: repCountries },
    { data: kas },
    { data: skus },
    { data: runs },
    { data: countries },
  ] = await Promise.all([
    supabase.from('forecast_cell_audit_log')
      .select('id, changed_at, changed_by, op, run_id, sku_id, ka_id, month, old_qty, new_qty')
      .order('changed_at', { ascending: false })
      .range(0, 1999),
    supabase.from('sales_rep')
      .select('id, user_id, display_name, role, is_active'),
    supabase.from('sales_rep_country')
      .select('sales_rep_id, country_id, valid_to'),
    supabase.from('ka').select('id, name, country_id'),
    supabase.from('sku').select('id, code'),
    supabase.from('forecast_run')
      .select('id, code, period_start, status, month_count')
      .order('period_start', { ascending: false }),
    supabase.from('country').select('id, code, flag_emoji'),
  ])

  if (logError || !logs) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">📋 Forecast Activity</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
          Failed to load audit log: {logError?.message ?? 'unknown error'}
        </div>
      </div>
    )
  }

  // 当前（最新）run 的填报进度：按国家聚合 已确认（source null）/ 待确认（rollover）
  const latestRun = (runs ?? [])[0] ?? null
  let progressByCountry: Record<number, { confirmed: number; pending: number }> = {}
  if (latestRun) {
    const { data: cells } = await supabase.from('forecast_cell')
      .select('ka_id, source')
      .eq('run_id', latestRun.id)
      .range(0, 49999)
    const kaCountry: Record<number, number> = {}
    ;(kas ?? []).forEach((k: any) => { kaCountry[k.id] = k.country_id })
    ;(cells ?? []).forEach((c: any) => {
      const cid = kaCountry[c.ka_id]
      if (cid == null) return
      progressByCountry[cid] ??= { confirmed: 0, pending: 0 }
      if (c.source === 'rollover') progressByCountry[cid].pending++
      else progressByCountry[cid].confirmed++
    })
  }

  return (
    <ForecastLogView
      logs={logs}
      reps={reps ?? []}
      repCountries={(repCountries ?? []).filter((rc: any) => rc.valid_to === null)}
      kas={kas ?? []}
      skus={skus ?? []}
      runs={runs ?? []}
      countries={countries ?? []}
      latestRunId={latestRun?.id ?? null}
      progressByCountry={progressByCountry}
      viewerName={me.displayName}
    />
  )
}

export const metadata = {
  title: 'Forecast Activity · INIU ERP',
}
