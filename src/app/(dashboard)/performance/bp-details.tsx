'use client'

/**
 * BP & Achievement（Annual achievement 与 Profitability 之间）。全年 BP 目标 vs 实际 PO。
 *   View by SKU  → 按季度折叠(Q1..Q4)，展开看该季各机型明细（默认展开所选季度）
 *   View by Month → 全 12 个月
 *   SI Target = BP 计划台数；SI Unit = 实际卖入台数；Value Target = BP 计划营收€；SI Value = 实际营收€
 */
import { useState } from 'react'
import { fmtNum } from '@/lib/utils'

export type BpChild = { key: string; name: string; siAct: number; valAct: number }
export type BpDetailRow = { key: string; name: string; siTgt: number; valTgt: number; siAct: number | null; valAct: number | null; children?: BpChild[] }
export type BpDetail = { skuByQuarter: BpDetailRow[][]; month: BpDetailRow[] }

const n = (v: number | null) => v == null ? '—' : fmtNum(Math.round(v))
const eur = (v: number | null) => v == null ? '—' : `€${fmtNum(Math.round(v))}`

function Ach({ a, t }: { a: number | null; t: number }) {
  if (!(t > 0) || a == null) return <span className="ml-1 text-[11px] font-extrabold text-gray-300">(—)</span>
  const r = a / t
  const c = r >= 0.9 ? 'text-emerald-600' : r >= 0.6 ? 'text-amber-600' : 'text-rose-500'
  return <span className={`ml-1 text-[11px] font-extrabold ${c}`}>({(r * 100).toFixed(0)}%)</span>
}

const sum = (rows: BpDetailRow[]) => rows.reduce((s, r) => {
  s.siTgt += r.siTgt; s.valTgt += r.valTgt; s.siAct += r.siAct ?? 0; s.valAct += r.valAct ?? 0; return s
}, { siTgt: 0, valTgt: 0, siAct: 0, valAct: 0 })

