'use client'

/**
 * Yearly Review — FY 全年商业计划(销售填的 FCST) vs 实际达成(channel_po)
 *  - FCST 来自 annual_plan（三位销售 25 年底填的 26 年预测，季度粒度）
 *  - Achievement 来自 channel_po：实际订单量，按计划单价估值成 EUR（口径统一、免 FX）
 *  - 达成% = 达成 ÷ 预测；国家胶囊 + EMEA 汇总（多国可见时）
 */

import { useMemo, useState } from 'react'

export type YAgg = {
  qty: number; val: number; gp: number; np: number; kaSi: number
  byQuarter: Record<string, { val: number; qty: number }>
  byCategory: Record<string, number>
  byKa: { name: string; val: number; qty: number }[]
  byModel: { code: string; name: string; val: number; qty: number }[]
}
export type YCountry = { code: string; name: string; flag: string; fcst: YAgg; ach: YAgg }

const QS = ['Q1', 'Q2', 'Q3', 'Q4']
const CATC: Record<string, string> = { 'Power bank': '#0071e3', 'Charger': '#c77800', 'Wireless charger': '#5e5ce6', 'Cable': '#1d7a3d' }
const money = (v: number) => { const a = Math.abs(v); const s = v < 0 ? '-€' : '€'; if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return s + Math.round(a / 1e3) + 'k'; return s + Math.round(a) }
const qty = (v: number) => (v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(Math.round(v)))
const pc = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0)
const emptyAgg = (): YAgg => ({ qty: 0, val: 0, gp: 0, np: 0, kaSi: 0, byQuarter: { Q1: { val: 0, qty: 0 }, Q2: { val: 0, qty: 0 }, Q3: { val: 0, qty: 0 }, Q4: { val: 0, qty: 0 } }, byCategory: {}, byKa: [], byModel: [] })

function mergeAgg(list: YAgg[]): YAgg {
  const out = emptyAgg()
  const kaMap = new Map<string, { name: string; val: number; qty: number }>()
  const mdMap = new Map<string, { code: string; name: string; val: number; qty: number }>()
  list.forEach(a => {
    out.qty += a.qty; out.val += a.val; out.gp += a.gp; out.np += a.np; out.kaSi += a.kaSi
    QS.forEach(q => { out.byQuarter[q].val += a.byQuarter[q]?.val ?? 0; out.byQuarter[q].qty += a.byQuarter[q]?.qty ?? 0 })
    Object.entries(a.byCategory).forEach(([k, v]) => { out.byCategory[k] = (out.byCategory[k] ?? 0) + v })
    a.byKa.forEach(k => { const e = kaMap.get(k.name) ?? { name: k.name, val: 0, qty: 0 }; e.val += k.val; e.qty += k.qty; kaMap.set(k.name, e) })
    a.byModel.forEach(m => { const e = mdMap.get(m.code) ?? { code: m.code, name: m.name, val: 0, qty: 0 }; e.val += m.val; e.qty += m.qty; mdMap.set(m.code, e) })
  })
  out.byKa = Array.from(kaMap.values()).sort((x, y) => y.val - x.val)
  out.byModel = Array.from(mdMap.values()).sort((x, y) => y.val - x.val)
  return out
}

