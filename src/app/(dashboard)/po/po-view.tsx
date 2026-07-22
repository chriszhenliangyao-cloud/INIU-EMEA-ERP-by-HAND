'use client'

import { Fragment, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { fmtNum } from '@/lib/utils'
import { toEUR, fmtMoney, PALETTE } from './_ops'
import { buildWorkbook, downloadWorkbook, type XRow } from '@/lib/spreadsheet'

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
  ka_vat: number | null
}

// 渠道 VAT 小字：（VAT=20%）· 未设为 —
const fmtVat = (v: number | null | undefined) => `（VAT=${v != null ? v + '%' : '—'}）`

// Value 模式的 PLN→EUR 兜底汇率（正常由 page.tsx 注入 plnToEur prop）。
// isShipped / toEUR / fmtMoney / PALETTE + Unshipped/Actioned 操作表已抽到 ./_ops（新 admin PO & Shipment 模块共用）。
const FX_FALLBACK = 0.23
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
  const [countryMetric, setCountryMetric] = useState<'volume' | 'value'>('volume')

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
    // 含增值税：每行营业额(EUR) × (1 + 该渠道 VAT%)；渠道未设 VAT 视为 0
    const totalValueInclVatEUR = dashFiltered.reduce((s, r) => s + toEUR(r.turnover, r.currency, plnToEur) * (1 + (r.ka_vat ?? 0) / 100), 0)
    return { totalQty, poCount, skuCount, totalValueEUR, totalValueInclVatEUR }
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
    const map: Record<string, { flag: string; name: string; qty: number; eur: number }> = {}
    rows.forEach(r => { if (!map[r.country_code]) map[r.country_code] = { flag: r.country_flag, name: r.country_name, qty: 0, eur: 0 } })
    dashExceptCountry.forEach(r => {
      const m = map[r.country_code]
      if (m) { m.qty += r.qty; m.eur += toEUR(r.turnover, r.currency, plnToEur) }
    })
    return map
  }, [rows, dashExceptCountry, plnToEur])

  const countryCodes = Object.keys(countryMeta)
  // Country 选择条：按所选口径降序（与月份 Pill 同口径，数据来自 dashExceptCountry）
  const countryByVolume = useMemo(
    () => Object.entries(countryMeta).sort((a, b) =>
      countryMetric === 'value' ? b[1].eur - a[1].eur : b[1].qty - a[1].qty),
    [countryMeta, countryMetric]
  )
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
    const m: Record<string, number> = {}; const vat: Record<string, number | null> = {}
    dashFiltered.forEach(r => { const name = r.ka_name ?? 'Unspecified'; m[name] = (m[name] ?? 0) + pick(r); if (!(name in vat)) vat[name] = r.ka_vat })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, qty]) => ({ name, qty, vat: vat[name] }))
  }, [dashFiltered, rankMetric, plnToEur])
  const rankTotal = topKas.reduce((s, r) => s + r.qty, 0) || 1
  const rankMax = topKas[0]?.qty || 1  // 排名第一 = 满条，其余按比例

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

  type AggRow = { key: string; month: string; sku_code: string; sku_name: string; ka_name: string; country_code: string; country_flag: string; category: string | null; qty: number; count: number; turnover: number; currency: string | null; fdPrice: number | null; pos: FlatRow[] }
  const aggRows = useMemo<AggRow[]>(() => {
    const map = new Map<string, AggRow>()
    tableFiltered.forEach(r => {
      const ym = r.po_date?.slice(0, 7) ?? ''
      const ka = r.ka_name ?? '-'
      const key = `${ym}|${r.sku_code}|${ka}|${r.country_code}`
      const ex = map.get(key)
      if (ex) {
        ex.qty += r.qty; ex.count += 1
        ex.turnover += r.turnover ?? 0; if (!ex.currency) ex.currency = r.currency
        if (ex.fdPrice !== r.fd_buying_price) ex.fdPrice = null  // 组内单价不一致 → 退回加权均价
        ex.pos.push(r)
      } else map.set(key, { key, month: ym, sku_code: r.sku_code, sku_name: r.sku_name, ka_name: ka, country_code: r.country_code, country_flag: r.country_flag, category: r.sku_category, qty: r.qty, count: 1, turnover: r.turnover ?? 0, currency: r.currency, fdPrice: r.fd_buying_price, pos: [r] })
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

  // 导出聚合表：Month × PO（qty + turnover），沿用当前表格筛选
  const exportAgg = () => {
    if (!tableFiltered.length) return
    const today = new Date().toISOString().slice(0, 10)
    // SpreadsheetML 2003：纯 XML，不能加 BOM（会破坏 <?xml ?> 解析）
    const blob = new Blob([buildAggXls(tableFiltered, plnToEur, today)], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `PO by Month-${today.replace(/-/g, '')}.xls`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const toggleSort = (col: string) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc') } }
  // 展开：看该聚合行(月×SKU×KA)下的每一张 PO（含具体日期）
  const [expandedAgg, setExpandedAgg] = useState<Set<string>>(new Set())
  const toggleExpand = (k: string) => setExpandedAgg(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Total Ordered" value={fmtNum(stats.totalQty)} hint="units (Qty Ordered)" />
        <KpiCard label="Total Value" value={'€' + fmtNum(Math.round(stats.totalValueEUR))} hint={`turnover · in EUR (PLN×${plnToEur.toFixed(4)})`} color="green" />
        <KpiCard label="Total Value (include VAT)" value={'€' + fmtNum(Math.round(stats.totalValueInclVatEUR))} hint="turnover × (1 + channel VAT%) · EUR" color="green" />
        <KpiCard label="Key Accounts" value={fmtNum(kaNames.length)} hint={kaNames.join(' · ') || 'ordering KAs'} color="amber" />
      </div>

      {/* Filters (dashboard — drive charts/KPI) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="flex gap-4 flex-wrap items-center mb-3">
          <Sel label="Year" value={dYear} onChange={setDYear} options={options.years} />
          <Sel label="KA" value={dKa} onChange={setDKa} options={kaOptionsTop} allLabel="All KAs" />
          <span className="ml-auto text-sm text-gray-500">Total <strong className="text-gray-900 tabular-nums">{fmtNum(stats.totalQty)}</strong> units · {fmtNum(stats.poCount)} POs</span>
        </div>
        {/* Country 选择条：按所选口径（Volume / Value）降序 */}
        <div className="flex gap-2 flex-wrap items-center mb-2.5">
          <Pill active={dCountry === 'ALL'} onClick={() => { setDCountry('ALL'); setDKa('ALL') }}>
            🌍 {viewerIsAdmin ? 'All EU' : 'All'} <B>{countryMetric === 'value'
              ? '€' + fmtNum(Math.round(Object.values(countryMeta).reduce((s, m) => s + m.eur, 0)))
              : fmtNum(dashExceptCountry.reduce((s, r) => s + r.qty, 0))}</B>
          </Pill>
          {countryByVolume.map(([code, m]) => (
            <Pill key={code} active={dCountry === code} onClick={() => { setDCountry(code); setDKa('ALL') }}>
              {m.flag} {code} <B>{countryMetric === 'value' ? '€' + fmtNum(Math.round(m.eur)) : fmtNum(m.qty)}</B>
            </Pill>
          ))}
          <span className="ml-auto flex items-center gap-2">
            {countryMetric === 'value' && <span className="text-[11px] text-gray-400">€ · PLN×{plnToEur.toFixed(4)}</span>}
            {metricTag(countryMetric, setCountryMetric)}
          </span>
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
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] p-4">
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

        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-sm font-semibold text-gray-700">🏢 Customer order ranking</div>
            {metricTag(rankMetric, setRankMetric)}
          </div>
          <div className="text-xs text-gray-400 mb-3">{currentCountryLabel} · {dMonth === 'ALL' ? 'All months' : monthShort(dMonth)} · {rankMetric === 'value' ? `by turnover · € (PLN×${plnToEur.toFixed(4)})` : 'by volume'}</div>
          <table className="w-full border-collapse">
            <tbody>
              {topKas.map((k, i) => {
                const color = PALETTE[i % PALETTE.length]
                return (
                  <tr key={k.name} className="group">
                    <td className="w-6 py-2.5 text-xs font-semibold text-gray-300 font-mono border-b border-black/[0.05] tabular-nums">{i + 1}</td>
                    <td className="w-28 py-2.5 border-b border-black/[0.05] whitespace-nowrap">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle" style={{ background: color }} />
                      <span className="text-[13px] font-medium text-gray-800">{k.name}</span>
                      <div className="text-[10px] text-gray-400 ml-[18px] leading-tight">{fmtVat(k.vat)}</div>
                    </td>
                    <td className="py-2.5 px-3 border-b border-black/[0.05]">
                      <div className="h-2 rounded-full bg-gray-500/10 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, (k.qty / rankMax) * 100)}%`, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
                      </div>
                    </td>
                    <td className="w-24 py-2.5 text-right text-[13px] font-semibold font-mono border-b border-black/[0.05] tabular-nums">{fmtRankVal(k.qty)}</td>
                    <td className="w-14 py-2.5 text-right text-[11px] text-gray-400 border-b border-black/[0.05] tabular-nums">{((k.qty / rankTotal) * 100).toFixed(1)}%</td>
                  </tr>
                )
              })}
              {!topKas.length && <tr><td className="py-8 text-center text-gray-300 text-sm" colSpan={5}>No data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* SKU trend (by product name) */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] p-4 mb-5">
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

      {/* 未发货 / 部分 / 取消 三张操作表已迁到 admin「PO & Shipment」模块。
          本公开页现在是纯数据看板：KPI + 月度趋势 + SKU 趋势 + 下方聚合明细。 */}

      {/* Aggregation detail (independent filters) */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] p-4">
        <div className="text-base font-semibold text-gray-900 mb-1">📋 Order aggregation — Month × SKU × KA</div>
        <div className="text-xs text-gray-400 mb-3">Filters below are independent — they only affect this table, not the charts above.</div>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <Sel label="Year" value={tYear} onChange={setTYear} options={options.years} />
          <input value={tSearch} onChange={(e) => setTSearch(e.target.value)} placeholder="Search SKU / product / KA / PO..."
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-64" />
          <span className="text-xs text-gray-400">↓ pick filters directly in the column headers</span>
          <button onClick={exportAgg} disabled={!tableFiltered.length}
            className="ml-auto px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="导出当前筛选结果：按月 × PO 汇总 qty 与 turnover">⬇️ Export Excel</button>
          <button onClick={resetTable} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">Reset</button>
        </div>
        <div className="text-xs text-gray-500 mb-2">Showing <strong className="text-gray-900">{sortedAgg.length}</strong> rows · Total <strong className="text-gray-900">{fmtNum(aggTotal)}</strong> units</div>
        <div className="overflow-x-auto max-h-[640px] overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <FilterTh col="month" label="Month" sc={sortCol} sd={sortDir} on={toggleSort} value={tMonth} onPick={setTMonth} options={options.months} />
                <FilterTh col="sku_code" label="SKU" sc={sortCol} sd={sortDir} on={toggleSort} value={tSku} onPick={setTSku} options={options.skus} />
                <FilterTh col="sku_name" label="Product" sc={sortCol} sd={sortDir} on={toggleSort} />
                <FilterTh col="ka_name" label="FD" sc={sortCol} sd={sortDir} on={toggleSort} value={tKa} onPick={setTKa} options={options.kas} />
                <FilterTh col="qty" label="Qty" sc={sortCol} sd={sortDir} on={toggleSort} align="right" />
                <th className="px-4 py-2 align-top text-right text-xs font-semibold text-gray-600 whitespace-nowrap" title="FD buying price = turnover / qty (original currency, not converted)">FD Price</th>
                <th className="px-4 py-2 align-top text-right text-xs font-semibold text-gray-600 whitespace-nowrap" title="Total Subtotal / turnover (original currency, as reported by the channel; EUR and PLN not mixed)">Turnover</th>
                <th className="px-4 py-2 align-top text-right text-xs font-semibold text-gray-600">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedAgg.map((r, i) => {
                const newMonth = i === 0 || sortedAgg[i - 1].month !== r.month
                const open = expandedAgg.has(r.key)
                const poList = open ? [...r.pos].sort((a, b) => (a.po_date ?? '').localeCompare(b.po_date ?? '')) : []
                return (
                  <Fragment key={r.key}>
                  <tr className={`hover:bg-gray-50 ${newMonth ? 'border-t-2 border-gray-200' : ''}`}>
                    <td className="px-4 py-2 font-semibold text-xs text-gray-700 whitespace-nowrap">{newMonth ? r.month : ''}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                      <button onClick={() => toggleExpand(r.key)} title={`展开查看 ${r.count} 张 PO（含日期）`}
                        className="mr-1.5 w-4 h-4 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 align-middle">
                        <span className="inline-block text-[9px] transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                      </button>
                      {r.sku_code}
                    </td>
                    <td className="px-4 py-2 text-gray-600 truncate max-w-xs">
                      {r.category && <span className="text-[10px] text-purple-400 mr-1.5 align-middle">{r.category}</span>}
                      {r.sku_name || '-'}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{r.ka_name}</span>
                      <span className="ml-1.5 align-middle" title={r.country_code}>{r.country_flag}</span>
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtNum(r.qty)}</td>
                    <td className="px-4 py-2 text-right text-gray-500 tabular-nums whitespace-nowrap">{r.fdPrice != null ? fmtMoney(r.fdPrice, r.currency) : (r.qty ? fmtMoney(r.turnover / r.qty, r.currency) : '–')}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-800 tabular-nums whitespace-nowrap">{fmtMoney(r.turnover, r.currency)}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{r.count}</td>
                  </tr>
                  {poList.map((p, j) => (
                    <tr key={r.key + '#' + j} className="bg-slate-50/70 text-xs">
                      <td className="px-4 py-1"></td>
                      <td className="px-4 py-1 pl-9 text-gray-600 whitespace-nowrap tabular-nums font-medium">🗓 {p.po_date}</td>
                      <td className="px-4 py-1 text-gray-500 font-mono truncate max-w-xs" title={p.po_number ?? ''}>{p.po_number ?? '—'}</td>
                      <td className="px-4 py-1"></td>
                      <td className="px-4 py-1 text-right tabular-nums text-gray-700">{fmtNum(p.qty)}</td>
                      <td className="px-4 py-1 text-right tabular-nums text-gray-400 whitespace-nowrap">{p.fd_buying_price != null ? fmtMoney(p.fd_buying_price, p.currency) : (p.qty ? fmtMoney((p.turnover ?? 0) / p.qty, p.currency) : '–')}</td>
                      <td className="px-4 py-1 text-right tabular-nums text-gray-600 whitespace-nowrap">{fmtMoney(p.turnover ?? 0, p.currency)}</td>
                      <td className="px-4 py-1"></td>
                    </tr>
                  ))}
                  </Fragment>
                )
              })}
              {!sortedAgg.length && <tr><td colSpan={8} className="py-12 text-center text-gray-400">No matching records</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ===== sub-components =====

function KpiCard({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  const cMap: Record<string, string> = { blue: 'text-blue-600', amber: 'text-amber-600', purple: 'text-purple-600', green: 'text-emerald-600' }
  return (
    <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] p-[18px]">
      <div className="text-xs font-medium text-gray-400">{label}</div>
      <div className={`text-[26px] font-semibold mt-1.5 tracking-tight tabular-nums ${color ? cMap[color] : 'text-gray-900'}`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1.5 leading-snug line-clamp-2">{hint}</div>}
    </div>
  )
}

// ===== Sheet 2：Country × Month × SKU —— 跨所有 PO 的合计 qty / turnover（扁平，便于自行透视）=====
function countrySkuRows(src: FlatRow[], plnToEur: number): XRow[] {
  type Agg = { country: string; month: string; sku: string; product: string; category: string | null; qty: number; eur: number; orig: number; currency: string | null; pos: Set<string> }
  const map = new Map<string, Agg>()
  src.forEach(r => {
    const month = (r.po_date ?? '').slice(0, 7)
    const key = `${r.country_code}|${month}|${r.sku_code}`
    const eur = toEUR(r.turnover, r.currency, plnToEur)
    const ex = map.get(key)
    if (ex) {
      ex.qty += r.qty; ex.eur += eur; ex.orig += r.turnover ?? 0
      if (r.po_number) ex.pos.add(r.po_number)
      if (!ex.currency) ex.currency = r.currency
    } else {
      map.set(key, { country: r.country_code, month, sku: r.sku_code, product: r.sku_name, category: r.sku_category, qty: r.qty, eur, orig: r.turnover ?? 0, currency: r.currency, pos: new Set(r.po_number ? [r.po_number] : []) })
    }
  })
  // 国家 A→Z，月份倒序，月内按数量降序
  const list = Array.from(map.values()).sort((a, b) =>
    a.country.localeCompare(b.country) || b.month.localeCompare(a.month) || b.qty - a.qty)

  const rows: XRow[] = [[
    { v: 'Country', s: 'hdr' }, { v: 'Month', s: 'hdr' }, { v: 'SKU', s: 'hdr' }, { v: 'Product', s: 'hdr' },
    { v: 'Category', s: 'hdr' }, { v: 'Qty', s: 'hdr' }, { v: 'Turnover (EUR)', s: 'hdr' },
    { v: 'Currency', s: 'hdr' }, { v: 'Turnover (orig)', s: 'hdr' }, { v: 'POs', s: 'hdr' },
  ]]
  list.forEach(a => rows.push([
    { v: a.country }, { v: a.month }, { v: a.sku }, { v: a.product }, { v: a.category ?? '' },
    { v: a.qty, num: true, s: 'n0' }, { v: Number(a.eur.toFixed(2)), num: true, s: 'n2' },
    { v: a.currency ?? '' }, { v: Number(a.orig.toFixed(2)), num: true, s: 'n2' },
    { v: a.pos.size, num: true, s: 'n0' },
  ]))
  const gQty = list.reduce((s, a) => s + a.qty, 0)
  const gEur = list.reduce((s, a) => s + a.eur, 0)
  const gOrig = list.reduce((s, a) => s + a.orig, 0)
  rows.push([
    { v: `TOTAL · ${list.length} rows`, s: 'tot', span: 5 },
    { v: gQty, num: true, s: 'tot0' }, { v: Number(gEur.toFixed(2)), num: true, s: 'tot2' },
    { v: '', s: 'tot' }, { v: Number(gOrig.toFixed(2)), num: true, s: 'tot2' }, { v: '', s: 'tot' },
  ])
  return rows
}

// ===== Sheet 1：Month → PO → SKU 三层，PO 小计 + 每月小计 + 总计 =====
function byPoRows(src: FlatRow[], plnToEur: number, today: string): XRow[] {
  type Line = { sku: string; product: string; qty: number; price: number | null; eur: number; orig: number; currency: string | null }
  type PoAgg = { month: string; po: string; po_date: string; country: string; ka: string; qty: number; eur: number; orig: number; currency: string | null; lines: Map<string, Line> }
  const map = new Map<string, PoAgg>()
  src.forEach(r => {
    const month = (r.po_date ?? '').slice(0, 7)
    const po = r.po_number ?? '(no PO #)'
    const key = `${month}|${po}`
    const eur = toEUR(r.turnover, r.currency, plnToEur)
    let p = map.get(key)
    if (!p) {
      p = { month, po, po_date: r.po_date, country: r.country_code, ka: r.ka_name ?? '-', qty: 0, eur: 0, orig: 0, currency: r.currency, lines: new Map() }
      map.set(key, p)
    }
    p.qty += r.qty; p.eur += eur; p.orig += r.turnover ?? 0
    if (r.po_date < p.po_date) p.po_date = r.po_date
    if (!p.currency) p.currency = r.currency
    // 同一 PO 内同 SKU 合并（可能拆多行）
    const ex = p.lines.get(r.sku_code)
    if (ex) { ex.qty += r.qty; ex.eur += eur; ex.orig += r.turnover ?? 0; if (ex.price == null) ex.price = r.fd_buying_price }
    else p.lines.set(r.sku_code, { sku: r.sku_code, product: r.sku_name, qty: r.qty, price: r.fd_buying_price, eur, orig: r.turnover ?? 0, currency: r.currency })
  })
  // 月份倒序、月内按 turnover 降序
  const list = Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month) || b.eur - a.eur)

  const rows: XRow[] = [[
    { v: 'Month', s: 'hdr' }, { v: 'PO #', s: 'hdr' }, { v: 'PO Date', s: 'hdr' }, { v: 'Country', s: 'hdr' },
    { v: 'FD', s: 'hdr' }, { v: 'SKU', s: 'hdr' }, { v: 'Product', s: 'hdr' }, { v: 'Qty', s: 'hdr' },
    { v: 'FD Price', s: 'hdr' }, { v: 'Turnover (EUR)', s: 'hdr' }, { v: 'Currency', s: 'hdr' }, { v: 'Turnover (orig)', s: 'hdr' },
  ]]
  // 小计行：label 跨前 7 列，然后 Qty / (空 FD Price) / EUR / (空 Currency) / orig
  const totalRow = (label: string, qty: number, eur: number, orig: number, base: string): XRow => ([
    { v: label, s: base, span: 7 },
    { v: qty, num: true, s: base + '0' }, { v: '', s: base },
    { v: Number(eur.toFixed(2)), num: true, s: base + '2' }, { v: '', s: base },
    { v: Number(orig.toFixed(2)), num: true, s: base + '2' },
  ])

  let curMonth = ''
  let mQty = 0, mEur = 0, mOrig = 0, mPos = 0
  const flushMonth = () => {
    if (!curMonth) return
    rows.push(totalRow(`${curMonth} subtotal · ${mPos} POs`, mQty, mEur, mOrig, 'mon'))
    mQty = 0; mEur = 0; mOrig = 0; mPos = 0
  }

  list.forEach(p => {
    if (p.month !== curMonth) { flushMonth(); curMonth = p.month }
    mQty += p.qty; mEur += p.eur; mOrig += p.orig; mPos++
    // SKU 明细行（按数量降序）
    Array.from(p.lines.values()).sort((a, b) => b.qty - a.qty).forEach(l => rows.push([
      { v: p.month }, { v: p.po }, { v: p.po_date }, { v: p.country }, { v: p.ka },
      { v: l.sku }, { v: l.product },
      { v: l.qty, num: true, s: 'n0' },
      l.price == null ? { v: '' } : { v: Number(l.price.toFixed(2)), num: true, s: 'n2' },
      { v: Number(l.eur.toFixed(2)), num: true, s: 'n2' },
      { v: l.currency ?? '' },
      { v: Number(l.orig.toFixed(2)), num: true, s: 'n2' },
    ]))
    rows.push(totalRow(`  ↳ ${p.po} total · ${p.lines.size} SKUs`, p.qty, p.eur, p.orig, 'sub'))
  })
  flushMonth()

  const gQty = list.reduce((s, p) => s + p.qty, 0)
  const gEur = list.reduce((s, p) => s + p.eur, 0)
  const gOrig = list.reduce((s, p) => s + p.orig, 0)
  rows.push(totalRow(`TOTAL · ${list.length} POs`, gQty, gEur, gOrig, 'tot'))
  rows.push([{ v: `Exported ${today} · Month → PO → SKU · EUR converted at PLN×${plnToEur.toFixed(4)}`, s: 'note', span: 12 }])
  return rows
}

function buildAggXls(src: FlatRow[], plnToEur: number, today: string): string {
  return buildWorkbook([
    { name: 'By PO', rows: byPoRows(src, plnToEur, today), widths: [55, 130, 65, 50, 70, 90, 190, 55, 60, 90, 55, 90] },
    { name: 'By Country-SKU', rows: countrySkuRows(src, plnToEur), widths: [55, 55, 90, 190, 70, 55, 90, 55, 90, 40] },
  ])
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
      <div onClick={() => on(col)} className="text-xs font-semibold text-gray-600 cursor-pointer hover:text-gray-900 select-none">
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