// 单行（SKU 行可展开看颜色明细；颜色行只有实际、无 BP 目标）
function Row({ r, firstColMonth }: { r: BpDetailRow; firstColMonth?: boolean }) {
  const [open, setOpen] = useState(false)
  const noAct = r.siAct == null && r.valAct == null
  const noTgt = r.siTgt <= 0 && r.valTgt <= 0
  const kids = !firstColMonth ? r.children ?? [] : []
  return (
    <>
      <tr className={`border-b border-slate-100 ${noAct ? 'text-gray-400' : ''}`}>
        <td className="text-left px-3 py-2 font-semibold whitespace-nowrap">
          {kids.length > 0 && (
            <button onClick={() => setOpen(o => !o)} className="mr-1.5 text-gray-400 hover:text-gray-700 text-[10px] align-middle" title="show colours">
              <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
            </button>
          )}
          {firstColMonth
            ? r.name
            : <><span className={noAct ? '' : 'text-gray-900'}>{r.name}</span><span className="ml-1.5 text-[11px] font-mono text-gray-400">{r.key}</span>{kids.length > 0 && <span className="ml-1.5 text-[10px] text-gray-400">· {kids.length} colours</span>}</>}
          {noTgt && !noAct && <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">· no plan</span>}
        </td>
        <td className="text-right px-3 py-2 border-l border-slate-100 text-gray-500">{r.siTgt > 0 ? n(r.siTgt) : '—'}</td>
        <td className="text-right px-3 py-2">{n(r.siAct)}<Ach a={r.siAct} t={r.siTgt} /></td>
        <td className="text-right px-3 py-2 border-l border-slate-100 text-gray-500">{r.valTgt > 0 ? eur(r.valTgt) : '—'}</td>
        <td className="text-right px-3 py-2">{eur(r.valAct)}<Ach a={r.valAct} t={r.valTgt} /></td>
      </tr>
      {open && kids.map(c => (
        <tr key={c.key} className="border-b border-slate-100 bg-slate-50/60 text-gray-500">
          <td className="text-left pl-9 pr-3 py-1.5 whitespace-nowrap">
            <span className="text-gray-600">{c.name}</span><span className="ml-1.5 text-[11px] font-mono text-gray-400">{c.key}</span>
          </td>
          <td className="text-right px-3 py-1.5 border-l border-slate-100 text-gray-300">—</td>
          <td className="text-right px-3 py-1.5">{n(c.siAct)}</td>
          <td className="text-right px-3 py-1.5 border-l border-slate-100 text-gray-300">—</td>
          <td className="text-right px-3 py-1.5">{eur(c.valAct)}</td>
        </tr>
      ))}
    </>
  )
}

const HEAD = (first: string) => (
  <thead>
    <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-500 bg-slate-50">
      <th className="text-left font-bold px-3 py-2 border-b border-slate-200">{first}</th>
      <th className="text-right font-bold px-3 py-2 border-b border-l border-slate-200">SI Target</th>
      <th className="text-right font-bold px-3 py-2 border-b border-slate-200">SI Unit <span className="text-gray-300">(ach%)</span></th>
      <th className="text-right font-bold px-3 py-2 border-b border-l border-slate-200">Value Target</th>
      <th className="text-right font-bold px-3 py-2 border-b border-slate-200">SI Value <span className="text-gray-300">(ach%)</span></th>
    </tr>
  </thead>
)

function TotalRow({ rows, label }: { rows: BpDetailRow[]; label: string }) {
  const T = sum(rows)
  return (
    <tr className="font-extrabold bg-slate-50 border-t-2 border-slate-300">
      <td className="text-left px-3 py-2">{label}</td>
      <td className="text-right px-3 py-2 border-l border-slate-200">{n(T.siTgt)}</td>
      <td className="text-right px-3 py-2">{n(T.siAct)}<Ach a={T.siAct} t={T.siTgt} /></td>
      <td className="text-right px-3 py-2 border-l border-slate-200">{eur(T.valTgt)}</td>
      <td className="text-right px-3 py-2">{eur(T.valAct)}<Ach a={T.valAct} t={T.valTgt} /></td>
    </tr>
  )
}

// 一个可折叠的季度区块
function QuarterSection({ q, year, rows, open, onToggle }: { q: number; year: number; rows: BpDetailRow[]; open: boolean; onToggle: () => void }) {
  const T = sum(rows)
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition text-left">
        <span className={`text-gray-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-sm font-bold text-gray-900">Q{q} {year}</span>
        <span className="text-[11px] text-gray-400 font-medium">{rows.length} SKUs</span>
        <span className="ml-auto text-xs tabular-nums text-gray-500">
          SI <b className="text-gray-700">{n(T.siAct)}</b>/{n(T.siTgt)} · Value <b className="text-gray-700">{eur(T.valAct)}</b>/{eur(T.valTgt)}
          <Ach a={T.valAct} t={T.valTgt} />
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <div className="py-6 text-center text-gray-400 text-sm">No BP or PO for Q{q}.</div>
          ) : (
            <table className="w-full min-w-[720px] text-sm tabular-nums border-collapse">
              {HEAD('Product')}
              <tbody>{rows.map(r => <Row key={r.key} r={r} />)}</tbody>
              <tfoot><TotalRow rows={rows} label={`Q${q} total`} /></tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export function BpDetails({ scope, quarter, year, data }: { scope: string; quarter: number; year: number; data?: BpDetail }) {
  const [view, setView] = useState<'sku' | 'month'>('sku')
  const [openQ, setOpenQ] = useState<Set<number>>(new Set([quarter]))
  const toggleQ = (q: number) => setOpenQ(prev => { const s = new Set(prev); s.has(q) ? s.delete(q) : s.add(q); return s })

  const skuByQuarter = data?.skuByQuarter ?? [[], [], [], []]
  const month = data?.month ?? []
  const hasAny = skuByQuarter.some(rs => rs.length) || month.some(m => m.siTgt || m.valTgt || m.siAct != null)

  return (
    <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl p-5 mb-5">
      <div className="flex items-baseline gap-2 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900">📋 BP &amp; Achievement</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{scope}</span>
        <span className="ml-auto text-xs text-gray-400">target = BP · actual = PO · {year} full-year</span>
      </div>

      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">View by</span>
        <div className="inline-flex bg-slate-100 border border-slate-200 rounded-lg p-0.5">
          {(['sku', 'month'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`text-xs font-semibold px-3.5 py-1.5 rounded-md transition-colors ${view === v ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {v === 'sku' ? 'SKU' : 'Month'}
            </button>
          ))}
        </div>
        {view === 'sku' && <span className="text-xs text-gray-400">grouped by quarter — click a quarter to expand</span>}
      </div>

      {!hasAny ? (
        <div className="py-8 text-center text-gray-400 text-sm">No BP or PO data for {scope} yet.</div>
      ) : view === 'sku' ? (
        <div className="flex flex-col gap-2.5">
          {[1, 2, 3, 4].map(q => (
            <QuarterSection key={q} q={q} year={year} rows={skuByQuarter[q - 1] ?? []} open={openQ.has(q)} onToggle={() => toggleQ(q)} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full min-w-[720px] text-sm tabular-nums border-collapse">
            {HEAD('Month')}
            <tbody>{month.map(r => <Row key={r.key} r={r} firstColMonth />)}</tbody>
            <tfoot><TotalRow rows={month} label="Year total" /></tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
