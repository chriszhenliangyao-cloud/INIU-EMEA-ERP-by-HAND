'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { fmtNum } from '@/lib/utils'
import { QuarterlyReview, type Review } from './quarterly-review'

type Country = { id: number; code: string; name_en: string; flag_emoji: string; sort_order: number }
type Sku = { id: number; code: string; name: string; category: string | null; sort_order: number }
type ByCountrySku = Record<number, Record<number, number[]>>

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (iso: string) => MONTH_ABBR[Number(iso.slice(5, 7)) - 1] ?? iso.slice(0, 7)

// 评分标准（折叠面板展示）— Accuracy = 达成率(Achieve÷FCST)，以 100% 为中心对称分档
const SCORE_BANDS = [
  { range: '90% – 110%', score: 100, level: 'Excellent', color: 'text-emerald-700', impact: 'High Reliability: Minimizes inventory costs and maximizes service levels.' },
  { range: '70–89%\n111–130%', score: 80, level: 'Good', color: 'text-blue-700', impact: 'Solid Performance: Normal market changes are well-managed.' },
  { range: '50–69%\n131–150%', score: 60, level: 'Substandard', color: 'text-amber-700', impact: 'Poor Insight: Lack of customer engagement or market analysis. (Causes resource waste or frequent "firefighting" in production.)' },
  { range: '<50%\n>150%', score: 40, level: 'Unacceptable', color: 'text-red-600', impact: 'Negligence: Data is essentially "random guessing." (Leads to severe financial loss, massive overstock, or critical stockouts and lost orders.)' },
]

