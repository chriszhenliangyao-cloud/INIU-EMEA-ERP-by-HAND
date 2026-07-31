'use client'

/**
 * CN details（Profitability 最后一个模块）。
 * 本季每个机型(SKU)的 CN 成本，按类型拆分：Rebate / Price Protection / Margin Protection / Quality / Delivery Fee / Other。
 * 类型由 CN 源文案关键词判定（源表无独立类型字段）。金额已折 EUR。
 * 非产品 CN（无机型：调拨/参展/杂项）汇总到 Others 行。合计与 P&L 里的 CN 一致。
 */
import { useMemo, useState } from 'react'
import { fmtNum } from '@/lib/utils'

export type CnLine = { desc: string; type: string; amt: number }
export type CnSkuRow = { model: string; name: string; by: Record<string, number>; total: number; lines: CnLine[] }
export type CnBySku = { rows: CnSkuRow[]; others: Record<string, number>; othersTotal: number }

const CN_TYPES = ['Rebate', 'Price Protection', 'Margin Protection', 'Quality', 'Delivery Fee', 'Other']
const eur = (v: number) => `€${fmtNum(Math.round(v))}`

// 一个机型行：可展开看每条 CN 明细（含颜色/描述）
function CnRow({ r, cols }: { r: CnSkuRow; cols: string[] }) {
  const [open, setOpen] = useState(false)
  const lines = r.lines ?? []
  const canExpand = lines.length >= 2
  return (
    <>
      <tr className="hover:bg-gray-50/60">
        <td className="px-3 py-2 text-left border-b border-gray-100 whitespace-nowrap">
          {canExpand && (
            <button onClick={() => setOpen(o => !o)} className="mr-1.5 text-gray-400 hover:text-gray-700 text-[10px] align-middle" title="show colours / lines">
              <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
            </button>
          )}
          <span className="font-medium text-gray-800">{r.name}</span>
          <span className="ml-2 text-[11px] font-mono text-gray-400">{r.model}</span>
          {canExpand && <span className="ml-1.5 text-[10px] text-gray-400">· {lines.length} lines</span>}
        </td>
        {cols.map(ty => (
          <td key={ty} className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{r.by[ty] ? eur(r.by[ty]) : <span className="text-gray-300">—</span>}</td>
        ))}
        <td className="px-3 py-2 text-right font-bold text-rose-700 border-b border-l border-gray-100">{eur(r.total)}</td>
      </tr>
      {open && lines.map((ln, i) => (
        <tr key={i} className="bg-gray-50/60 text-gray-500">
          <td className="pl-9 pr-3 py-1.5 text-left border-b border-gray-100 whitespace-nowrap max-w-[360px] truncate" title={ln.desc}>{ln.desc}</td>
          {cols.map(ty => (
            <td key={ty} className="px-3 py-1.5 text-right border-b border-gray-100">{ln.type === ty ? <span className="text-rose-500">{eur(ln.amt)}</span> : <span className="text-gray-300">—</span>}</td>
          ))}
          <td className="px-3 py-1.5 text-right border-b border-l border-gray-100 text-rose-600">{eur(ln.amt)}</td>
        </tr>
      ))}
    </>
  )
}

export function CnBySkuTable({ data, periodLabel, scope, bare = false }: { data?: CnBySku; periodLabel: string; scope: string; bare?: boolean }) {
  const rows = data?.rows ?? []
  const others = data?.others ?? {}
  const othersTotal = data?.othersTotal ?? 0

  // 每类型合计（含 Others）
  const colTot = useMemo(() => {
    const t: Record<string, number> = {}
    for (const ty of CN_TYPES) t[ty] = rows.reduce((s, r) => s + (r.by[ty] ?? 0), 0) + (others[ty] ?? 0)
    return t
  }, [rows, others])
  // 只显示本期出现过的类型列
  const cols = CN_TYPES.filter(ty => colTot[ty] > 0)
  const grand = rows.reduce((s, r) => s + r.total, 0) + othersTotal
  const dash = <span className="text-gray-300">—</span>

  return (
    <div className={bare ? '' : 'mt-8 pt-6 border-t border-gray-200'}>
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900">🧾 Credit Notes by SKU</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">By type</span>
        <span className="ml-auto text-xs text-gray-400">{periodLabel}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Each SKU's CN cost for {scope}, split by type — <b>Rebate</b> (promotion/prototype), <b>Price&nbsp;Protection</b>, <b>Margin&nbsp;Protection</b>, <b>Quality</b> (defect reimbursement), <b>Delivery&nbsp;Fee</b>, <b>Other</b> (samples, transfers, misc). Types are read from the CN description; amounts converted to EUR (PLN → EUR at live rate). CN with no model (transfers, event fees…) sit in <b>Others</b>. The grand total matches the CN figure in the P&amp;L above.
      </p>

      {(!rows.length && othersTotal <= 0) ? (
        <div className="py-12 text-center text-gray-400 text-sm border border-gray-200 rounded-xl">No credit notes in {periodLabel}</div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm border-collapse" style={{ minWidth: 640 }}>
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-gray-600">SKU</th>
                {cols.map(ty => (
                  <th key={ty} className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-gray-600 whitespace-nowrap">{ty}</th>
                ))}
                <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-l border-gray-200 text-rose-700">Total CN</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map(r => <CnRow key={r.model} r={r} cols={cols} />)}
              {othersTotal > 0 && (
                <tr className="bg-amber-50/40">
                  <td className="px-3 py-2 text-left border-b border-gray-100">
                    <span className="font-medium text-amber-800">Others</span>
                    <span className="ml-2 text-[11px] text-gray-400">non-product CN (transfers, event fees…)</span>
                  </td>
                  {cols.map(ty => (
                    <td key={ty} className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{others[ty] ? eur(others[ty]) : dash}</td>
                  ))}
                  <td className="px-3 py-2 text-right font-bold text-rose-700 border-b border-l border-gray-100">{eur(othersTotal)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold bg-gray-50">
                <td className="px-3 py-2 text-left text-gray-800 border-t-2 border-gray-300">TTL · {rows.length} SKUs</td>
                {cols.map(ty => (
                  <td key={ty} className="px-3 py-2 text-right text-rose-600 border-t-2 border-gray-300">{colTot[ty] > 0 ? eur(colTot[ty]) : dash}</td>
                ))}
                <td className="px-3 py-2 text-right text-rose-700 border-t-2 border-l border-gray-300">{eur(grand)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
