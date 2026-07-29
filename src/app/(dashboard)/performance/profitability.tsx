'use client'

/**
 * Profitability (P&L) — Quarterly Review 第二个模块。
 *
 * 口径链：营收(Revenue) − BOM − 运费(Freight) = 毛利(GP) − CN(Credit Note) = 净利(NP)
 *
 * Step 1（当前）：只做「每个国家的总体经营情况」。
 *   - Revenue = channel_po 的 turnover（单价×数量），按 PO Date 落在选中季度，折算成 EUR。真实。
 *   - Freight = po_freight 的实际运费（部分 PO 才有），折算成 EUR。真实但覆盖不全（标注覆盖率）。
 *   - BOM / GP / CN / NP = 占位「待补」——BOM 成本清单和 CN 数据到位后点亮。
 * Step 2（以后）：下钻到 KA / SKU 级的具体经营。
 */

import { useMemo, useState } from 'react'
import { fmtNum } from '@/lib/utils'

export type PnlRow = {
  code: string
  flag: string
  name: string
  pos: number
  units: number
  revenue: number    // EUR
  freight: number    // EUR（仅有运费记录的 PO 之和）
  freightPos: number // 有运费记录的 PO 数
  bom: number        // EUR（BOM 成本，实时 CNY→EUR；不单独展示，仅参与 GP）
}

const eur = (v: number) => `€${fmtNum(Math.round(v))}`
const pctText = (v: number, base: number) => (base > 0 ? `${(v / base * 100).toFixed(1)}%` : '—')

