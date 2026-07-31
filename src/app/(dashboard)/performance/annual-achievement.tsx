'use client'

/**
 * 年度达成模块（放在 Profitability 上方）。
 * 指标 = Revenue(营收)：各季度 计划(annual_plan iniu_si_value) vs 实际(channel_po turnover, EUR)。
 * 目标数据由销售在 annual_plan 维护；实际来自 PO。跟随 Profitability 的国家/年份选择。
 */
import { useMemo } from 'react'
import { fmtNum } from '@/lib/utils'

const eur = (v: number) => `€${fmtNum(Math.round(v))}`

export function AnnualAchievement({
  plan, actual, future, year, quarter, scope,
}: {
  plan: number[]        // [Q1..Q4] 计划营收
  actual: number[]      // [Q1..Q4] 实际营收(EUR)
  future: boolean[]     // [Q1..Q4] 是否未开始
  year: number
  quarter: number       // 当前选中季度(1-4)，高亮
  scope: string         // 例 "🇵🇱 PL" 或 "All countries"
}) {
  const m = useMemo(() => {
    const yearPlan = plan.reduce((a, b) => a + b, 0)
    // YTD = 已开始的季度
    let ytdPlan = 0, ytdAct = 0
    for (let i = 0; i < 4; i++) if (!future[i]) { ytdPlan += plan[i]; ytdAct += actual[i] }
    return { yearPlan, ytdPlan, ytdAct, yearAct: actual.reduce((a, b) => a + b, 0) }
  }, [plan, actual, future])

  const hasData = m.yearPlan > 0 || m.yearAct > 0
  const pct1 = (v: number, base: number) => (base > 0 ? `${(v / base * 100).toFixed(1)}%` : '—')
  const achievePillCls = (a: number, p: number) =>
    p <= 0 ? '' : a / p >= 0.9 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'

  return (
    <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl p-5 mb-5">
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900">📅 Annual achievement</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{scope} · {year} · Revenue</span>
        <span className="ml-auto text-xs text-gray-400">vs Annual Plan</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">Actual PO revenue against the sales annual plan, by quarter. The selected quarter is outlined.</p>

      {!hasData ? (
        <div className="py-10 text-center text-gray-400 text-sm">No annual plan or PO data for {scope} {year} yet.</div>
      ) : (
        <>
          {/* 顶部大数 */}
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">YTD actual</div>
              <div className="text-3xl font-extrabold tracking-tight tabular-nums">{eur(m.ytdAct)}
                <span className="text-sm font-semibold text-gray-500 ml-1.5">/ {eur(m.ytdPlan)} plan</span></div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">YTD achievement</div>
              <div className="text-3xl font-extrabold tracking-tight tabular-nums text-emerald-700">{pct1(m.ytdAct, m.ytdPlan)}
                {m.ytdPlan > 0 && <span className={`ml-2 align-middle text-xs font-bold px-2 py-0.5 rounded-full ${achievePillCls(m.ytdAct, m.ytdPlan)}`}>{m.ytdAct / m.ytdPlan >= 0.9 ? 'on track' : 'behind'}</span>}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">Full-year plan</div>
              <div className="text-3xl font-extrabold tracking-tight tabular-nums">{eur(m.yearPlan)}</div>
              <div className="text-xs text-gray-400 mt-0.5">YTD = {pct1(m.ytdAct, m.yearPlan)} of year</div>
            </div>
          </div>

          {/* 分季度进度条：段宽 ∝ 计划占比，绿填 ∝ 达成 */}
          <div className="flex gap-1 h-10">
            {[0, 1, 2, 3].map(i => {
              const w = m.yearPlan > 0 ? plan[i] / m.yearPlan : 0.25
              const fillPct = plan[i] > 0 ? Math.min(actual[i] / plan[i] * 100, 100) : (actual[i] > 0 ? 100 : 0)
              const achieve = future[i] ? '—' : (plan[i] > 0 ? `${Math.round(actual[i] / plan[i] * 100)}%` : '∞')
              const cur = quarter === i + 1
              return (
                <div key={i} className={`relative rounded-md overflow-hidden bg-slate-100 ${cur ? 'outline outline-2 outline-blue-500 outline-offset-1' : ''}`}
                  style={{ flex: `${w} 1 0` }} title={`Q${i + 1}: plan ${eur(plan[i])} · actual ${future[i] ? '—' : eur(actual[i])}`}>
                  {future[i]
                    ? <div className="absolute inset-0 opacity-50" style={{ background: 'repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1 5px,transparent 5px,transparent 10px)' }} />
                    : <div className="absolute left-0 top-0 bottom-0 rounded-md bg-gradient-to-r from-emerald-600 to-emerald-400" style={{ width: `${fillPct}%` }} />}
                  <span className={`absolute left-2 top-1/2 -translate-y-1/2 z-10 text-xs font-extrabold ${fillPct >= 22 && !future[i] ? 'text-white drop-shadow' : 'text-gray-700'}`}>Q{i + 1}</span>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-xs font-extrabold text-gray-700">{achieve}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-1 mt-1.5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="text-[11px] text-gray-400 text-center" style={{ flex: `${m.yearPlan > 0 ? plan[i] / m.yearPlan : 0.25} 1 0` }}>
                {plan[i] > 0 ? `${eur(plan[i])} plan` : ''}
              </div>
            ))}
          </div>

          {/* 数据表 */}
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse tabular-nums" style={{ minWidth: 560 }}>
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Quarter</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Plan</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Actual</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Achieve %</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Gap</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3].map(i => {
                  const cur = quarter === i + 1
                  const gap = actual[i] - plan[i]
                  return (
                    <tr key={i} className={cur ? 'bg-blue-50/50' : ''}>
                      <td className={`px-3 py-2 text-left font-bold border-b border-gray-100 ${cur ? 'text-blue-700' : 'text-gray-800'}`}>Q{i + 1}</td>
                      <td className="px-3 py-2 text-right text-gray-700 border-b border-gray-100">{plan[i] > 0 ? eur(plan[i]) : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900 border-b border-gray-100">{future[i] ? <span className="text-gray-300">—</span> : eur(actual[i])}</td>
                      <td className="px-3 py-2 text-right border-b border-gray-100">
                        {future[i] ? <span className="text-gray-300">—</span>
                          : <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${achievePillCls(actual[i], plan[i])}`}>{pct1(actual[i], plan[i])}</span>}
                      </td>
                      <td className={`px-3 py-2 text-right border-b border-gray-100 ${future[i] ? 'text-gray-300' : gap >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {future[i] ? '—' : `${gap >= 0 ? '+' : '−'}${eur(Math.abs(gap))}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="font-extrabold bg-gray-50">
                  <td className="px-3 py-2 text-left text-gray-800 border-t-2 border-gray-300">Year</td>
                  <td className="px-3 py-2 text-right border-t-2 border-gray-300">{eur(m.yearPlan)}</td>
                  <td className="px-3 py-2 text-right border-t-2 border-gray-300">{eur(m.yearAct)}</td>
                  <td className="px-3 py-2 text-right border-t-2 border-gray-300">{pct1(m.yearAct, m.yearPlan)}</td>
                  <td className={`px-3 py-2 text-right border-t-2 border-gray-300 ${m.yearAct - m.yearPlan >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {m.yearAct - m.yearPlan >= 0 ? '+' : '−'}{eur(Math.abs(m.yearAct - m.yearPlan))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
