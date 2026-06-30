'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { fmtNum } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

type FlatRow = {
  id: number
  po_date: string
  qty: number
  po_number: string | null
  ship_date: string | null
  delivery_date: string | null
  notes: string | null
  fd_buying_price: number | null
  turnover: number | null
  currency: string | null
  po_status: string | null
  delivered_qty: number | null
  sku_id: number
  sku_code: string
  sku_name: string
  sku_category: string | null
  country_id: number
  country_code: string
  country_name: string
  country_flag: string
  country_region: string
  ka_id: number | null
  ka_name: string | null
}

// 发货判定：有 ship_date 或 delivery_date 任一即视为已发（物流偶尔漏填 ship_date，用送达日兜底）
const isShipped = (r: { ship_date: string | null; delivery_date: string | null }) => !!(r.ship_date || r.delivery_date)

// 金额按原币种展示（不折算、不取整，保留真实 2 位小数）：EUR→€ · PLN→zł
const CCY_SYM: Record<string, string> = { EUR: '€', PLN: 'zł ' }

// 仅用于 Value 模式的图表把营业额统一折算成 EUR（明细列仍存原币种，不受影响）。
// 汇率由服务端每周从 ECB(frankfurter.dev) 拉取，经 page.tsx 注入 plnToEur prop；此处仅作兜底默认。
const FX_FALLBACK = 0.23
const toEUR = (turnover: number | null, currency: string | null, rate: number) =>
  turnover == null ? 0 : (currency === 'PLN' ? turnover * rate : turnover)
