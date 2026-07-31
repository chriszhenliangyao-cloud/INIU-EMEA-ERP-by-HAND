'use client'

/**
 * 年度达成模块（放在 Profitability 上方）。Value(营收€) 与 Volume(台数) 两列并排，
 * 每列各两条进度条：整年(YTD) + 所选季度。目标=BP、实际=PO。
 */
import { fmtNum } from '@/lib/utils'

// 一条进度条：绿填=actual÷target，空白=gap；右下角标 gap
function Bar({ title, sub, actual, target, fmt, future = false, mb = 'mb-5' }: {
  title: string; sub: string; actual: number | null; target: number; fmt: (v: number | null) => string; future?: boolean; mb?: string
}) {
  const pct = (a: number, b: number) => (b > 0 ? `${(a / b * 100).toFixed(1)}%` : '—')
  if (target <= 0) {
    return (
      <div className={mb}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1.5">
          <span className="text-sm font-bold text-gray-900">{title} <span className="ml-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{sub}</span></span>
          <span className="text-sm font-bold tabular-nums">{actual != null ? <>{fmt(actual)} <span className="font-semibold text-gray-400 text-xs">actual · no target</span></> : <span className="text-gray-400 text-xs font-semibold">no plan</span>}</span>
        </div>
        <div className="h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs text-gray-400 font-medium">
          {actual != null ? `${fmt(actual)} sold — no plan for this period` : 'No plan for this period'}
        </div>
      </div>
    )
  }
  const fill = future || actual == null ? 0 : Math.min(actual / target * 100, 100)
  const gap = actual == null ? null : actual - target
  return (
    <div className={mb}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1.5">
        <span className="text-sm font-bold text-gray-900">{title} <span className="ml-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{sub}</span></span>
        <span className="text-sm font-bold tabular-nums">{fmt(future ? null : actual)} <span className="font-semibold text-gray-400 text-xs">/ {fmt(target)} target</span></span>
      </div>
      <div className="relative h-8 rounded-lg bg-slate-100 overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-400" style={{ width: `${fill}%` }} />
        <span className={`absolute top-1/2 -translate-y-1/2 z-10 text-xs font-extrabold tabular-nums ${fill >= 25 ? 'left-2.5 text-white' : 'right-2.5 text-gray-700'}`}>{future ? '—' : pct(actual ?? 0, target)}</span>
      </div>
      <div className="flex justify-between items-baseline mt-1.5 text-xs tabular-nums">
        <span className="text-gray-400">{future ? 'not started' : `${fmt(actual)} of ${fmt(target)}`}</span>
        {gap != null && (
          <span className={`font-bold ${gap >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
            {gap >= 0 ? '+' : '−'}{fmt(Math.abs(gap))} <span className="font-semibold">{gap >= 0 ? 'ahead' : 'to target'}</span>
          </span>
        )}
      </div>
    </div>
  )
}

// 一列（一个指标）：整年 YTD + 所选季度 两条进度条
function MetricColumn({ label, P, A, future, year, qi, fmt }: {
  label: string; P: number[]; A: number[]; future: boolean[]; year: number; qi: number; fmt: (v: number | null) => string
}) {
  let ytdPlan = 0, ytdAct = 0
  for (let i = 0; i < 4; i++) if (!future[i]) { ytdPlan += P[i]; ytdAct += A[i] }
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-blue-700 mb-2.5">{label}</div>
      <Bar title={`Year ${year}`} sub="YTD" actual={ytdAct} target={ytdPlan} fmt={fmt} />
      <div className="ml-3 pl-5 border-l-2 border-slate-200">
        <Bar title={`Q${qi + 1} ${year}`} sub="this quarter" actual={A[qi]} target={P[qi]} fmt={fmt} future={future[qi]} mb="mb-0" />
      </div>
    </div>
  )
}

export function AnnualAchievement({
  plan, actual, planQty, actualQty, future, year, quarter, scope,
}: {
  plan: number[]        // [Q1..Q4] 计划营收(EUR)
  actual: number[]      // [Q1..Q4] 实际营收(EUR)
  planQty: number[]     // [Q1..Q4] 计划台数
  actualQty: number[]   // [Q1..Q4] 实际台数
  future: boolean[]
  year: number
  quarter: number
  scope: string
}) {
  const eurFmt = (v: number | null) => v == null ? '—' : `€${fmtNum(Math.round(v))}`
  const volFmt = (v: number | null) => v == null ? '—' : `${fmtNum(Math.round(v))} units`
  const hasData = plan.some(v => v > 0) || actual.some(v => v > 0) || planQty.some(v => v > 0) || actualQty.some(v => v > 0)
  const qi = Math.min(Math.max(quarter - 1, 0), 3)

  return (
    <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl p-5 mb-5">
      <div className="flex items-baseline gap-2 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900">📅 Annual achievement</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{scope} · {year}</span>
        <span className="ml-auto text-xs text-gray-400">target = BP · actual = PO</span>
      </div>

      {!hasData ? (
        <div className="py-8 text-center text-gray-400 text-sm">No annual plan or PO data for {scope} {year} yet.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-5">
          <MetricColumn label="€ Value" P={plan} A={actual} future={future} year={year} qi={qi} fmt={eurFmt} />
          <MetricColumn label="▦ Volume" P={planQty} A={actualQty} future={future} year={year} qi={qi} fmt={volFmt} />
        </div>
      )}
    </div>
  )
}
