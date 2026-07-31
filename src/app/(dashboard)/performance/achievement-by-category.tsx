'use client'

/**
 * 分品类经营达成：BP 目标(SI Value) vs 实际经营(营收 − 运费 − BOM = GP − CN = NP)。
 * 目标来自 business_plan(月度→本季汇总)；实际来自 P&L(与 by-SKU/PO 同源)。
 */
import { useMemo } from 'react'
import { fmtNum } from '@/lib/utils'

export type PnlCatRow = {
  category: string
  qty: number
  revenue: number
  log: number
  bom: number
  logPos: number
  cn: number
  target: number   // BP SI Value 目标(本季)
}

const eur = (v: number) => `€${fmtNum(Math.round(v))}`
const pct = (v: number, base: number) => (base > 0 ? `${(v / base * 100).toFixed(1)}%` : '—')
const eurPct = (v: number, base: number) => (
  <>{eur(v)} <span className="font-normal text-gray-400">({pct(v, base)})</span></>
)

export function AchievementByCategory({ rows, periodLabel, bare = false }: { rows: PnlCatRow[]; periodLabel: string; bare?: boolean }) {
  const gp = (r: PnlCatRow) => r.revenue - r.log - r.bom
  const np = (r: PnlCatRow) => gp(r) - r.cn
  const ttl = useMemo(() => rows.reduce((a, r) => ({
    target: a.target + r.target, revenue: a.revenue + r.revenue, log: a.log + r.log, bom: a.bom + r.bom, cn: a.cn + r.cn,
  }), { target: 0, revenue: 0, log: 0, bom: 0, cn: 0 }), [rows])
  const ttlGp = ttl.revenue - ttl.log - ttl.bom, ttlNp = ttlGp - ttl.cn
  const pending = <span className="text-gray-300">—</span>
  const achPill = (a: number, t: number) => t <= 0 ? '' : a / t >= 0.9 ? 'bg-emerald-100 text-emerald-700' : a / t >= 0.6 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'

  return (
    <div className={bare ? '' : 'mt-8 pt-6 border-t border-gray-200'}>
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900">🗂️ Achievement by category</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">BP target vs actual P&amp;L</span>
        <span className="ml-auto text-xs text-gray-400">{periodLabel}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4"><b>BP Target</b> = business-plan SI Value (SI × FD buying price, same basis as actual revenue). <b>Achieve %</b> = actual revenue ÷ target. Then the operating result: revenue − freight − BOM = GP, − CN = NP.</p>

      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full text-sm border-collapse tabular-nums" style={{ minWidth: 860 }}>
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-gray-600">Category</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-blue-700">BP Target</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Actual Rev</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-blue-700">Achieve %</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Freight</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-emerald-700">GP (GP %)</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">CN</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">NP (NP %)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.category} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 text-left font-medium text-gray-800 border-b border-gray-100 whitespace-nowrap">{r.category === '(uncat)' || r.category === 'Other' ? <span className="text-gray-400">{r.category}</span> : r.category}</td>
                <td className="px-3 py-2 text-right text-blue-700 border-b border-gray-100">{r.target > 0 ? eur(r.target) : pending}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900 border-b border-gray-100">{eur(r.revenue)}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{r.target > 0 ? <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${achPill(r.revenue, r.target)}`}>{pct(r.revenue, r.target)}</span> : pending}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{r.logPos > 0 ? eur(r.log) : pending}</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700 border-b border-gray-100">{eurPct(gp(r), r.revenue)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{r.cn > 0 ? eur(r.cn) : pending}</td>
                <td className="px-3 py-2 text-right font-bold text-gray-900 border-b border-gray-100">{eurPct(np(r), r.revenue - r.cn)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-10 text-center text-gray-400">No data for {periodLabel}</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-bold bg-gray-50">
                <td className="px-3 py-2 text-left text-gray-800 border-t-2 border-gray-300">Total</td>
                <td className="px-3 py-2 text-right text-blue-700 border-t-2 border-gray-300">{ttl.target > 0 ? eur(ttl.target) : pending}</td>
                <td className="px-3 py-2 text-right text-gray-900 border-t-2 border-gray-300">{eur(ttl.revenue)}</td>
                <td className="px-3 py-2 text-right text-blue-700 border-t-2 border-gray-300">{pct(ttl.revenue, ttl.target)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-t-2 border-gray-300">{eur(ttl.log)}</td>
                <td className="px-3 py-2 text-right text-emerald-700 border-t-2 border-gray-300">{eurPct(ttlGp, ttl.revenue)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-t-2 border-gray-300">{ttl.cn > 0 ? eur(ttl.cn) : pending}</td>
                <td className="px-3 py-2 text-right text-gray-900 border-t-2 border-gray-300">{eurPct(ttlNp, ttl.revenue - ttl.cn)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">BP target only on the 4 planned categories; <b>(uncat)/Other</b> = actuals with no BP category (Bundle, uncategorised, non-product CN). PL H1 has no plan → target blank.</p>
    </div>
  )
}