export function YearlyReview({ year, data }: { year: number; data: YCountry[] }) {
  const hasEmea = data.length > 1
  const [sel, setSel] = useState<string>(data[0]?.code ?? 'EMEA')
  const cur = useMemo<{ fcst: YAgg; ach: YAgg; label: string }>(() => {
    if (sel === 'EMEA') return { fcst: mergeAgg(data.map(d => d.fcst)), ach: mergeAgg(data.map(d => d.ach)), label: 'EMEA' }
    const c = data.find(d => d.code === sel) ?? data[0]
    return { fcst: c.fcst, ach: c.ach, label: c.code }
  }, [sel, data])

  if (!data.length) return <div className="text-sm text-gray-500 py-10 text-center">No annual plan data for your country yet.</div>

  const { fcst, ach } = cur
  const achPct = pc(ach.val, fcst.val)
  const gap = ach.val - fcst.val
  const kaMax = Math.max(1, ...fcst.byKa.map(k => k.val))
  const mdMax = Math.max(1, ...fcst.byModel.map(m => m.val))
  const qMax = Math.max(1, ...QS.map(q => fcst.byQuarter[q]?.val ?? 0))
  const achKa = new Map(ach.byKa.map(k => [k.name, k.val]))
  const achMd = new Map(ach.byModel.map(m => [m.code, m.val]))
  const bandBg = (p: number) => (p >= 95 ? '#e7f6ec' : p >= 75 ? '#fcf3e2' : '#fbe9e8')
  const bandFg = (p: number) => (p >= 95 ? '#1d7a3d' : p >= 75 ? '#c77800' : '#c7362f')

  const cats = Object.keys(fcst.byCategory).filter(n => fcst.byCategory[n] > 0)
  const donut = (getter: (n: string) => number) => {
    const tot = cats.reduce((s, n) => s + getter(n), 0) || 1
    let off = 0
    const segs = cats.map((n, i) => { const len = (getter(n) / tot) * 100; const el = <circle key={i} r="15.915" cx="18" cy="18" fill="none" stroke={CATC[n] ?? '#ccc'} strokeWidth="5.5" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={-off} transform="rotate(-90 18 18)" />; off += len; return el })
    return { segs, tot }
  }
  const dF = donut(n => fcst.byCategory[n]); const dA = donut(n => ach.byCategory[n] ?? 0)

  const KPI = [
    { lab: 'Forecast SI', val: money(fcst.val), sub: 'INIU net · plan', col: '#86868b', hl: false },
    { lab: 'Achieved SI', val: money(ach.val), sub: 'vs forecast', col: '#0071e3', hl: true },
    { lab: 'Achievement', val: `${achPct}%`, sub: ach.val >= fcst.val ? 'on / above target' : 'below target · YTD', col: ach.val >= fcst.val ? '#1d7a3d' : '#c7362f', hl: true },
    { lab: 'Forecast Qty', val: `${qty(fcst.qty)} u`, sub: 'units planned', col: '#86868b', hl: false },
    { lab: 'Achieved Qty', val: `${qty(ach.qty)} u`, sub: `${pc(ach.qty, fcst.qty)}% attained`, col: '#0071e3', hl: false },
    { lab: 'Gap to Target', val: money(gap), sub: gap >= 0 ? 'ahead' : 'shortfall', col: gap >= 0 ? '#1d7a3d' : '#c7362f', hl: false },
  ]

  const panel = 'bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_18px_rgba(0,0,0,0.04)]'
  const bars = (list: { name?: string; code?: string; label: string; val: number }[], max: number, achLookup: Map<string, number>, fc1: string, fc2: string) => (
    <div className="flex flex-col gap-2.5">
      {list.map((it, i) => {
        const av = achLookup.get(it.name ?? it.code ?? '') ?? 0
        const p = pc(av, it.val)
        return (
          <div key={i} className="flex items-center gap-2.5 text-xs">
            <span className="w-20 font-semibold truncate flex-shrink-0" title={it.label}>{it.label}</span>
            <div className="flex-1 h-[18px] bg-black/[0.035] rounded-md overflow-hidden">
              <div className="h-full rounded-md relative" style={{ width: `${Math.max(8, (100 * it.val) / max)}%`, background: fc1 }}>
                <div className="h-full rounded-md absolute left-0 top-0" style={{ width: `${Math.min(100, (100 * av) / (it.val || 1))}%`, background: fc2 }} />
              </div>
            </div>
            <span className="w-10 text-right font-bold tabular-nums flex-shrink-0" style={{ color: bandFg(p) }}>{p}%</span>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-3">
      {/* country pills + badge */}
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="inline-flex bg-black/[0.05] rounded-[11px] p-[3px]">
          {data.map(d => (
            <button key={d.code} onClick={() => setSel(d.code)}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${sel === d.code ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {d.flag} {d.name}
            </button>
          ))}
          {hasEmea && (
            <button onClick={() => setSel('EMEA')}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${sel === 'EMEA' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>🌍 EMEA</button>
          )}
        </div>
        <span className="text-xs font-semibold text-gray-500 bg-white border border-black/[0.06] px-2.5 py-1.5 rounded-full">FY {year} · {cur.label} · Forecast vs Achievement</span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
        {KPI.map((k, i) => (
          <div key={i} className={`rounded-2xl border p-3 ${k.hl ? 'border-[#cfe3fb] bg-gradient-to-b from-white to-[#f4f9ff]' : 'border-black/[0.06] bg-white'}`}>
            <div className="text-[11px] text-gray-500 font-semibold">{k.lab}</div>
            <div className="text-[21px] font-bold tracking-tight mt-1 leading-none">{k.val}</div>
            <div className="text-[11px] font-semibold mt-1.5" style={{ color: k.col }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* quarterly + category */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.45fr_1fr] gap-3">
        <div className={`${panel} p-4`}>
          <h3 className="text-[13.5px] font-bold mb-3">Quarterly Achievement <span className="font-medium text-gray-500 text-xs">· Forecast vs Achieved · % attained</span></h3>
          <div className="flex items-end gap-3.5 h-[152px] px-1">
            {QS.map(q => {
              const f = fcst.byQuarter[q]?.val ?? 0; const a = ach.byQuarter[q]?.val ?? 0; const p = pc(a, f)
              return (
                <div key={q} className="flex-1 flex flex-col items-center gap-1.5 h-full">
                  <div className="flex items-end gap-1.5 flex-1 w-full justify-center">
                    <div className="w-[26px] rounded-t-md relative" style={{ height: `${(82 * f) / qMax}%`, background: '#cfe3fb' }}>
                      <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-gray-500 whitespace-nowrap">{money(f)}</span>
                    </div>
                    <div className="w-[26px] rounded-t-md" style={{ height: `${(82 * a) / qMax}%`, background: '#0071e3' }} />
                  </div>
                  <div className="text-[11px] font-bold">{q}</div>
                  <span className="text-[10px] font-bold px-1.5 py-px rounded-full" style={{ color: bandFg(p), background: bandBg(p) }}>{p}%</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-3.5 mt-2 text-[11px] text-gray-500 font-semibold justify-center">
            <span><i className="inline-block w-2.5 h-2.5 rounded-[3px] mr-1.5 align-[-1px]" style={{ background: '#cfe3fb' }} />Forecast</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-[3px] mr-1.5 align-[-1px]" style={{ background: '#0071e3' }} />Achieved</span>
          </div>
        </div>

        <div className={`${panel} p-4`}>
          <h3 className="text-[13.5px] font-bold mb-3">Category Mix <span className="font-medium text-gray-500 text-xs">· FCST vs Achieved</span></h3>
          <div className="flex gap-2 justify-center mb-2">
            {[['Forecast', dF], ['Achieved', dA]].map(([lab, d]: any) => (
              <div key={lab} className="flex flex-col items-center gap-0.5">
                <svg viewBox="0 0 36 36" width="96" height="96">{d.segs}<text x="18" y="19.5" textAnchor="middle" fontSize="4.6" fontWeight="700" fill="#1d1d1f">{money(d.tot)}</text></svg>
                <div className="text-[10.5px] font-bold text-gray-500">{lab}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 border-t border-black/[0.06] pt-2">
            {cats.sort((a, b) => fcst.byCategory[b] - fcst.byCategory[a]).map(n => {
              const f = fcst.byCategory[n]; const a = ach.byCategory[n] ?? 0
              return (
                <div key={n} className="flex items-center text-[11.5px] gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: CATC[n] ?? '#ccc' }} />
                  <span className="font-semibold">{n}</span>
                  <span className="ml-auto text-gray-500 font-semibold tabular-nums">{money(f)} → {money(a)} · {pc(a, f)}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* KA + model ranking */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={`${panel} p-4`}>
          <h3 className="text-[13.5px] font-bold mb-3">Top Accounts <span className="font-medium text-gray-500 text-xs">· bar = forecast · fill = achieved · %</span></h3>
          {bars(fcst.byKa.slice(0, 7).map(k => ({ name: k.name, label: k.name, val: k.val })), kaMax, achKa, '#cfe3fb', '#0071e3')}
        </div>
        <div className={`${panel} p-4`}>
          <h3 className="text-[13.5px] font-bold mb-3">Top Models <span className="font-medium text-gray-500 text-xs">· bar = forecast · fill = achieved · %</span></h3>
          {bars(fcst.byModel.slice(0, 7).map(m => ({ code: m.code, label: m.code, val: m.val })), mdMax, achMd, '#ddd6fb', '#5e5ce6')}
        </div>
      </div>

      {/* waterfall */}
      <div className={`${panel} p-4`}>
        <h3 className="text-[13.5px] font-bold mb-3">Profit Waterfall <span className="font-medium text-gray-500 text-xs">· faint = forecast · solid = achieved</span></h3>
        <div className="flex items-end gap-2.5 h-[150px] pt-[18px]">
          {[['KA SI', fcst.kaSi, ach.kaSi], ['INIU SI', fcst.val, ach.val], ['Gross Profit', fcst.gp, ach.gp], ['Net Profit', fcst.np, ach.np]].map(([lab, f, a]: any) => {
            const wmax = Math.max(fcst.kaSi, 1)
            return (
              <div key={lab} className="flex-1 flex flex-col items-center h-full justify-end gap-1.5">
                <div className="w-full max-w-[84px] rounded-md relative" style={{ height: `${(84 * f) / wmax}%`, background: '#e3edf7' }}>
                  <div className="absolute left-0 bottom-0 w-full rounded-md" style={{ height: `${Math.min(100, (100 * a) / (f || 1))}%`, background: '#0071e3' }} />
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9.5px] font-bold whitespace-nowrap text-[#0071e3]">{money(a)}</span>
                </div>
                <div className="text-[10px] font-semibold text-gray-500 text-center">{lab}</div>
              </div>
            )
          })}
        </div>
        <div className="text-[11px] text-gray-500 mt-3">ⓘ Achievement = actual channel PO quantity valued at plan unit price (EUR, YTD). Forecast from the 2026 business plan filled by each country's sales.</div>
      </div>
    </div>
  )
}