const fmtMoney = (v: number | null | undefined, ccy: string | null) => {
  if (v == null) return '–'
  return (ccy ? (CCY_SYM[ccy] ?? ccy + ' ') : '') +
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 低饱和度调色板（PO 色卡，shipment 也复用）
const PALETTE = ['#5b8def', '#52b788', '#9b8cce', '#e0a458', '#d98594', '#6cc3d5', '#c9a227', '#7aa095', '#b58db6', '#8a9bb0']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthShort = (ym: string) => { const m = Number(ym?.slice(5, 7)); return m ? MONTH_ABBR[m - 1] : ym }

export function PoView({ rows, viewerIsAdmin, viewerName, marketCount, plnToEur = FX_FALLBACK }: { rows: FlatRow[]; viewerIsAdmin: boolean; viewerName: string; marketCount: number; plnToEur?: number }) {
  const thisYear = String(new Date().getFullYear())

  // ===== top dashboard filters (drive KPI / charts / pills) =====
  const [dYear, setDYear] = useState<string>(thisYear)
  const [dCountry, setDCountry] = useState<string>('ALL')
  const [dKa, setDKa] = useState<string>('ALL')
  const [dMonth, setDMonth] = useState<string>('ALL')
  // 月度图 / 客户排名各自的口径：volume(数量) 或 value(turnover 营业额)
  const [monthMetric, setMonthMetric] = useState<'volume' | 'value'>('volume')
  const [rankMetric, setRankMetric] = useState<'volume' | 'value'>('volume')
  const [skuMetric, setSkuMetric] = useState<'volume' | 'value'>('volume')

  // ===== aggregation table filters (independent — only control the detail table) =====
  const [tYear, setTYear] = useState<string>(thisYear)
  const [tCountry, setTCountry] = useState<string>('ALL')
  const [tMonth, setTMonth] = useState<string>('ALL')
  const [tSku, setTSku] = useState<string>('ALL')
  const [tKa, setTKa] = useState<string>('ALL')
  const [tCat, setTCat] = useState<string>('ALL')
  const [tSearch, setTSearch] = useState<string>('')
  const [sortCol, setSortCol] = useState<string>('month')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const dashExceptCountry = useMemo(() => rows.filter(r => {
    if (dYear !== 'ALL' && (r.po_date?.slice(0, 4) ?? '') !== dYear) return false
    if (dMonth !== 'ALL' && (r.po_date?.slice(0, 7) ?? '') !== dMonth) return false
    if (dKa !== 'ALL' && r.ka_name !== dKa) return false
    return true
  }), [rows, dYear, dMonth, dKa])

  const dashFiltered = useMemo(() => (
    dCountry === 'ALL' ? dashExceptCountry : dashExceptCountry.filter(r => r.country_code === dCountry)
  ), [dashExceptCountry, dCountry])

  const dashExceptMonth = useMemo(() => rows.filter(r => {
    if (dYear !== 'ALL' && (r.po_date?.slice(0, 4) ?? '') !== dYear) return false
    if (dCountry !== 'ALL' && r.country_code !== dCountry) return false
    if (dKa !== 'ALL' && r.ka_name !== dKa) return false
    return true
  }), [rows, dYear, dCountry, dKa])

  // 顶部 KA 下拉选项：随所选国家收窄
  const kaOptionsTop = useMemo(() => Array.from(new Set(
    rows.filter(r => (dCountry === 'ALL' || r.country_code === dCountry) && r.ka_name).map(r => r.ka_name as string)
  )).sort(), [rows, dCountry])

  // ===== KPI =====
  const kaNames = useMemo(() => Array.from(new Set(dashFiltered.filter(r => r.ka_name).map(r => r.ka_name as string))).sort(), [dashFiltered])
  const stats = useMemo(() => {
    const totalQty = dashFiltered.reduce((s, r) => s + r.qty, 0)
    const poCount = new Set(dashFiltered.filter(r => r.po_number).map(r => r.po_number)).size
    const skuCount = new Set(dashFiltered.map(r => r.sku_code)).size
    const totalValueEUR = dashFiltered.reduce((s, r) => s + toEUR(r.turnover, r.currency, plnToEur), 0)
    return { totalQty, poCount, skuCount, totalValueEUR }
  }, [dashFiltered, plnToEur])

  const options = useMemo(() => ({
    months: Array.from(new Set(rows.map(r => r.po_date?.slice(0, 7) ?? ''))).filter(Boolean).sort().reverse(),
    skus: Array.from(new Set(rows.map(r => r.sku_code))).sort(),
    kas: Array.from(new Set(rows.filter(r => r.ka_name).map(r => r.ka_name as string))).sort(),
    cats: Array.from(new Set(rows.map(r => r.sku_category).filter(Boolean) as string[])).sort(),
    years: Array.from(new Set(rows.map(r => r.po_date?.slice(0, 4) ?? ''))).filter(Boolean).sort().reverse(),
    countries: Array.from(new Set(rows.map(r => r.country_code))).sort(),
  }), [rows])

  const countryMeta = useMemo(() => {
    const map: Record<string, { flag: string; name: string; qty: number }> = {}
    rows.forEach(r => { if (!map[r.country_code]) map[r.country_code] = { flag: r.country_flag, name: r.country_name, qty: 0 } })
    dashExceptCountry.forEach(r => { if (map[r.country_code]) map[r.country_code].qty += r.qty })
    return map
  }, [rows, dashExceptCountry])

  const countryCodes = Object.keys(countryMeta)
  const currentCountryLabel = (() => {
    if (dCountry !== 'ALL') return countryMeta[dCountry]?.name ?? dCountry
    if (viewerIsAdmin) return 'EU'
    if (countryCodes.length === 1) return Object.values(countryMeta)[0]?.name ?? countryCodes[0]
    return Object.entries(countryMeta).sort((a, b) => b[1].qty - a[1].qty).map(([_, m]) => m.name).join(' + ')
  })()

  // ===== monthly chart: single bar by month, OR grouped bars by KA when a single country with >1 KA is selected =====
  const monthlyChart = useMemo(() => {
    const pick = (r: FlatRow) => monthMetric === 'value' ? toEUR(r.turnover, r.currency, plnToEur) : r.qty
    const grouped = dCountry !== 'ALL' && kaNames.length > 1
    if (!grouped) {
      const m: Record<string, number> = {}
      dashFiltered.forEach(r => { const ym = r.po_date?.slice(0, 7) ?? ''; if (ym) m[ym] = (m[ym] ?? 0) + pick(r) })
      return { grouped: false, kas: [] as string[], data: Object.entries(m).sort().map(([month, qty]) => ({ month: monthShort(month), qty })) }
    }
    const byMonth: Record<string, any> = {}
    dashFiltered.forEach(r => {
      const ym = r.po_date?.slice(0, 7) ?? ''; if (!ym) return
      const ka = r.ka_name ?? 'Unspecified'
      byMonth[ym] ??= { _ym: ym, month: monthShort(ym) }
      byMonth[ym][ka] = (byMonth[ym][ka] ?? 0) + pick(r)
    })
    const data = Object.values(byMonth).sort((a: any, b: any) => a._ym.localeCompare(b._ym))
    return { grouped: true, kas: kaNames, data }
  }, [dashFiltered, dCountry, kaNames, monthMetric, plnToEur])

  const topKas = useMemo(() => {
    const pick = (r: FlatRow) => rankMetric === 'value' ? toEUR(r.turnover, r.currency, plnToEur) : r.qty
    const m: Record<string, number> = {}
    dashFiltered.forEach(r => { const name = r.ka_name ?? 'Unspecified'; m[name] = (m[name] ?? 0) + pick(r) })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, qty]) => ({ name, qty }))
  }, [dashFiltered, rankMetric, plnToEur])
  const rankTotal = topKas.reduce((s, r) => s + r.qty, 0) || 1

  // 图表数值格式：Value 模式 = 折算后的 EUR 金额（€ 前缀、整数欧元）；Volume = 原数量
  const fmtMonthVal = (v: number) => monthMetric === 'value' ? '€' + fmtNum(Math.round(v)) : fmtNum(v)
  const fmtRankVal = (v: number) => rankMetric === 'value' ? '€' + fmtNum(Math.round(v)) : fmtNum(v)
  const fmtSkuVal = (v: number) => skuMetric === 'value' ? '€' + fmtNum(Math.round(v)) : fmtNum(v)

  // Volume / Value 切换标签 —— iOS 玻璃分段控件：磨砂半透轨道 + 白玻璃滑块
  const metricTag = (cur: 'volume' | 'value', set: (v: 'volume' | 'value') => void) => (
    <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-white/60 bg-gray-500/10 p-0.5 text-[11px] font-semibold backdrop-blur-md flex-shrink-0">
      {(['volume', 'value'] as const).map(m => (
        <button key={m} onClick={() => set(m)}
          className={`rounded-[7px] px-2.5 py-1 transition-all ${cur === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
          {m === 'volume' ? 'Volume' : 'Value'}
        </button>
      ))}
    </div>
  )

  // 未发货 PO（无 ship_date 且无 delivery_date）— 独立于上方筛选，列出全部待跟进
  // 待发：未发货 且 未被手动标记（cancelled/partial 已被处理，移到各自的表）
  const byDateDesc = (a: FlatRow, b: FlatRow) => (b.po_date ?? '').localeCompare(a.po_date ?? '')
  const unshipped = useMemo(() => rows.filter(r => !isShipped(r) && !r.po_status).sort(byDateDesc), [rows])
  const cancelledRows = useMemo(() => rows.filter(r => r.po_status === 'cancelled').sort(byDateDesc), [rows])
  const partialRows = useMemo(() => rows.filter(r => r.po_status === 'partial').sort(byDateDesc), [rows])

  const skuTrend = useMemo(() => {
    const pick = (r: FlatRow) => skuMetric === 'value' ? toEUR(r.turnover, r.currency, plnToEur) : r.qty
    const m: Record<string, { name: string; qty: number }> = {}
    dashFiltered.forEach(r => { const e = (m[r.sku_code] ??= { name: r.sku_name || r.sku_code, qty: 0 }); e.qty += pick(r) })
    return Object.entries(m).sort((a, b) => b[1].qty - a[1].qty).map(([code, v]) => ({ code, name: v.name, qty: v.qty }))
  }, [dashFiltered, skuMetric, plnToEur])

  // ===== aggregation table (independent) =====
  const tableFiltered = useMemo(() => rows.filter(r => {
    if (tYear !== 'ALL' && (r.po_date?.slice(0, 4) ?? '') !== tYear) return false
    if (tCountry !== 'ALL' && r.country_code !== tCountry) return false
    if (tMonth !== 'ALL' && (r.po_date?.slice(0, 7) ?? '') !== tMonth) return false
    if (tSku !== 'ALL' && r.sku_code !== tSku) return false
    if (tKa !== 'ALL' && r.ka_name !== tKa) return false
    if (tCat !== 'ALL' && r.sku_category !== tCat) return false
    if (tSearch) {
      const s = tSearch.toLowerCase()
      if (!r.sku_code?.toLowerCase().includes(s) && !r.sku_name?.toLowerCase().includes(s) &&
          !r.ka_name?.toLowerCase().includes(s) && !r.po_number?.toLowerCase().includes(s)) return false
    }
    return true
  }), [rows, tYear, tCountry, tMonth, tSku, tKa, tCat, tSearch])

  type AggRow = { month: string; sku_code: string; sku_name: string; ka_name: string; country_code: string; country_flag: string; category: string | null; qty: number; count: number; shipped: number; rescued: number; turnover: number; currency: string | null; fdPrice: number | null }
  // 靠 delivery_date 兜底的行（有送达日但 ship_date 为空）
  const rescuedBy = (r: FlatRow) => !r.ship_date && !!r.delivery_date
  const aggRows = useMemo<AggRow[]>(() => {
    const map = new Map<string, AggRow>()
    tableFiltered.forEach(r => {
      const ym = r.po_date?.slice(0, 7) ?? ''
      const ka = r.ka_name ?? '-'
      const key = `${ym}|${r.sku_code}|${ka}|${r.country_code}`
      const ex = map.get(key)
      if (ex) {
        ex.qty += r.qty; ex.count += 1; if (isShipped(r)) ex.shipped += 1; if (rescuedBy(r)) ex.rescued += 1
        ex.turnover += r.turnover ?? 0; if (!ex.currency) ex.currency = r.currency
        if (ex.fdPrice !== r.fd_buying_price) ex.fdPrice = null  // 组内单价不一致 → 退回加权均价
      } else map.set(key, { month: ym, sku_code: r.sku_code, sku_name: r.sku_name, ka_name: ka, country_code: r.country_code, country_flag: r.country_flag, category: r.sku_category, qty: r.qty, count: 1, shipped: isShipped(r) ? 1 : 0, rescued: rescuedBy(r) ? 1 : 0, turnover: r.turnover ?? 0, currency: r.currency, fdPrice: r.fd_buying_price })
    })
    return Array.from(map.values())
  }, [tableFiltered])

  const sortedAgg = useMemo(() => {
    const arr = [...aggRows]
    arr.sort((a: any, b: any) => {
      const va = a[sortCol]; const vb = b[sortCol]
      if (typeof va === 'number' && typeof vb === 'number') { const cmp = sortDir === 'asc' ? va - vb : vb - va; return cmp !== 0 ? cmp : b.qty - a.qty }
      const cmp = sortDir === 'asc' ? String(va ?? '').localeCompare(String(vb ?? '')) : String(vb ?? '').localeCompare(String(va ?? ''))
      return cmp !== 0 ? cmp : b.qty - a.qty
    })
    return arr
  }, [aggRows, sortCol, sortDir])

  const aggTotal = sortedAgg.reduce((s, r) => s + r.qty, 0)
  const resetTable = () => { setTYear(thisYear); setTCountry('ALL'); setTMonth('ALL'); setTSku('ALL'); setTKa('ALL'); setTCat('ALL'); setTSearch('') }
  const toggleSort = (col: string) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc') } }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">🧾 PO — Customer Orders</h1>
        <p className="text-sm text-gray-500 mt-1">
          Order intake (PO) measured by <span className="font-medium text-gray-700">Qty Ordered</span> on <span className="font-medium text-gray-700">PO date</span> ·{' '}
          {viewerIsAdmin ? `🌍 Admin (${viewerName}) · all countries` : `🧑‍💼 Sales (${viewerName})`}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <KpiCard label="Total Ordered" value={fmtNum(stats.totalQty)} hint="units (Qty Ordered)" />
        <KpiCard label="Total Value" value={'€' + fmtNum(Math.round(stats.totalValueEUR))} hint={`turnover · in EUR (PLN×${plnToEur.toFixed(4)})`} color="green" />
        <KpiCard label="Key Accounts" value={fmtNum(kaNames.length)} hint={kaNames.join(' · ') || 'ordering KAs'} color="amber" />
      </div>

      {/* Filters (dashboard — drive charts/KPI) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="flex gap-4 flex-wrap items-center mb-3">
          <Sel label="Year" value={dYear} onChange={setDYear} options={options.years} />
          <Sel label="Country" value={dCountry} onChange={v => { setDCountry(v); setDKa('ALL') }} options={countryCodes} allLabel={viewerIsAdmin ? 'All EU' : 'All'} />
          <Sel label="KA" value={dKa} onChange={setDKa} options={kaOptionsTop} allLabel="All KAs" />
          <span className="ml-auto text-sm text-gray-500">Total <strong className="text-gray-900 tabular-nums">{fmtNum(stats.totalQty)}</strong> units · {fmtNum(stats.poCount)} POs</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Pill active={dMonth === 'ALL'} onClick={() => setDMonth('ALL')} amber>📅 All months <B>{fmtNum(dashExceptMonth.reduce((s, r) => s + r.qty, 0))}</B></Pill>
          {options.months.filter(m => dYear === 'ALL' ? true : m.startsWith(dYear)).map(m => {
            const qty = dashExceptMonth.filter(r => r.po_date?.startsWith(m)).reduce((s, r) => s + r.qty, 0)
            return <Pill key={m} active={dMonth === m} onClick={() => setDMonth(m)} amber>{monthShort(m)} <B>{fmtNum(qty)}</B></Pill>
          })}
        </div>
      </div>

      {/* Monthly volume + Customer ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-sm font-semibold text-gray-700">📈 Monthly order {monthMetric === 'value' ? 'value · by PO date' : 'volume · by PO date'}</div>
            {metricTag(monthMetric, setMonthMetric)}
          </div>
          <div className="text-xs text-gray-400 mb-3">{monthlyChart.grouped ? `${currentCountryLabel} · split by KA${monthMetric === 'value' ? ` · € (PLN×${plnToEur.toFixed(4)})` : ''}` : (monthMetric === 'value' ? `turnover · converted to EUR (ECB live rate PLN×${plnToEur.toFixed(4)})` : 'value labelled on bars')}</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyChart.data} margin={{ top: 22, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => fmtMonthVal(v)} />
              {monthlyChart.grouped ? (<>
                <Tooltip formatter={(v: any) => fmtMonthVal(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {monthlyChart.kas.map((ka, i) => (
                  <Bar key={ka} dataKey={ka} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={26}>
                    <LabelList dataKey={ka} position="top" formatter={(v: any) => (v ? fmtMonthVal(v) : '')} style={{ fontSize: 9, fill: '#374151', fontWeight: 600 }} />
                  </Bar>
                ))}
              </>) : (
                <Bar dataKey="qty" fill={PALETTE[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={56}>
                  <LabelList dataKey="qty" position="top" formatter={(v: any) => fmtMonthVal(v)} style={{ fontSize: 11, fill: '#374151', fontWeight: 600 }} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-sm font-semibold text-gray-700">🏢 Customer order ranking</div>
            {metricTag(rankMetric, setRankMetric)}
          </div>
          <div className="text-xs text-gray-400 mb-3">{currentCountryLabel} · {dMonth === 'ALL' ? 'All months' : monthShort(dMonth)} · {rankMetric === 'value' ? `by turnover · € (PLN×${plnToEur.toFixed(4)})` : 'by volume'}</div>
          <table className="w-full border-collapse">
            <tbody>
              {topKas.map((k, i) => (
                <tr key={k.name}>
                  <td className="w-6 py-2.5 text-xs font-semibold text-gray-300 font-mono border-b border-gray-100">{i + 1}</td>
                  <td className="py-2.5 border-b border-gray-100">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="text-[13px] font-medium text-gray-800">{k.name}</span>
                  </td>
                  <td className="w-24 py-2.5 text-right text-[13px] font-semibold font-mono border-b border-gray-100 tabular-nums">{fmtRankVal(k.qty)}</td>
                  <td className="w-14 py-2.5 text-right text-[11px] text-gray-400 border-b border-gray-100">{((k.qty / rankTotal) * 100).toFixed(1)}%</td>
                </tr>
              ))}
              {!topKas.length && <tr><td className="py-8 text-center text-gray-300 text-sm" colSpan={4}>No data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* SKU trend (by product name) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-sm font-semibold text-gray-700">📊 SKU order {skuMetric === 'value' ? 'value' : 'volume'} <span className="ml-2 text-xs text-gray-400">· {currentCountryLabel} · {dMonth === 'ALL' ? 'All months' : monthShort(dMonth)}{skuMetric === 'value' ? ` · € (PLN×${plnToEur.toFixed(4)})` : ''}</span></div>
          <div className="flex items-center gap-2">
            {metricTag(skuMetric, setSkuMetric)}
            <div className="text-xs text-gray-400 whitespace-nowrap">{skuTrend.length} SKUs</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={skuTrend} margin={{ top: 24, right: 10, left: 0, bottom: 120 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} angle={-50} textAnchor="end" interval={0} height={140} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => fmtSkuVal(v)} />
            <Bar dataKey="qty" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={40}>
              {skuTrend.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              <LabelList dataKey="qty" position="top" formatter={(v: any) => fmtSkuVal(v)} style={{ fontSize: 9, fill: '#374151' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Unshipped POs (no ship date) — operations worklist with mark actions; admin-only.
          销售视角不需要这张待办表（也无标记权），只看下方 Cancelled / Partial 状态 + 上方聚合表即可。 */}
      {viewerIsAdmin && <UnshippedTable rows={unshipped} plnToEur={plnToEur} />}

      {/* Partially delivered / Cancelled —— 销售也可见（只读，无 Reopen） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActionedTable rows={partialRows} mode="partial" plnToEur={plnToEur} viewerIsAdmin={viewerIsAdmin} />
        <ActionedTable rows={cancelledRows} mode="cancelled" plnToEur={plnToEur} viewerIsAdmin={viewerIsAdmin} />
      </div>

      {/* Aggregation detail (independent filters) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-base font-semibold text-gray-900 mb-1">📋 Order aggregation — Month × SKU × KA</div>
        <div className="text-xs text-gray-400 mb-3">Filters below are independent — they only affect this table, not the charts above.</div>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <Sel label="Year" value={tYear} onChange={setTYear} options={options.years} />
          <input value={tSearch} onChange={(e) => setTSearch(e.target.value)} placeholder="Search SKU / product / KA / PO..."
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-64" />
          <span className="text-xs text-gray-400">↓ pick filters directly in the column headers</span>
          <button onClick={resetTable} className="ml-auto px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">Reset</button>
        </div>
        <div className="text-xs text-gray-500 mb-2">Showing <strong className="text-gray-900">{sortedAgg.length}</strong> rows · Total <strong className="text-gray-900">{fmtNum(aggTotal)}</strong> units</div>
        <div className="overflow-x-auto max-h-[640px] overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <FilterTh col="month" label="Month" sc={sortCol} sd={sortDir} on={toggleSort} value={tMonth} onPick={setTMonth} options={options.months} />
                <FilterTh col="sku_code" label="SKU" sc={sortCol} sd={sortDir} on={toggleSort} value={tSku} onPick={setTSku} options={options.skus} />
                <FilterTh col="sku_name" label="Product" sc={sortCol} sd={sortDir} on={toggleSort} />
                <FilterTh col="ka_name" label="KA" sc={sortCol} sd={sortDir} on={toggleSort} value={tKa} onPick={setTKa} options={options.kas} />
                <FilterTh col="country_code" label="Country" sc={sortCol} sd={sortDir} on={toggleSort} value={tCountry} onPick={setTCountry} options={options.countries} />
                <FilterTh col="category" label="Category" sc={sortCol} sd={sortDir} on={toggleSort} value={tCat} onPick={setTCat} options={options.cats} />
                <FilterTh col="qty" label="Qty" sc={sortCol} sd={sortDir} on={toggleSort} align="right" />
                <th className="px-4 py-2 align-top text-right text-xs font-semibold text-gray-600 uppercase whitespace-nowrap" title="FD buying price = turnover / qty (original currency, not converted)">FD Price</th>
                <th className="px-4 py-2 align-top text-right text-xs font-semibold text-gray-600 uppercase whitespace-nowrap" title="Total Subtotal / turnover (original currency, as reported by the channel; EUR and PLN not mixed)">Turnover</th>
                <th className="px-4 py-2 align-top text-center text-xs font-semibold text-gray-600 uppercase">Shipped</th>
                <th className="px-4 py-2 align-top text-center text-xs font-semibold text-gray-600 uppercase whitespace-nowrap" title="Lines counted as shipped only via Delivery Date (Ship Date was blank)">Via Delivery</th>
                <th className="px-4 py-2 align-top text-right text-xs font-semibold text-gray-600 uppercase">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedAgg.map((r, i) => {
                const newMonth = i === 0 || sortedAgg[i - 1].month !== r.month
                return (
                  <tr key={i} className={`hover:bg-gray-50 ${newMonth ? 'border-t-2 border-gray-200' : ''}`}>
                    <td className="px-4 py-2 font-semibold text-xs text-gray-700 whitespace-nowrap">{newMonth ? r.month : ''}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">{r.sku_code}</td>
                    <td className="px-4 py-2 text-gray-600 truncate max-w-xs">{r.sku_name || '-'}</td>
                    <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">{r.ka_name}</span></td>
                    <td className="px-4 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">{r.country_flag} {r.country_code}</span></td>
                    <td className="px-4 py-2">{r.category ? <span className="inline-block px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">{r.category}</span> : <span className="text-gray-300">-</span>}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtNum(r.qty)}</td>
                    <td className="px-4 py-2 text-right text-gray-500 tabular-nums whitespace-nowrap">{r.fdPrice != null ? fmtMoney(r.fdPrice, r.currency) : (r.qty ? fmtMoney(r.turnover / r.qty, r.currency) : '–')}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">{fmtMoney(r.turnover, r.currency)}</td>
                    <td className="px-4 py-2 text-center"><ShippedBadge shipped={r.shipped} total={r.count} /></td>
                    <td className="px-4 py-2 text-center">{r.rescued > 0 ? <span className="inline-block px-2 py-0.5 rounded text-xs bg-sky-100 text-sky-700" title="Ship date was blank; counted as shipped via delivery date">🚚 {r.rescued}</span> : <span className="text-gray-300">-</span>}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{r.count}</td>
                  </tr>
                )
              })}
              {!sortedAgg.length && <tr><td colSpan={12} className="py-12 text-center text-gray-400">No matching records</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ===== sub-components =====

// 聚合行的发货状态徽章：全发 Yes / 全未发 No / 部分 Partial
function ShippedBadge({ shipped, total }: { shipped: number; total: number }) {
  if (total > 0 && shipped === total) return <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Yes</span>
  if (shipped === 0) return <span className="inline-block px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">No</span>
  return <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700" title={`${shipped}/${total} lines shipped`}>Partial {shipped}/{total}</span>
}

type UnRow = {
  id: number; po_date: string; po_number: string | null; notes: string | null
  sku_code: string; sku_name: string; country_code: string; country_flag: string; ka_name: string | null; qty: number
  fd_buying_price: number | null; turnover: number | null; currency: string | null; delivered_qty: number | null
}

// 未发货 PO 表 —— notes 可编辑并写回 channel_po
function UnshippedTable({ rows, plnToEur }: { rows: UnRow[]; plnToEur: number }) {
  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const totalValEUR = rows.reduce((s, r) => s + toEUR(r.turnover, r.currency, plnToEur), 0)
  const supabase = useRef(createClient()).current
  const router = useRouter()
  const today = useRef(new Date().toISOString().slice(0, 10)).current
  const [draft, setDraft] = useState<Record<number, string>>(() => Object.fromEntries(rows.map(r => [r.id, r.notes ?? ''])))
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  // 每行的发货日期（默认今天，可改成实际发货日）+ 标记中状态
  const [shipDate, setShipDate] = useState<Record<number, string>>({})
  const [shippingId, setShippingId] = useState<number | null>(null)

  const save = async (id: number) => {
    setSavingId(id); setSavedId(null)
    const { error } = await supabase.from('channel_po').update({ notes: (draft[id] ?? '').trim() || null }).eq('id', id)
    setSavingId(null)
    if (!error) { setSavedId(id); setTimeout(() => setSavedId(s => s === id ? null : s), 2000) }
    else alert(`Save failed: ${error.message}`)
  }

  // 标记已发货：写入 ship_date → 该行不再算 unshipped，聚合表里计为已发货。router.refresh() 重新拉服务端数据。
  const markShipped = async (id: number) => {
    const d = shipDate[id] || today
    setShippingId(id)
    const { error } = await supabase.from('channel_po').update({ ship_date: d }).eq('id', id)
    if (error) { setShippingId(null); alert(`Mark failed: ${error.message}`); return }
    router.refresh() // 服务端重新渲染：该行从清单消失、聚合表 Shipped +1
  }

  // 取消：po_status=cancelled → 移入 Cancelled 表（仍计入总额，只是状态标签）。
  const markCancelled = async (id: number) => {
    if (!confirm('Mark this PO as cancelled?\nIt still counts toward totals, but moves to the Cancelled table.')) return
    setShippingId(id)
    const { error } = await supabase.from('channel_po').update({ po_status: 'cancelled' }).eq('id', id)
    if (error) { setShippingId(null); alert(`Mark failed: ${error.message}`); return }
    router.refresh()
  }

  // 部分发货：输入已发数量 → po_status=partial + delivered_qty + ship_date（部分发货日）→ 移入 Partially Delivered 表。
  const markPartial = async (id: number, ordered: number) => {
    const input = prompt(`Partial shipment — quantity delivered (of ${ordered} ordered):`, '')
    if (input == null) return
    const n = Math.floor(Number(input))
    if (!Number.isFinite(n) || n <= 0 || n >= ordered) { alert(`Enter a delivered quantity between 1 and ${ordered - 1} (for the full order, use "Mark shipped").`); return }
    setShippingId(id)
    const { error } = await supabase.from('channel_po').update({ po_status: 'partial', delivered_qty: n, ship_date: shipDate[id] || today }).eq('id', id)
    if (error) { setShippingId(null); alert(`Mark failed: ${error.message}`); return }
    router.refresh()
  }

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-4 mb-5">
      <style>{`
        .lg-date{background:rgba(120,120,128,.10);border:1px solid rgba(255,255,255,.6);box-shadow:inset 0 1px 1px rgba(255,255,255,.7);backdrop-filter:blur(10px) saturate(150%);-webkit-backdrop-filter:blur(10px) saturate(150%);transition:background .25s}
        .lg-date:hover{background:rgba(120,120,128,.16)}
        .lg-ship{background:rgba(16,185,129,.20);border:1px solid rgba(16,185,129,.35);box-shadow:inset 0 1px 1px rgba(255,255,255,.7);backdrop-filter:blur(8px) saturate(160%);-webkit-backdrop-filter:blur(8px) saturate(160%);transition:background .25s,transform .2s}
        .lg-ship:hover{background:rgba(16,185,129,.30);transform:translateY(-1px)}
        .lg-chip{background:rgba(120,120,128,.12);border:1px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.6);backdrop-filter:blur(8px) saturate(150%);-webkit-backdrop-filter:blur(8px) saturate(150%);transition:background .25s,transform .2s}
        .lg-chip:hover{transform:translateY(-1px)}
        .lg-chip-blue{color:#0369a1}
        .lg-chip-blue:hover{background:rgba(2,132,199,.15)}
        .lg-chip-red{color:#be123c}
        .lg-chip-red:hover{background:rgba(225,29,72,.14)}
      `}</style>
      <div className="flex items-center justify-between mb-1">
        <div className="text-base font-semibold text-gray-900">🚚 Unshipped POs <span className="ml-2 text-xs font-normal text-amber-600">no ship date & no delivery date — needs follow-up</span></div>
        <div className="text-xs text-gray-400 whitespace-nowrap">{rows.length} lines · <strong className="text-gray-700 tabular-nums">{fmtNum(totalQty)}</strong> units · <strong className="text-gray-700 tabular-nums">€{fmtNum(Math.round(totalValEUR))}</strong></div>
      </div>
      <div className="text-xs text-gray-400 mb-3">A PO counts as shipped if it has either a Ship Date or a Delivery Date (logistics sometimes leaves Ship Date blank). Only POs missing both are listed here. Add a note to record why.</div>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-amber-50 border-b sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Country</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">KA</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">PO Date</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">PO #</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">SKU</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Product</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase">Qty</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase whitespace-nowrap" title="FD buying price (original currency)">Unit Price</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase whitespace-nowrap" title="Turnover (original currency)">Turnover</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase" style={{ minWidth: 280 }}>Notes — why not shipped?</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 uppercase whitespace-nowrap" title="Shipped / Partial / Cancel — moves the row to the matching table">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => {
              const dirty = (draft[r.id] ?? '') !== (r.notes ?? '')
              return (
                <tr key={r.id} className="hover:bg-amber-50/40 align-top">
                  <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">{r.country_flag} {r.country_code}</span></td>
                  <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">{r.ka_name ?? '-'}</span></td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">{r.po_date}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-500 whitespace-nowrap">{r.po_number ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{r.sku_code}</td>
                  <td className="px-3 py-2 text-gray-600">{r.sku_name || '-'}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(r.qty)}</td>
                  <td className="px-3 py-2 text-right text-gray-500 tabular-nums whitespace-nowrap">{fmtMoney(r.fd_buying_price, r.currency)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">{fmtMoney(r.turnover, r.currency)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <textarea value={draft[r.id] ?? ''} onChange={e => setDraft(p => ({ ...p, [r.id]: e.target.value }))} rows={2}
                        placeholder="e.g. awaiting stock / customer postponed / partial backorder…"
                        className="flex-1 min-w-0 resize-y rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-400" />
                      <button onClick={() => save(r.id)} disabled={!dirty || savingId === r.id}
                        className={`shrink-0 px-2.5 py-1 text-xs rounded-md transition ${dirty ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-gray-100 text-gray-400'}`}>
                        {savingId === r.id ? '…' : savedId === r.id ? '✓' : 'Save'}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex flex-col gap-1.5 w-[140px]">
                      <input type="date" value={shipDate[r.id] ?? today} max={today}
                        onChange={e => setShipDate(p => ({ ...p, [r.id]: e.target.value }))}
                        className="lg-date w-full rounded-[10px] px-2 py-1 text-[11px] text-gray-700 outline-none focus:ring-2 focus:ring-emerald-200/70" />
                      <button onClick={() => markShipped(r.id)} disabled={shippingId === r.id}
                        className="lg-ship w-full rounded-[10px] px-3 py-1.5 text-xs font-semibold text-emerald-800 active:scale-[0.98] disabled:opacity-50">
                        {shippingId === r.id ? 'Saving…' : 'Mark shipped'}
                      </button>
                      <div className="flex gap-1.5">
                        <button onClick={() => markPartial(r.id, r.qty)} disabled={shippingId === r.id}
                          className="lg-chip lg-chip-blue flex-1 rounded-[10px] px-2 py-1 text-[11px] font-semibold active:scale-[0.98] disabled:opacity-50" title="Partial shipment: enter quantity delivered">
                          Partial
                        </button>
                        <button onClick={() => markCancelled(r.id)} disabled={shippingId === r.id}
                          className="lg-chip lg-chip-red flex-1 rounded-[10px] px-2 py-1 text-[11px] font-semibold active:scale-[0.98] disabled:opacity-50" title="Cancel this PO">
                          Cancel
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={11} className="py-10 text-center text-gray-400">All POs have a ship date 🎉</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-amber-50 border-t-2 border-amber-200 sticky bottom-0">
              <tr>
                <td className="px-3 py-2 text-xs font-semibold text-gray-600" colSpan={6}>Unshipped total (in total PO)</td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{fmtNum(totalQty)}</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums whitespace-nowrap" title={`In EUR · PLN×${plnToEur.toFixed(4)}`}>€{fmtNum(Math.round(totalValEUR))}</td>
                <td className="px-3 py-2" colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// 已取消 / 部分发货 的 PO 表 —— 从 Unshipped 标记后转入。notes 可编辑；Reopen 退回待发。
function ActionedTable({ rows, mode, plnToEur, viewerIsAdmin }: { rows: UnRow[]; mode: 'cancelled' | 'partial'; plnToEur: number; viewerIsAdmin: boolean }) {
  const supabase = useRef(createClient()).current
  const router = useRouter()
  const [draft, setDraft] = useState<Record<number, string>>(() => Object.fromEntries(rows.map(r => [r.id, r.notes ?? ''])))
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const save = async (id: number) => {
    setSavingId(id); setSavedId(null)
    const { error } = await supabase.from('channel_po').update({ notes: (draft[id] ?? '').trim() || null }).eq('id', id)
    setSavingId(null)
    if (!error) { setSavedId(id); setTimeout(() => setSavedId(s => s === id ? null : s), 2000) }
    else alert(`Save failed: ${error.message}`)
  }
  // 退回待发：清空 po_status / delivered_qty / ship_date（这些行原本都来自未发货清单）
  const reopen = async (id: number) => {
    if (!confirm('Move back to the Unshipped list? This clears the shipped / partial / cancelled mark on this row.')) return
    setBusyId(id)
    const { error } = await supabase.from('channel_po').update({ po_status: null, delivered_qty: null, ship_date: null }).eq('id', id)
    if (error) { setBusyId(null); alert(`Action failed: ${error.message}`); return }
    router.refresh()
  }

  const isPartial = mode === 'partial'
  const totalValEUR = rows.reduce((s, r) => s + toEUR(r.turnover, r.currency, plnToEur), 0)
  const totalDelivered = rows.reduce((s, r) => s + (r.delivered_qty ?? 0), 0)
  const totalOrdered = rows.reduce((s, r) => s + r.qty, 0)
  const theme = isPartial
    ? { border: 'border-sky-200', head: 'bg-sky-50', foot: 'bg-sky-50 border-sky-200', icon: '◑', title: 'Partially Delivered POs', sub: 'Partially delivered — full ordered qty still counts toward totals; track the remainder here' }
    : { border: 'border-rose-200', head: 'bg-rose-50', foot: 'bg-rose-50 border-rose-200', icon: '✗', title: 'Cancelled POs', sub: 'Cancelled — still counts toward totals (status label only)' }

  return (
    <div className={`bg-white rounded-xl border ${theme.border} p-4 mb-5`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-base font-semibold text-gray-900">{theme.icon} {theme.title}</div>
        <div className="text-xs text-gray-400 whitespace-nowrap">{rows.length} lines · <strong className="text-gray-700 tabular-nums">{fmtNum(totalOrdered)}</strong> units · <strong className="text-gray-700 tabular-nums">€{fmtNum(Math.round(totalValEUR))}</strong></div>
      </div>
      <div className="text-xs text-gray-400 mb-3">{theme.sub}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-300 py-6 text-center border border-gray-100 rounded-lg">No records</div>
      ) : (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className={`${theme.head} border-b sticky top-0 z-10`}>
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Country</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">KA</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">PO Date</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">PO #</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">SKU</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Product</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase">{isPartial ? 'Ordered' : 'Qty'}</th>
                {isPartial && <th className="px-3 py-2.5 text-right text-xs font-semibold text-emerald-600 uppercase">Delivered</th>}
                {isPartial && <th className="px-3 py-2.5 text-right text-xs font-semibold text-amber-600 uppercase">Remaining</th>}
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase">Turnover</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase" style={{ minWidth: 220 }}>Notes</th>
                {viewerIsAdmin && <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 uppercase">Reopen</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const dirty = (draft[r.id] ?? '') !== (r.notes ?? '')
                const remaining = r.qty - (r.delivered_qty ?? 0)
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60 align-top">
                    <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">{r.country_flag} {r.country_code}</span></td>
                    <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">{r.ka_name ?? '-'}</span></td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">{r.po_date}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500 whitespace-nowrap">{r.po_number ?? '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{r.sku_code}</td>
                    <td className="px-3 py-2 text-gray-600">{r.sku_name || '-'}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(r.qty)}</td>
                    {isPartial && <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums">{fmtNum(r.delivered_qty ?? 0)}</td>}
                    {isPartial && <td className="px-3 py-2 text-right font-semibold text-amber-700 tabular-nums">{fmtNum(remaining)}</td>}
                    <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">{fmtMoney(r.turnover, r.currency)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        <textarea value={draft[r.id] ?? ''} onChange={e => setDraft(p => ({ ...p, [r.id]: e.target.value }))} rows={2}
                          placeholder={isPartial ? 'Remaining shipment plan / notes…' : 'Cancellation reason…'}
                          className="flex-1 min-w-0 resize-y rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-gray-400" />
                        <button onClick={() => save(r.id)} disabled={!dirty || savingId === r.id}
                          className={`shrink-0 px-2.5 py-1 text-xs rounded-md transition ${dirty ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400'}`}>
                          {savingId === r.id ? '…' : savedId === r.id ? '✓' : 'Save'}
                        </button>
                      </div>
                    </td>
                    {viewerIsAdmin && (
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => reopen(r.id)} disabled={busyId === r.id}
                          className="px-2 py-1 text-[11px] rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition disabled:opacity-60" title="Move back to Unshipped">
                          {busyId === r.id ? '…' : '↩ Reopen'}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className={`${theme.foot} border-t-2 sticky bottom-0`}>
              <tr>
                <td className="px-3 py-2 text-xs font-semibold text-gray-600" colSpan={6}>Total</td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{fmtNum(totalOrdered)}</td>
                {isPartial && <td className="px-3 py-2 text-right text-sm font-bold text-emerald-700 tabular-nums">{fmtNum(totalDelivered)}</td>}
                {isPartial && <td className="px-3 py-2 text-right text-sm font-bold text-amber-700 tabular-nums">{fmtNum(totalOrdered - totalDelivered)}</td>}
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums whitespace-nowrap" title={`In EUR · PLN×${plnToEur.toFixed(4)}`}>€{fmtNum(Math.round(totalValEUR))}</td>
                <td className="px-3 py-2" colSpan={viewerIsAdmin ? 2 : 1}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  const cMap: Record<string, string> = { blue: 'text-blue-600', amber: 'text-amber-600', purple: 'text-purple-600', green: 'text-green-600' }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ? cMap[color] : 'text-gray-900'} tabular-nums`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1 leading-snug line-clamp-2">{hint}</div>}
    </div>
  )
}

function Pill({ children, active, onClick, amber }: { children: React.ReactNode; active: boolean; onClick: () => void; amber?: boolean }) {
  const activeStyle = amber ? 'bg-amber-500 text-white border-amber-500 shadow' : 'bg-blue-600 text-white border-blue-600 shadow'
  const hoverStyle = amber ? 'hover:border-amber-400' : 'hover:border-blue-400'
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition border ${active ? activeStyle : `bg-white text-gray-700 border-gray-300 ${hoverStyle}`}`}>
      {children}
    </button>
  )
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 px-1.5 rounded bg-black/10 text-xs font-mono">{children}</span>
}

function Sel({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (v: string) => void; options: string[]; allLabel?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-gray-600 text-xs">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-md text-sm">
        <option value="ALL">{allLabel ?? 'All'}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

// 表头单元：上排标题(点击排序)+ 下排筛选下拉(传 options 时才有)
function FilterTh({ col, label, sc, sd, on, align, value, onPick, options }:
  { col: string; label: string; sc: string; sd: 'asc' | 'desc'; on: (c: string) => void; align?: 'right'; value?: string; onPick?: (v: string) => void; options?: string[] }) {
  const active = col === sc
  return (
    <th className={`px-3 py-2 align-top whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div onClick={() => on(col)} className="text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:text-gray-900 select-none">
        {label}{active && <span className="ml-1 text-blue-600">{sd === 'asc' ? '▲' : '▼'}</span>}
      </div>
      {options && onPick && (
        <select value={value} onChange={e => onPick(e.target.value)}
          className={`mt-1.5 w-full max-w-[140px] px-1.5 py-1 border rounded text-xs font-normal normal-case ${value && value !== 'ALL' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600'}`}>
          <option value="ALL">All</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </th>
  )
}