export function PerformanceView({
  years, selectedYear, selectedQuarter, monthsIso, countries, skus, forecast, achieve, channels, reviews, initialCountryCode, viewerIsAdmin,
}: {
  years: number[]
  selectedYear: number
  selectedQuarter: number
  monthsIso: string[]
  countries: Country[]
  skus: Sku[]
  forecast: ByCountrySku
  achieve: ByCountrySku
  channels: { id: number; name: string; country_id: number; sort_order: number }[]
  reviews: Record<number, Review>
  initialCountryCode: string
  viewerName: string
  viewerIsAdmin: boolean
}) {
  const router = useRouter()
  const [countryCode, setCountryCode] = useState(initialCountryCode)
  const [hideZero, setHideZero] = useState(true)
  const [tab, setTab] = useState<'kpi' | 'review'>('kpi')
  const country = useMemo(() => countries.find(c => c.code === countryCode) ?? countries[0], [countries, countryCode])
  const M = monthsIso.length
  const qLabel = `Q${selectedQuarter}`
  const go = (y: number, q: number) => router.push(`/performance?year=${y}&q=${q}&country=${countryCode}`)

  const pct = (fc: number, ach: number): number | null => (fc > 0 ? Math.round((ach / fc) * 100) : (ach > 0 ? null : 0))
  const pctText = (fc: number, ach: number) => { const p = pct(fc, ach); return p === null ? '∞' : `${p}%` }

  // Score：以 100% 为中心的对称达成率分档（90-110→100；70-89/111-130→80；50-69/131-150→60；<50/>150→40）
  // 无预测且无出货 → N/A；有出货但无预测 → 视为 >150% → 40。
  const scoreFor = (fc: number, ach: number): number | null => {
    if (fc <= 0 && ach <= 0) return null
    if (fc <= 0) return 40
    const a = Math.round((ach / fc) * 100)
    if (a >= 90 && a <= 110) return 100
    if ((a >= 70 && a <= 89) || (a >= 111 && a <= 130)) return 80
    if ((a >= 50 && a <= 69) || (a >= 131 && a <= 150)) return 60
    return 40
  }
  const scoreColor = (s: number | null) =>
    s == null ? 'text-gray-300' : s >= 100 ? 'text-emerald-700' : s >= 80 ? 'text-blue-700' : s >= 60 ? 'text-amber-700' : 'text-red-600'

  const rows = useMemo(() => {
    if (!country) return []
    const fcC = forecast[country.id] ?? {}
    const achC = achieve[country.id] ?? {}
    return skus.map(sku => {
      const fc = fcC[sku.id] ?? Array(M).fill(0)
      const ach = achC[sku.id] ?? Array(M).fill(0)
      return { sku, fc, ach, fcTot: fc.reduce((a, b) => a + b, 0), achTot: ach.reduce((a, b) => a + b, 0) }
    })
  }, [country, forecast, achieve, skus, M])

  const visible = hideZero ? rows.filter(r => r.fcTot > 0 || r.achTot > 0) : rows

  const ttl = useMemo(() => {
    const fc = Array(M).fill(0), ach = Array(M).fill(0)
    visible.forEach(r => { for (let i = 0; i < M; i++) { fc[i] += r.fc[i]; ach[i] += r.ach[i] } })
    return { fc, ach, fcTot: fc.reduce((a, b) => a + b, 0), achTot: ach.reduce((a, b) => a + b, 0) }
  }, [visible, M])

  // 折线图数据：每月 TTL 预测 vs 达成（隐藏的空 SKU 全为 0，不影响月合计）
  const chartData = useMemo(
    () => monthsIso.map((m, i) => ({ name: monthLabel(m), Forecast: ttl.fc[i] ?? 0, Achieve: ttl.ach[i] ?? 0 })),
    [monthsIso, ttl],
  )

  const td = 'px-2 py-1.5 text-right text-xs tabular-nums border-b border-gray-100'
  const th = 'px-2 py-1.5 text-center text-[11px] font-bold uppercase border-b border-gray-200'
  const numOr = (v: number) => (v > 0 ? fmtNum(v) : <span className="text-gray-300">0</span>)

  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">🏆 Performance — Quarterly KPI</h1>
        <p className="text-sm text-gray-500 mt-1">
          Forecast (cross-cycle average) vs Achieve (actual sell-in shipments) vs Attainment % · {viewerIsAdmin ? 'all countries' : 'your assigned countries only'}
        </p>
      </div>

      {/* 选择器 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex items-center gap-3 flex-wrap">
        <label className="text-sm text-gray-600 font-medium">📅 Quarter:</label>
        <select value={selectedYear} onChange={(e) => go(Number(e.target.value), selectedQuarter)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={selectedQuarter} onChange={(e) => go(selectedYear, Number(e.target.value))}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium">
          {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
        </select>

        <span className="mx-1 text-gray-300">|</span>
        <label className="text-sm text-gray-600 font-medium">🌍 Country:</label>
        <div className="flex gap-1.5 flex-wrap">
          {countries.map(c => (
            <button key={c.id} onClick={() => setCountryCode(c.code)}
              className={`px-3 py-1.5 rounded-full text-sm border transition ${c.code === countryCode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              {c.flag_emoji} {c.code}
            </button>
          ))}
        </div>

        <label className="ml-auto flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
          Hide empty SKUs
        </label>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-5 border-b border-gray-200">
        {([['kpi', '📊 KPI Scorecard'], ['review', '📝 Quarterly Review']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'kpi' && (<>
      {/* 评分标准（可折叠下拉，默认收起）*/}
      <details className="group bg-white border border-gray-200 rounded-xl mb-5">
        <summary className="list-none cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 rounded-xl [&::-webkit-details-marker]:hidden">
          <span className="text-gray-400 transition-transform group-open:rotate-90">▶</span>
          📏 Scoring standard — how the Score is calculated
          <span className="ml-1 text-xs text-gray-400 font-normal">(click to expand)</span>
        </summary>
        <div className="px-4 pb-4 pt-1 overflow-x-auto">
          <table className="w-full text-sm border-collapse" style={{ minWidth: 640 }}>
            <thead>
              <tr className="bg-teal-500 text-white text-left">
                <th className="px-3 py-2 border border-teal-600 font-semibold">Accuracy Range</th>
                <th className="px-3 py-2 border border-teal-600 font-semibold text-center">Score</th>
                <th className="px-3 py-2 border border-teal-600 font-semibold">Performance Level</th>
                <th className="px-3 py-2 border border-teal-600 font-semibold">Operational Impact &amp; Expectation</th>
              </tr>
            </thead>
            <tbody>
              {SCORE_BANDS.map(b => (
                <tr key={b.score} className="align-top">
                  <td className="px-3 py-2 border border-gray-200 font-medium whitespace-pre-line">{b.range}</td>
                  <td className={`px-3 py-2 border border-gray-200 font-bold text-center text-base ${b.color}`}>{b.score}</td>
                  <td className={`px-3 py-2 border border-gray-200 font-semibold ${b.color}`}>{b.level}</td>
                  <td className="px-3 py-2 border border-gray-200 text-gray-600 text-[13px]">{b.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-400">Accuracy = Attainment = Achieve ÷ FCST. The Score row grades the country's overall (TTL) attainment — one grade per month plus the full quarter.</p>
        </div>
      </details>

      {/* 记分卡 */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[700px]">
          <table className="text-sm border-collapse" style={{ minWidth: 1000 }}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r border-gray-200" rowSpan={2} style={{ minWidth: 90, maxWidth: 90 }}>Model</th>
                <th className="sticky top-0 z-30 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r-2 border-gray-300" rowSpan={2} style={{ left: 90, minWidth: 180, maxWidth: 180 }}>Product Name</th>
                <th className={`sticky top-0 z-20 bg-slate-100 text-slate-700 border-b border-r-2 border-gray-300 ${th}`} colSpan={M + 1}>FCST</th>
                <th className={`sticky top-0 z-20 bg-emerald-100 text-emerald-800 border-b border-r-2 border-gray-300 ${th}`} colSpan={M + 1}>Achieve</th>
                <th className={`sticky top-0 z-20 bg-amber-100 text-amber-800 border-b border-r border-gray-300 ${th}`} colSpan={M + 1}>Achieve&nbsp;%</th>
              </tr>
              <tr>
                <BlockMonths monthsIso={monthsIso} qLabel={qLabel} kind="fcst" />
                <BlockMonths monthsIso={monthsIso} qLabel={qLabel} kind="ach" />
                <BlockMonths monthsIso={monthsIso} qLabel={qLabel} kind="pct" />
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.sku.id} className="hover:bg-gray-50 group">
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-3 py-1.5 font-mono text-xs font-bold text-gray-900 border-b border-r border-gray-100" style={{ minWidth: 90, maxWidth: 90 }}>{r.sku.code}</td>
                  <td className="sticky z-10 bg-white group-hover:bg-gray-50 px-3 py-1.5 text-xs text-gray-600 border-b border-r-2 border-gray-300" style={{ left: 90, minWidth: 180, maxWidth: 180, whiteSpace: 'normal', lineHeight: '1.3' }}>{r.sku.name}</td>
                  {r.fc.map((v, i) => <td key={`f${i}`} className={`${td} bg-slate-50/40`}>{numOr(v)}</td>)}
                  <td className={`${td} font-semibold bg-slate-100 border-r-2 border-gray-300`}>{numOr(r.fcTot)}</td>
                  {r.ach.map((v, i) => <td key={`a${i}`} className={`${td} bg-emerald-50/40 text-emerald-800`}>{numOr(v)}</td>)}
                  <td className={`${td} font-semibold bg-emerald-100 text-emerald-900 border-r-2 border-gray-300`}>{numOr(r.achTot)}</td>
                  {r.fc.map((v, i) => <td key={`p${i}`} className={`${td} bg-amber-50/50 text-amber-800`}>{pctText(v, r.ach[i])}</td>)}
                  <td className={`${td} font-semibold bg-amber-100 text-amber-900`}>{pctText(r.fcTot, r.achTot)}</td>
                </tr>
              ))}
              {!visible.length && (
                <tr><td colSpan={2 + (M + 1) * 3} className="py-16 text-center text-gray-400">No forecast / shipment data for {country?.code ?? ''} in {selectedYear} {qLabel}</td></tr>
              )}
            </tbody>
            {visible.length > 0 && (
              <tfoot>
                <tr className="font-bold">
                  <td className="sticky left-0 z-10 bg-gray-100 text-gray-700 px-3 py-2 text-xs uppercase border-t-2 border-r border-gray-300" style={{ minWidth: 90, maxWidth: 90 }}>TTL</td>
                  <td className="sticky z-10 bg-gray-100 text-gray-700 px-3 py-2 text-xs border-t-2 border-r-2 border-gray-300" style={{ left: 90, minWidth: 180, maxWidth: 180 }}>All SKUs</td>
                  {ttl.fc.map((v, i) => <td key={`tf${i}`} className={`${td} border-t-2 border-gray-300 bg-slate-100 text-slate-800`}>{fmtNum(v)}</td>)}
                  <td className={`${td} border-t-2 border-r-2 border-gray-300 bg-slate-200 text-slate-900`}>{fmtNum(ttl.fcTot)}</td>
                  {ttl.ach.map((v, i) => <td key={`ta${i}`} className={`${td} border-t-2 border-gray-300 bg-emerald-100 text-emerald-900`}>{fmtNum(v)}</td>)}
                  <td className={`${td} border-t-2 border-r-2 border-gray-300 bg-emerald-200 text-emerald-900`}>{fmtNum(ttl.achTot)}</td>
                  {ttl.fc.map((v, i) => <td key={`tp${i}`} className={`${td} border-t-2 border-gray-300 bg-amber-100 text-amber-900`}>{pctText(v, ttl.ach[i])}</td>)}
                  <td className={`${td} border-t-2 border-gray-300 bg-amber-200 text-amber-900`}>{pctText(ttl.fcTot, ttl.achTot)}</td>
                </tr>
                {/* SCORE — 按 TTL 达成率分档（每月 + 整季）*/}
                <tr className="font-bold">
                  <td className="sticky left-0 z-10 bg-amber-50 text-amber-800 px-3 py-2 text-xs uppercase border-t border-r border-amber-200" style={{ minWidth: 90, maxWidth: 90 }}>Score</td>
                  <td className="sticky z-10 bg-amber-50 text-amber-600 px-3 py-2 text-[11px] border-t border-r-2 border-amber-200" style={{ left: 90, minWidth: 180, maxWidth: 180 }}>by overall attainment</td>
                  <td colSpan={(M + 1) * 2} className="border-t border-r-2 border-gray-300 bg-gray-50"></td>
                  {[...ttl.fc.map((fc, i) => scoreFor(fc, ttl.ach[i])), scoreFor(ttl.fcTot, ttl.achTot)].map((s, i, arr) => (
                    <td key={`sc${i}`} className={`px-2 py-1.5 text-right text-sm tabular-nums font-bold border-t border-gray-200 bg-amber-100 ${scoreColor(s)} ${i === arr.length - 1 ? 'border-l-2 border-amber-400' : ''}`}>
                      {s ?? '—'}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 月度 TTL 折线图：预测 vs 达成 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-5">
        <h2 className="text-sm font-semibold text-gray-700">📈 Monthly TTL — Forecast vs Achieve · {country?.flag_emoji} {country?.code} · {selectedYear} {qLabel}</h2>
        <p className="text-xs text-gray-400 mb-3">Monthly total across all SKUs — forecast vs actual shipments for this country</p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={56} tickFormatter={(v: number) => fmtNum(v)} />
            <Tooltip formatter={(v: number) => fmtNum(v)} />
            <Legend />
            <Line type="monotone" dataKey="Forecast" name="Forecast" stroke="#64748b" strokeWidth={2} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="Achieve" name="Achieve" stroke="#059669" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        FCST = average across cycles of each (country × SKU × month) forecast (summed across channels); Achieve = actual channel shipments for the same months; Achieve% = Achieve ÷ FCST; {qLabel} = sum of the three months.
      </p>
      </>)}

      {tab === 'review' && (
        <QuarterlyReview
          key={`${countryCode}-${selectedYear}-Q${selectedQuarter}`}
          channels={channels.filter(ch => ch.country_id === country?.id)}
          reviews={reviews}
          year={selectedYear}
          quarter={selectedQuarter}
          countryCode={countryCode}
          countryId={country?.id}
        />
      )}
    </div>
  )
}

function BlockMonths({ monthsIso, qLabel, kind }: { monthsIso: string[]; qLabel: string; kind: 'fcst' | 'ach' | 'pct' }) {
  const bg = kind === 'fcst' ? 'bg-slate-50 text-slate-600' : kind === 'ach' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
  const totBg = kind === 'fcst' ? 'bg-slate-100 text-slate-700' : kind === 'ach' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
  return (
    <>
      {monthsIso.map((m) => (
        <th key={`${kind}-${m}`} className={`sticky z-20 px-2 py-1.5 text-center text-[11px] font-medium border-b border-r border-gray-100 ${bg}`} style={{ top: 34 }}>{monthLabel(m)}</th>
      ))}
      <th className={`sticky z-20 px-2 py-1.5 text-center text-[11px] font-bold border-b border-r-2 border-gray-300 ${totBg}`} style={{ top: 34 }}>{qLabel}</th>
    </>
  )
}
