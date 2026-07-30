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
  cn: number         // EUR（Credit Note，实时折算）
}

const eur = (v: number) => `€${fmtNum(Math.round(v))}`
const pctText = (v: number, base: number) => (base > 0 ? `${(v / base * 100).toFixed(1)}%` : '—')
// €金额 后跟 (占比%)，占比灰色小字。base 为 0 时占比显示 —
const eurPct = (v: number, base: number) => (
  <>{eur(v)} <span className="font-normal text-gray-400">({pctText(v, base)})</span></>
)

export function ProfitabilityPanel({ rows, periodLabel, scope = 'All countries', isAll = true }: { rows: PnlRow[]; periodLabel: string; scope?: string; isAll?: boolean }) {
  const ttl = useMemo(() => rows.reduce(
    (a, r) => ({
      pos: a.pos + r.pos, units: a.units + r.units,
      revenue: a.revenue + r.revenue, freight: a.freight + r.freight, freightPos: a.freightPos + r.freightPos, bom: a.bom + r.bom, cn: a.cn + r.cn,
    }),
    { pos: 0, units: 0, revenue: 0, freight: 0, freightPos: 0, bom: 0, cn: 0 },
  ), [rows])

  const pending = <span className="text-gray-300" title="待补数据">—</span>
  const cov = (fp: number, p: number) => (p > 0 ? Math.round((fp / p) * 100) : 0)
  const gpOf = (r: { revenue: number; freight: number; bom: number }) => r.revenue - r.freight - r.bom
  const npOf = (r: { revenue: number; freight: number; bom: number; cn: number }) => gpOf(r) - r.cn
  const ttlGp = gpOf(ttl), ttlNp = npOf(ttl)

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900">💶 Profitability <span className="text-gray-400 font-medium text-base">(P&amp;L)</span></h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{isAll ? 'Overall by country' : scope}</span>
        <span className="ml-auto text-xs text-gray-400">{periodLabel}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Revenue − Freight − product cost = <b>Gross Profit</b> · GP − Credit Notes = <b>Net Profit</b>. All live: product cost from BOM and CN converted at live rates. NP % is over revenue net of CN.
      </p>

      {/* P&L 链条 KPI 条（BOM 参与 GP 计算但不单独展示）*/}
      <div className="flex gap-2 items-stretch overflow-x-auto pb-1 mb-4">
        <Tile label="Revenue" value={eur(ttl.revenue)} sub={`${ttl.pos} POs · ${fmtNum(ttl.units)} units`} />
        <Op>−</Op>
        <Tile label="Freight" cost value={eur(ttl.freight)} sub={`${cov(ttl.freightPos, ttl.pos)}% of POs`} />
        <Op>=</Op>
        <Tile label="Gross Profit" gp value={eur(ttlGp)} sub={`GP ${pctText(ttlGp, ttl.revenue)}`} />
        <Op>−</Op>
        <Tile label="Credit Notes" cost value={eur(ttl.cn)} sub={`${pctText(ttl.cn, ttl.revenue)} of rev`} />
        <Op>=</Op>
        <Tile label="Net Profit" np value={eur(ttlNp)} sub={`NP ${pctText(ttlNp, ttl.revenue - ttl.cn)}`} />
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
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">Freight (%)</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-emerald-700">GP (GP %)</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">CN</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">NP (NP %)</th>
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
                  {r.freightPos > 0 ? eurPct(r.freight, r.revenue) : pending}
                  {r.freightPos > 0 && r.freightPos < r.pos && <span className="ml-1 text-[10px] text-gray-400">·{r.freightPos}/{r.pos}</span>}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700 border-b border-gray-100">{eurPct(gpOf(r), r.revenue)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{r.cn > 0 ? eur(r.cn) : pending}</td>
                <td className="px-3 py-2 text-right font-bold text-gray-900 border-b border-gray-100">{eurPct(npOf(r), r.revenue - r.cn)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400">No PO revenue in {periodLabel}</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-bold bg-gray-50">
                <td className="px-3 py-2 text-left text-gray-800 border-t-2 border-gray-300">Total</td>
                <td className="px-3 py-2 text-right text-gray-700 border-t-2 border-gray-300">{ttl.pos}</td>
                <td className="px-3 py-2 text-right text-gray-700 border-t-2 border-gray-300">{fmtNum(ttl.units)}</td>
                <td className="px-3 py-2 text-right text-gray-900 border-t-2 border-gray-300">{eur(ttl.revenue)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-t-2 border-gray-300">{ttl.freightPos > 0 ? eurPct(ttl.freight, ttl.revenue) : pending}</td>
                <td className="px-3 py-2 text-right text-emerald-700 border-t-2 border-gray-300">{eurPct(ttlGp, ttl.revenue)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-t-2 border-gray-300">{ttl.cn > 0 ? eur(ttl.cn) : pending}</td>
                <td className="px-3 py-2 text-right text-gray-900 border-t-2 border-gray-300">{eurPct(ttlNp, ttl.revenue - ttl.cn)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400 leading-relaxed">
        <b className="text-gray-500">Revenue</b> = PO units × unit price (turnover), by PO date, converted to EUR (PLN/CNY via live ECB rate). ·
        <b className="text-gray-500"> Freight</b> = actual delivery fee from the Shipment Workflow, converted to EUR — currently on a subset of POs (coverage shown). ·
        <b className="text-gray-500"> GP</b> = Revenue − Freight − BOM (BOM in RMB → EUR at live rate; not shown separately). Where freight coverage &lt; 100%, GP is slightly overstated by the missing fees. ·
        <b className="text-gray-500"> CN</b> = credit notes settled this quarter (by CN date), PLN → EUR at live rate. <b>NP</b> = GP − CN.
      </p>
    </div>
  )
}

// ── 按机型(product)的 P&L 明细：Model | SI Qty | SI Value | log | BOM | GP | GP% | Cost(CN) | NP | NP% ──
export type PnlModelRow = { model: string; name: string; qty: number; value: number; log: number; bom: number; logPos: number; cn: number; noPo?: boolean }
type SortKey = 'qty' | 'value' | 'log' | 'gp' | 'np'

const gpOfModel = (r: PnlModelRow) => r.value - r.log - r.bom
const npOfModel = (r: PnlModelRow) => gpOfModel(r) - r.cn

export function ProfitabilityByModel({ rows, cnOthers = 0, periodLabel }: { rows: PnlModelRow[]; cnOthers?: number; periodLabel: string }) {
  const [sort, setSort] = useState<SortKey>('value')
  const sortVal = (r: PnlModelRow, k: SortKey) => (k === 'gp' ? gpOfModel(r) : k === 'np' ? npOfModel(r) : r[k])
  const sorted = useMemo(() => [...rows].sort((a, b) => sortVal(b, sort) - sortVal(a, sort)), [rows, sort])
  const ttl = useMemo(() => rows.reduce((a, r) => ({ qty: a.qty + r.qty, value: a.value + r.value, log: a.log + r.log, bom: a.bom + r.bom, cn: a.cn + r.cn }), { qty: 0, value: 0, log: 0, bom: 0, cn: 0 }), [rows])
  const ttlGp = ttl.value - ttl.log - ttl.bom
  const ttlCn = ttl.cn + cnOthers                    // 含 Others 的 CN 合计
  const ttlNp = ttlGp - ttlCn                        // NP 里扣掉 Others 的 CN
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
        <h2 className="text-lg font-semibold text-gray-900">📦 P&amp;L by SKU</h2>
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Per colour SKU</span>
        <span className="ml-auto text-xs text-gray-400">{periodLabel}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">One row per SKU (colour-level), all live. GP = SI Value − log − BOM; NP = GP − CN. <b>CN</b> is recorded per model in the source, so a model's CN is split across its colour SKUs by SI-Value share (single-SKU products get 100% — exact). A product with a CN but <b>no PO this period shows as its own loss row</b> (NP = −CN, tinted red). The <b>Others</b> row holds only non-product CN (delivery fees, stock transfers…). Click a header to sort.</p>

      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 900 }}>
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide border-b border-gray-200 text-gray-600">SKU</th>
              <ArrowTh k="qty">SI Qty</ArrowTh>
              <ArrowTh k="value">SI Value</ArrowTh>
              <ArrowTh k="log">log (%)</ArrowTh>
              <ArrowTh k="gp">GP (GP %)</ArrowTh>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide border-b border-gray-200">CN</th>
              <ArrowTh k="np">NP (NP %)</ArrowTh>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {sorted.map(r => r.noPo ? (
              // 没有 PO 但有 CN → 亏损行：无营收，NP = −CN
              <tr key={r.model} className="bg-rose-50/40 hover:bg-rose-50/70">
                <td className="px-3 py-2 text-left border-b border-gray-100 whitespace-nowrap">
                  <span className="font-medium text-gray-800">{r.name}</span>
                  <span className="ml-2 text-[11px] font-mono text-gray-400">{r.model}</span>
                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-rose-600 bg-rose-100 rounded px-1.5 py-0.5">CN only · no PO</span>
                </td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{eur(r.cn)}</td>
                <td className="px-3 py-2 text-right font-bold text-rose-700 border-b border-gray-100">{eur(-r.cn)}</td>
              </tr>
            ) : (
              <tr key={r.model} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 text-left border-b border-gray-100 whitespace-nowrap">
                  <span className="font-medium text-gray-800">{r.name}</span>
                  <span className="ml-2 text-[11px] font-mono text-gray-400">{r.model}</span>
                </td>
                <td className="px-3 py-2 text-right text-gray-700 border-b border-gray-100">{fmtNum(r.qty)}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900 border-b border-gray-100">{eur(r.value)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{r.logPos > 0 ? eurPct(r.log, r.value) : pending}</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700 border-b border-gray-100">{eurPct(gpOfModel(r), r.value)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{r.cn > 0 ? eur(r.cn) : pending}</td>
                <td className="px-3 py-2 text-right font-bold text-gray-900 border-b border-gray-100">{eurPct(npOfModel(r), r.value - r.cn)}</td>
              </tr>
            ))}
            {cnOthers > 0 && (
              <tr className="bg-amber-50/40">
                <td className="px-3 py-2 text-left border-b border-gray-100">
                  <span className="font-medium text-amber-800">Others</span>
                  <span className="ml-2 text-[11px] text-gray-400">non-product CN (fees, transfers…)</span>
                </td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right border-b border-gray-100">{pending}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-b border-gray-100">{eur(cnOthers)}</td>
                <td className="px-3 py-2 text-right font-bold text-gray-900 border-b border-gray-100">{eur(-cnOthers)}</td>
              </tr>
            )}
            {!sorted.length && cnOthers <= 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">No PO revenue in {periodLabel}</td></tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="font-bold bg-gray-50">
                <td className="px-3 py-2 text-left text-gray-800 border-t-2 border-gray-300">TTL · {sorted.length} SKUs</td>
                <td className="px-3 py-2 text-right text-gray-700 border-t-2 border-gray-300">{fmtNum(ttl.qty)}</td>
                <td className="px-3 py-2 text-right text-gray-900 border-t-2 border-gray-300">{eur(ttl.value)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-t-2 border-gray-300">{ttl.log > 0 ? eurPct(ttl.log, ttl.value) : pending}</td>
                <td className="px-3 py-2 text-right text-emerald-700 border-t-2 border-gray-300">{eurPct(ttlGp, ttl.value)}</td>
                <td className="px-3 py-2 text-right text-rose-600 border-t-2 border-gray-300">{ttlCn > 0 ? eur(ttlCn) : pending}</td>
                <td className="px-3 py-2 text-right text-gray-900 border-t-2 border-gray-300">{eurPct(ttlNp, ttl.value - ttlCn)}</td>
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