export function ProfitabilityPanel({ rows, periodLabel, scope = 'All countries', isAll = true }: { rows: PnlRow[]; periodLabel: string; scope?: string; isAll?: boolean }) {
  const ttl = useMemo(() => rows.reduce(
    (a, r) => ({
      pos: a.pos + r.pos, units: a.units + r.units,
      revenue: a.revenue + r.revenue, freight: a.freight + r.freight, freightPos: a.freightPos + r.freightPos, bom: a.bom + r.bom,
    }),
    { pos: 0, units: 0, revenue: 0, freight: 0, freightPos: 0, bom: 0 },
  ), [rows])

  const pending = <span className="text-gray-300" title="待补数据">—</span>
  const cov = (fp: number, p: number) => (p > 0 ? Math.round((fp / p) * 100) : 0)
  const gpOf = (r: { revenue: number; freight: number; bom: number }) => r.revenue - r.freight - r.bom
  const ttlGp = gpOf(ttl)

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900">💶 Profitability <span className="text-gray-400 font-medium text-base">(P&amp;L)</span></h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{isAll ? 'Overall by country' : scope}</span>
        <span className="ml-auto text-xs text-gray-400">{periodLabel}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Revenue − Freight − product cost = <b>Gross Profit</b> · GP − Credit Notes = <b>Net Profit</b>. Revenue, freight and <b>GP are live</b> (product cost from BOM, converted at the live CNY→EUR rate); NP lights up once credit-note data are loaded.
      </p>

      {/* P&L 链条 KPI 条（BOM 参与 GP 计算但不单独展示）*/}
      <div className="flex gap-2 items-stretch overflow-x-auto pb-1 mb-4">
        <Tile label="Revenue" value={eur(ttl.revenue)} sub={`${ttl.pos} POs · ${fmtNum(ttl.units)} units`} />
        <Op>−</Op>
        <Tile label="Freight" cost value={eur(ttl.freight)} sub={`${cov(ttl.freightPos, ttl.pos)}% of POs`} />
        <Op>=</Op>
        <Tile label="Gross Profit" gp value={eur(ttlGp)} sub={`GP ${pctText(ttlGp, ttl.revenue)}`} />
        <Op>−</Op>
        <Tile label="Credit Notes" cost pendingTag />
        <Op>=</Op>
        <Tile label="Net Profit" np pendingTag />
      </div>

      {/* 分国家明细 */}
      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 760 }}>
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Country</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">POs</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Units</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Revenue</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Freight</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-emerald-700">GP</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-emerald-700">GP %</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-gray-400">CN</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-gray-400">NP</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map(r => (
              <tr key={r.code} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 text-left font-medium text-gray-800 border-b border-gray-100 whitespace-nowrap">{r.flag} {r.code} <span className="text-gray-400 font-normal">{r.name}</span></td>
                <td className="px-3 py-2 text-right text-gray-600 border-b border-gray-100">{r.pos}</td>
                <td className="px-3 py-2 text-right text-gray-600 border-b border-gray-100">{fmtNum(r.units)}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900 border-b border-gray-100">{eur(r.revenue)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">
                  {r.freightPos > 0 ? eur(r.freight) : pending}
                  {r.freightPos > 0 && r.freightPos < r.pos && <span className="ml-1 text-[10px] text-gray-400">({r.freightPos}/{r.pos})</span>}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700 border-b border-gray-100">{eur(gpOf(r))}</td>
                <td className="px-3 py-2 text-right text-emerald-700 border-b border-gray-100">{pctText(gpOf(r), r.revenue)}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={9} className="py-12 text-center text-gray-400">No PO revenue in {periodLabel}</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-bold bg-gray-50">
                <td className="px-3 py-2 text-left text-gray-800 border-t-2 border-gray-300">Total</td>
                <td className="px-3 py-2 text-right text-gray-700 border-t-2 border-gray-300">{ttl.pos}</td>
                <td className="px-3 py-2 text-right text-gray-700 border-t-2 border-gray-300">{fmtNum(ttl.units)}</td>
                <td className="px-3 py-2 text-right text-gray-900 border-t-2 border-gray-300">{eur(ttl.revenue)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-t-2 border-gray-300">{ttl.freightPos > 0 ? eur(ttl.freight) : pending}</td>
                <td className="px-3 py-2 text-right text-emerald-700 border-t-2 border-gray-300">{eur(ttlGp)}</td>
                <td className="px-3 py-2 text-right text-emerald-700 border-t-2 border-gray-300">{pctText(ttlGp, ttl.revenue)}</td>
                <td className="px-3 py-2 text-right border-t-2 border-gray-300">{pending}</td>
                <td className="px-3 py-2 text-right border-t-2 border-gray-300">{pending}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400 leading-relaxed">
        <b className="text-gray-500">Revenue</b> = PO units × unit price (turnover), by PO date, converted to EUR (PLN/CNY via live ECB rate). ·
        <b className="text-gray-500"> Freight</b> = actual delivery fee from the Shipment Workflow, converted to EUR — currently on a subset of POs (coverage shown). ·
        <b className="text-gray-500"> GP</b> = Revenue − Freight − BOM (BOM in RMB → EUR at live rate; not shown separately). Where freight coverage &lt; 100%, GP is slightly overstated by the missing fees. ·
        <b className="text-gray-500 text-rose-500"> CN / NP</b> = pending on the credit-note feed. Step 2 will drill Country → KA → SKU.
      </p>
    </div>
  )
}

// ── 按机型(product)的 P&L 明细：Model | SI Qty | SI Value | log | BOM | GP | GP% | Cost(CN) | NP | NP% ──
export type PnlModelRow = { model: string; name: string; qty: number; value: number }
type SortKey = 'qty' | 'value'

