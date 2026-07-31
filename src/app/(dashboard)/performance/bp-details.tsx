'use client'

/**
 * BP details（放在 Annual achievement 与 Profitability 之间）。
 * 整年 BP 目标 vs 实际 PO，可切换「按 SKU / 按 月」。跟随顶部国家选择器。
 *   SI Target  = BP 计划台数；   SI Unit  = 实际卖入台数（达成% vs SI Target）
 *   Value Target = BP 计划营收€；SI Value = 实际营收€（达成% vs Value Target）
 * 数据来自 business_plan_detail（目标）+ channel_po（实际），口径都是 SI×FD 买价。
 */
import { useState } from 'react'
import { fmtNum } from '@/lib/utils'

export type BpDetailRow = { key: string; name: string; siTgt: number; valTgt: number; siAct: number | null; valAct: number | null }
export type BpDetail = { sku: BpDetailRow[]; month: BpDetailRow[] }
type Detail = BpDetail

const n = (v: number | null) => v == null ? '—' : fmtNum(Math.round(v))
const eur = (v: number | null) => v == null ? '—' : `€${fmtNum(Math.round(v))}`

// 达成%（带颜色）：≥90 绿 / ≥60 琥珀 / <60 玫红 / 无目标 灰
function Ach({ a, t }: { a: number | null; t: number }) {
  if (!(t > 0) || a == null) return <span className="ml-1 text-[11px] font-extrabold text-gray-300">(—)</span>
  const r = a / t
  const c = r >= 0.9 ? 'text-emerald-600' : r >= 0.6 ? 'text-amber-600' : 'text-rose-500'
  return <span className={`ml-1 text-[11px] font-extrabold ${c}`}>({(r * 100).toFixed(0)}%)</span>
}

export function BpDetails({ scope, periodLabel, data }: { scope: string; periodLabel: string; data?: Detail }) {
  const [view, setView] = useState<'sku' | 'month'>('sku')
  const rows = (view === 'sku' ? data?.sku : data?.month) ?? []
  const T = rows.reduce((s, r) => {
    s.siTgt += r.siTgt; s.valTgt += r.valTgt; s.siAct += r.siAct ?? 0; s.valAct += r.valAct ?? 0; return s
  }, { siTgt: 0, valTgt: 0, siAct: 0, valAct: 0 })

  return (
    <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl p-5 mb-5">
      <div className="flex items-baseline gap-2 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900">📋 BP details</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{scope}</span>
        <span className="ml-auto text-xs text-gray-400">target = BP · actual = PO · {periodLabel}</span>
      </div>

      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">View by</span>
        <div className="inline-flex bg-slate-100 border border-slate-200 rounded-lg p-0.5">
          {(['sku', 'month'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`text-xs font-semibold px-3.5 py-1.5 rounded-md capitalize transition-colors ${view === v ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {v === 'sku' ? 'SKU' : 'Month'}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-sm">No BP or PO data for {scope} yet.</div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full min-w-[720px] text-sm tabular-nums border-collapse">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-500 bg-slate-50">
                <th className="text-left font-bold px-3 py-2 border-b border-slate-200">{view === 'sku' ? 'Product' : 'Month'}</th>
                <th className="text-right font-bold px-3 py-2 border-b border-l border-slate-200">SI Target</th>
                <th className="text-right font-bold px-3 py-2 border-b border-slate-200">SI Unit <span className="text-gray-300">(ach%)</span></th>
                <th className="text-right font-bold px-3 py-2 border-b border-l border-slate-200">Value Target</th>
                <th className="text-right font-bold px-3 py-2 border-b border-slate-200">SI Value <span className="text-gray-300">(ach%)</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const noAct = r.siAct == null && r.valAct == null
                const noTgt = r.siTgt <= 0 && r.valTgt <= 0
                return (
                  <tr key={r.key} className={`border-b border-slate-100 ${noAct ? 'text-gray-400' : ''}`}>
                    <td className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                      {view === 'sku'
                        ? <><span className={noAct ? '' : 'text-gray-900'}>{r.name}</span><span className="ml-1.5 text-[11px] font-mono text-gray-400">{r.key}</span></>
                        : r.name}
                      {noTgt && !noAct && <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">· no plan</span>}
                    </td>
                    <td className="text-right px-3 py-2 border-l border-slate-100 text-gray-500">{r.siTgt > 0 ? n(r.siTgt) : '—'}</td>
                    <td className="text-right px-3 py-2">{n(r.siAct)}<Ach a={r.siAct} t={r.siTgt} /></td>
                    <td className="text-right px-3 py-2 border-l border-slate-100 text-gray-500">{r.valTgt > 0 ? eur(r.valTgt) : '—'}</td>
                    <td className="text-right px-3 py-2">{eur(r.valAct)}<Ach a={r.valAct} t={r.valTgt} /></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="font-extrabold bg-slate-50 border-t-2 border-slate-300">
                <td className="text-left px-3 py-2">Total</td>
                <td className="text-right px-3 py-2 border-l border-slate-200">{n(T.siTgt)}</td>
                <td className="text-right px-3 py-2">{n(T.siAct)}<Ach a={T.siAct} t={T.siTgt} /></td>
                <td className="text-right px-3 py-2 border-l border-slate-200">{eur(T.valTgt)}</td>
                <td className="text-right px-3 py-2">{eur(T.valAct)}<Ach a={T.valAct} t={T.valTgt} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
