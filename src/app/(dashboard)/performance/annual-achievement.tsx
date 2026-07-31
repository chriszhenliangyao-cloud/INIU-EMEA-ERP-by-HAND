'use client'

/**
 * 年度达成模块（放在 Profitability 上方）。只展示两条进度条：
 *   1) 所选季度(跟随顶部季度选择器)：实际 vs BP 目标 + gap；
 *   2) 整年(YTD)：YTD 实际 vs 全年目标 + gap。
 * 指标 = Revenue。目标来自 business_plan(SI×FD买价，与实际 PO 同口径)；实际来自 channel_po。
 */
import { fmtNum } from '@/lib/utils'

const eur = (v: number | null) => v == null ? '—' : `€${fmtNum(Math.round(v))}`
const pct = (a: number, b: number) => (b > 0 ? `${(a / b * 100).toFixed(1)}%` : '—')

// 一条进度条：绿填=actual÷target，空白=gap；右下角标 gap 金额
function Bar({ title, sub, actual, target, future = false }: {
  title: string; sub: string; actual: number | null; target: number; future?: boolean
}) {
  // 无计划：只有实际、没有目标
  if (target <= 0) {
    return (
      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1.5">
          <span className="text-sm font-bold text-gray-900">{title} <span className="ml-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{sub}</span></span>
          <span className="text-sm font-bold tabular-nums">{actual != null ? <>{eur(actual)} <span className="font-semibold text-gray-400 text-xs">actual · no target</span></> : <span className="text-gray-400 text-xs font-semibold">no plan</span>}</span>
        </div>
        <div className="h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs text-gray-400 font-medium">
          {actual != null ? `${eur(actual)} sold — no plan for this period` : 'No plan for this period'}
        </div>
      </div>
    )
  }
  const fill = future || actual == null ? 0 : Math.min(actual / target * 100, 100)
  const gap = actual == null ? null : actual - target
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1.5">
        <span className="text-sm font-bold text-gray-900">{title} <span className="ml-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{sub}</span></span>
        <span className="text-sm font-bold tabular-nums">{eur(future ? null : actual)} <span className="font-semibold text-gray-400 text-xs">/ {eur(target)} target</span></span>
      </div>
      <div className="relative h-8 rounded-lg bg-slate-100 overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-400" style={{ width: `${fill}%` }} />
        <span className={`absolute top-1/2 -translate-y-1/2 z-10 text-xs font-extrabold tabular-nums ${fill >= 25 ? 'left-2.5 text-white' : 'right-2.5 text-gray-700'}`}>{future ? '—' : pct(actual ?? 0, target)}</span>
      </div>
      <div className="flex justify-between items-baseline mt-1.5 text-xs tabular-nums">
        <span className="text-gray-400">{future ? 'not started' : `${eur(actual)} of ${eur(target)}`}</span>
        {gap != null && (
          <span className={`font-bold ${gap >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
            {gap >= 0 ? '+' : '−'}{eur(Math.abs(gap))} <span className="font-semibold">{gap >= 0 ? 'ahead' : 'to target'}</span>
          </span>
        )}
      </div>
    </div>
  )
}

export function AnnualAchievement({
  plan, actual, future, year, quarter, scope,
}: {
  plan: number[]        // [Q1..Q4] 计划营收
  actual: number[]      // [Q1..Q4] 实际营收(EUR)
  future: boolean[]     // [Q1..Q4] 是否未开始
  year: number
  quarter: number       // 当前选中季度(1-4)
  scope: string
}) {
  const yearPlan = plan.reduce((a, b) => a + b, 0)
  let ytdPlan = 0, ytdAct = 0
  for (let i = 0; i < 4; i++) if (!future[i]) { ytdPlan += plan[i]; ytdAct += actual[i] }
  const hasData = yearPlan > 0 || actual.some(v => v > 0)
  const qi = Math.min(Math.max(quarter - 1, 0), 3)

  return (
    <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl p-5 mb-5">
      <div className="flex items-baseline gap-2 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">📅 Annual achievement</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{scope} · {year}</span>
        <span className="ml-auto text-xs text-gray-400">target = BP · actual = PO</span>
      </div>

      {!hasData ? (
        <div className="py-8 text-center text-gray-400 text-sm">No annual plan or PO data for {scope} {year} yet.</div>
      ) : (
        <>
          <Bar title={`Q${qi + 1} ${year}`} sub="this quarter" actual={actual[qi]} target={plan[qi]} future={future[qi]} />
          <Bar title={`Year ${year}`} sub="YTD" actual={ytdAct} target={ytdPlan} />
        </>
      )}
    </div>
  )
}