export function ProfitabilityByModel({ rows, periodLabel }: { rows: PnlModelRow[]; periodLabel: string }) {
  const [sort, setSort] = useState<SortKey>('value')
  const sorted = useMemo(() => [...rows].sort((a, b) => b[sort] - a[sort]), [rows, sort])
  const ttl = useMemo(() => rows.reduce((a, r) => ({ qty: a.qty + r.qty, value: a.value + r.value }), { qty: 0, value: 0 }), [rows])
  const pending = <span className="text-gray-300" title="待补数据">—</span>

  const ArrowTh = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th onClick={() => setSort(k)}
      className={`px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 cursor-pointer select-none hover:text-gray-800 ${sort === k ? 'text-blue-700' : 'text-gray-600'}`}>
      {children} <span className={sort === k ? 'opacity-100' : 'opacity-25'}>▾</span>
    </th>
  )
  const DimTh = ({ children }: { children: React.ReactNode }) => (
    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-gray-400">{children}</th>
  )

  return (
    <div className="mt-8 pt-6 border-t border-gray-200">
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900">📦 P&amp;L by model</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">By product · all countries</span>
        <span className="ml-auto text-xs text-gray-400">{periodLabel}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">Per product (colour SKUs merged). SI Qty and SI Value are live; the rest light up once BOM / logistics / CN data is loaded. Click a header to sort.</p>

      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 900 }}>
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-gray-600">Model</th>
              <ArrowTh k="qty">SI Qty</ArrowTh>
              <ArrowTh k="value">SI Value</ArrowTh>
              <DimTh>log</DimTh>
              <DimTh>GP</DimTh>
              <DimTh>GP %</DimTh>
              <DimTh>Cost (CN)</DimTh>
              <DimTh>NP</DimTh>
              <DimTh>NP %</DimTh>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {sorted.map(r => (
              <tr key={r.model} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 text-left border-b border-gray-100 whitespace-nowrap">
                  <span className="font-medium text-gray-800">{r.name}</span>
                  <span className="ml-2 text-[11px] font-mono text-gray-400">{r.model}</span>
                </td>
                <td className="px-3 py-2 text-right text-gray-700 border-b border-gray-100">{fmtNum(r.qty)}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900 border-b border-gray-100">{eur(r.value)}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
              </tr>
            ))}
            {!sorted.length && (
              <tr><td colSpan={9} className="py-12 text-center text-gray-400">No PO revenue in {periodLabel}</td></tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="font-bold bg-gray-50">
                <td className="px-3 py-2 text-left text-gray-800 border-t-2 border-gray-300">TTL · {sorted.length} models</td>
                <td className="px-3 py-2 text-right text-gray-700 border-t-2 border-gray-300">{fmtNum(ttl.qty)}</td>
                <td className="px-3 py-2 text-right text-gray-900 border-t-2 border-gray-300">{eur(ttl.value)}</td>
                <td className="px-3 py-2 text-right border-t-2 border-gray-300" colSpan={6}>{pending}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* 公式说明（按手绘口径）*/}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
        <span><b className="text-gray-700">GP</b> = SI Value − log − product cost &nbsp;·&nbsp; <b className="text-gray-700">GP %</b> = GP ÷ SI Value</span>
        <span><b className="text-gray-700">NP</b> = GP − CN &nbsp;·&nbsp; <b className="text-gray-700">NP %</b> = NP ÷ (SI Value − CN)</span>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, cost, gp, np, pendingTag }: {
  label: string; value?: string; sub?: string; cost?: boolean; gp?: boolean; np?: boolean; pendingTag?: boolean
}) {
  const base = 'flex-1 min-w-[128px] rounded-xl border p-3'
  const cls = np ? `${base} bg-emerald-600 border-transparent text-white`
    : gp ? `${base} bg-emerald-50 border-transparent`
    : cost ? `${base} bg-rose-50 border-transparent`
    : `${base} bg-white border-gray-200`
  const labelCls = np ? 'text-white/85' : gp ? 'text-emerald-700' : cost ? 'text-rose-700' : 'text-gray-500'
  const valCls = np ? 'text-white' : gp ? 'text-emerald-700' : cost ? 'text-rose-700' : 'text-gray-900'
  return (
    <div className={cls}>
      <div className={`text-[11px] font-bold uppercase tracking-wide ${labelCls}`}>{label}</div>
      {pendingTag
        ? <div className="text-sm font-semibold mt-1 text-gray-300">待补 · pending</div>
        : <div className={`text-xl font-bold mt-0.5 tabular-nums ${valCls}`}>{value}</div>}
      {sub && !pendingTag && <div className={`text-[11px] mt-0.5 ${np ? 'text-white/80' : 'text-gray-400'}`}>{sub}</div>}
    </div>
  )
}
function Op({ children }: { children: React.ReactNode }) {
  return <div className="flex-none self-center text-lg font-bold text-gray-300 px-0.5">{children}</div>
}
