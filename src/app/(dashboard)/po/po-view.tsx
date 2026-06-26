'use client'

import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { fmtNum } from '@/lib/utils'

type FlatRow = {
  id: number
  po_date: string
  qty: number
  po_number: string | null
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

// Apple / 周报 配色
const INK = '#1d1d1f'
const MUTE = '#86868b'
const BLUE = '#0071e3'
const GREEN = '#34c759'
const PURPLE = '#5e5ce6'
const ORANGE = '#ff9f0a'
const RANK_COLORS = [BLUE, GREEN, PURPLE, ORANGE, '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a', '#30d158', '#ac8e68']

export function PoView({ rows, viewerIsAdmin, viewerName, marketCount }: { rows: FlatRow[]; viewerIsAdmin: boolean; viewerName: string; marketCount: number }) {
  // ============== 筛选状态 ==============
  const [yearFilter, setYearFilter] = useState<string>(String(new Date().getFullYear()))
  const [countryFilter, setCountryFilter] = useState<string>('ALL')
  const [monthFilter, setMonthFilter] = useState<string>('ALL')
  const [skuFilter, setSkuFilter] = useState<string>('ALL')
  const [kaFilter, setKaFilter] = useState<string>('ALL')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [search, setSearch] = useState<string>('')
  const [sortCol, setSortCol] = useState<string>('month')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // ============== 衍生筛选 ==============
  const filteredExceptCountry = useMemo(() => {
    return rows.filter(r => {
      if (yearFilter !== 'ALL' && (r.po_date?.slice(0, 4) ?? '') !== yearFilter) return false
      if (monthFilter !== 'ALL' && (r.po_date?.slice(0, 7) ?? '') !== monthFilter) return false
      if (skuFilter !== 'ALL' && r.sku_code !== skuFilter) return false
      if (kaFilter !== 'ALL' && r.ka_name !== kaFilter) return false
      if (categoryFilter !== 'ALL' && r.sku_category !== categoryFilter) return false
      if (search) {
        const s = search.toLowerCase()
        if (!r.sku_code?.toLowerCase().includes(s) && !r.sku_name?.toLowerCase().includes(s) &&
            !r.ka_name?.toLowerCase().includes(s) && !r.po_number?.toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [rows, yearFilter, monthFilter, skuFilter, kaFilter, categoryFilter, search])

  const filtered = useMemo(() => (
    countryFilter === 'ALL' ? filteredExceptCountry : filteredExceptCountry.filter(r => r.country_code === countryFilter)
  ), [filteredExceptCountry, countryFilter])

  const filteredExceptMonth = useMemo(() => {
    return rows.filter(r => {
      if (yearFilter !== 'ALL' && (r.po_date?.slice(0, 4) ?? '') !== yearFilter) return false
      if (countryFilter !== 'ALL' && r.country_code !== countryFilter) return false
      if (skuFilter !== 'ALL' && r.sku_code !== skuFilter) return false
      if (kaFilter !== 'ALL' && r.ka_name !== kaFilter) return false
      if (categoryFilter !== 'ALL' && r.sku_category !== categoryFilter) return false
      if (search) {
        const s = search.toLowerCase()
        if (!r.sku_code?.toLowerCase().includes(s) && !r.sku_name?.toLowerCase().includes(s) &&
            !r.ka_name?.toLowerCase().includes(s) && !r.po_number?.toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [rows, yearFilter, countryFilter, skuFilter, kaFilter, categoryFilter, search])

  // ============== KPI ==============
  const stats = useMemo(() => {
    const totalQty = filtered.reduce((s, r) => s + r.qty, 0)
    const poCount = new Set(filtered.filter(r => r.po_number).map(r => r.po_number)).size
    const skuCount = new Set(filtered.map(r => r.sku_code)).size
    const kaCount = new Set(filtered.filter(r => r.ka_name).map(r => r.ka_name)).size
    return { totalQty, poCount, skuCount, kaCount }
  }, [filtered])

  // ============== 筛选选项 ==============
  const options = useMemo(() => ({
    months: Array.from(new Set(rows.map(r => r.po_date?.slice(0, 7) ?? ''))).filter(Boolean).sort().reverse(),
    skus: Array.from(new Set(rows.map(r => r.sku_code))).sort(),
    kas: Array.from(new Set(rows.filter(r => r.ka_name).map(r => r.ka_name as string))).sort(),
    cats: Array.from(new Set(rows.map(r => r.sku_category).filter(Boolean) as string[])).sort(),
    years: Array.from(new Set(rows.map(r => r.po_date?.slice(0, 4) ?? ''))).filter(Boolean).sort().reverse(),
  }), [rows])

  // ============== 国家 ==============
  const countryMeta = useMemo(() => {
    const map: Record<string, { flag: string; name: string; qty: number }> = {}
    rows.forEach(r => { if (!map[r.country_code]) map[r.country_code] = { flag: r.country_flag, name: r.country_name, qty: 0 } })
    filteredExceptCountry.forEach(r => { if (map[r.country_code]) map[r.country_code].qty += r.qty })
    return map
  }, [rows, filteredExceptCountry])

  const countryCodes = Object.keys(countryMeta)
  const currentCountryLabel = (() => {
    if (countryFilter !== 'ALL') return countryMeta[countryFilter]?.name ?? countryFilter
    if (viewerIsAdmin) return 'EU'
    if (countryCodes.length === 1) return Object.values(countryMeta)[0]?.name ?? countryCodes[0]
    return Object.entries(countryMeta).sort((a, b) => b[1].qty - a[1].qty).map(([_, m]) => m.name).join(' + ')
  })()

  // ============== 图表数据 ==============
  const monthlyTrend = useMemo(() => {
    const m: Record<string, number> = {}
    filtered.forEach(r => { const ym = r.po_date?.slice(0, 7) ?? ''; if (ym) m[ym] = (m[ym] ?? 0) + r.qty })
    return Object.entries(m).sort().map(([month, qty]) => ({ month, qty }))
  }, [filtered])

  const topKas = useMemo(() => {
    const m: Record<string, number> = {}
    filtered.forEach(r => { const name = r.ka_name ?? 'Unspecified'; m[name] = (m[name] ?? 0) + r.qty })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, qty]) => ({ name, qty }))
  }, [filtered])

  const skuTrend = useMemo(() => {
    const m: Record<string, number> = {}
    filtered.forEach(r => { m[r.sku_code] = (m[r.sku_code] ?? 0) + r.qty })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([sku, qty]) => ({ sku, qty }))
  }, [filtered])

  // ============== 聚合表 ==============
  type AggRow = { month: string; sku_code: string; sku_name: string; ka_name: string; country_code: string; country_name: string; country_flag: string; category: string | null; qty: number; count: number }
  const aggRows = useMemo<AggRow[]>(() => {
    const map = new Map<string, AggRow>()
    filtered.forEach(r => {
      const ym = r.po_date?.slice(0, 7) ?? ''
      const ka = r.ka_name ?? '-'
      const key = `${ym}|${r.sku_code}|${ka}|${r.country_code}`
      const ex = map.get(key)
      if (ex) { ex.qty += r.qty; ex.count += 1 }
      else map.set(key, { month: ym, sku_code: r.sku_code, sku_name: r.sku_name, ka_name: ka, country_code: r.country_code, country_name: r.country_name, country_flag: r.country_flag, category: r.sku_category, qty: r.qty, count: 1 })
    })
    return Array.from(map.values())
  }, [filtered])

  const sortedAgg = useMemo(() => {
    const arr = [...aggRows]
    arr.sort((a: any, b: any) => {
      const va = a[sortCol]; const vb = b[sortCol]
      if (typeof va === 'number' && typeof vb === 'number') {
        const cmp = sortDir === 'asc' ? va - vb : vb - va
        return cmp !== 0 ? cmp : b.qty - a.qty
      }
      const cmp = sortDir === 'asc' ? String(va ?? '').localeCompare(String(vb ?? '')) : String(vb ?? '').localeCompare(String(va ?? ''))
      return cmp !== 0 ? cmp : b.qty - a.qty
    })
    return arr
  }, [aggRows, sortCol, sortDir])

  const aggTotal = sortedAgg.reduce((s, r) => s + r.qty, 0)
  const rankTotal = topKas.reduce((s, r) => s + r.qty, 0) || 1

  const resetFilters = () => {
    setYearFilter(String(new Date().getFullYear()))
    setCountryFilter('ALL'); setMonthFilter('ALL'); setSkuFilter('ALL')
    setKaFilter('ALL'); setCategoryFilter('ALL'); setSearch('')
  }
  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'month' ? 'asc' : 'desc') }
  }

  return (
    <div className="min-h-full bg-[#f5f5f7] py-8 px-4" style={{ fontFamily: 'Arial, sans-serif', color: INK }}>
      <div className="mx-auto max-w-[1000px] bg-white shadow-sm">

        {/* ===== 深色头部 ===== */}
        <div className="bg-[#1d1d1f] px-10 py-9 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold tracking-[1.6px] uppercase text-[#86868b]">PO · 客户订单 (Customer Orders)</div>
            <div className="mt-3 text-[21px] font-semibold text-white leading-snug">{currentCountryLabel} · {monthFilter === 'ALL' ? '全部月份' : monthFilter}{yearFilter !== 'ALL' ? ` · ${yearFilter}` : ''}</div>
            <div className="mt-2 text-[11px] text-[#86868b]">
              {viewerIsAdmin ? `🌍 Admin (${viewerName}) · 全部国家` : `🧑‍💼 Sales (${viewerName})`} · 按 PO Date 统计 Qty Ordered
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[34px] font-semibold text-white leading-none tabular-nums">{fmtNum(stats.totalQty)}</div>
            <div className="mt-2 text-[11px] text-[#86868b]">订单数量 (件 · Qty Ordered)</div>
          </div>
        </div>

        {/* ===== KPI 条 ===== */}
        <div className="grid grid-cols-2 md:grid-cols-4 border-b border-[#e8e8ed]">
          <KpiCell value={fmtNum(filtered.length)} label="PO 明细行" hint={`${fmtNum(stats.poCount)} 个 PO`} />
          <KpiCell value={fmtNum(stats.skuCount)} label="SKU 数" hint="distinct product codes" />
          <KpiCell value={fmtNum(stats.kaCount)} label="下单渠道" hint="ordering KAs" />
          <KpiCell value={fmtNum(marketCount)} label="覆盖市场" hint="active countries" last />
        </div>

        <div className="px-10 py-8">
          {/* ===== 筛选区 ===== */}
          {(viewerIsAdmin || Object.keys(countryMeta).length > 1) && (
            <div className="flex gap-2 flex-wrap mb-3">
              {viewerIsAdmin && (
                <Pill active={countryFilter === 'ALL'} onClick={() => setCountryFilter('ALL')}>
                  🌍 All EU <B>{fmtNum(filteredExceptCountry.reduce((s, r) => s + r.qty, 0))}</B>
                </Pill>
              )}
              {Object.entries(countryMeta).sort((a, b) => b[1].qty - a[1].qty).map(([code, m]) => (
                <Pill key={code} active={countryFilter === code} onClick={() => setCountryFilter(code)}>
                  <span>{m.flag}</span><span>{code}</span><B>{fmtNum(m.qty)}</B>
                </Pill>
              ))}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <Pill active={monthFilter === 'ALL'} onClick={() => setMonthFilter('ALL')}>
              📅 全部月份 <B>{fmtNum(filteredExceptMonth.reduce((s, r) => s + r.qty, 0))}</B>
            </Pill>
            {options.months.filter(m => yearFilter === 'ALL' ? true : m.startsWith(yearFilter)).map(m => {
              const qty = filteredExceptMonth.filter(r => r.po_date?.startsWith(m)).reduce((s, r) => s + r.qty, 0)
              return <Pill key={m} active={monthFilter === m} onClick={() => setMonthFilter(m)}>{m} <B>{fmtNum(qty)}</B></Pill>
            })}
          </div>

          {/* ===== 月度订单量 ===== */}
          <SectionHead title="月度订单量 · 按 PO Date" hint="柱头标注件数" />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyTrend} margin={{ top: 22, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTE }} axisLine={{ stroke: '#d2d2d7' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: MUTE }} tickFormatter={(v) => fmtNum(v)} axisLine={false} tickLine={false} />
              <Bar dataKey="qty" fill={BLUE} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={46}>
                <LabelList dataKey="qty" position="top" formatter={(v: any) => fmtNum(v)} style={{ fontSize: 11, fill: INK, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* ===== 客户订单排名 ===== */}
          <SectionHead title="客户订单排名" hint={`${currentCountryLabel} · ${monthFilter === 'ALL' ? '全部月份' : monthFilter}`} />
          <table className="w-full border-collapse">
            <tbody>
              {topKas.map((k, i) => (
                <tr key={k.name}>
                  <td className="w-6 py-3 text-[12px] font-semibold text-[#c7c7cc] font-mono border-b border-[#f0f0f3]">{i + 1}</td>
                  <td className="py-3 border-b border-[#f0f0f3]">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle" style={{ background: RANK_COLORS[i % RANK_COLORS.length] }} />
                    <span className="text-[13px] font-medium">{k.name}</span>
                  </td>
                  <td className="w-20 py-3 text-right text-[13px] font-semibold font-mono border-b border-[#f0f0f3] tabular-nums">{fmtNum(k.qty)}</td>
                  <td className="w-14 py-3 text-right text-[11px] text-[#86868b] border-b border-[#f0f0f3]">{((k.qty / rankTotal) * 100).toFixed(1)}%</td>
                </tr>
              ))}
              {!topKas.length && <tr><td className="py-8 text-center text-[#c7c7cc] text-sm" colSpan={4}>无数据</td></tr>}
            </tbody>
          </table>

          {/* ===== SKU 订单量 ===== */}
          <SectionHead title="SKU 订单量趋势" hint={`${skuTrend.length} SKUs · ${monthFilter === 'ALL' ? '全部月份' : monthFilter}`} />
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={skuTrend} margin={{ top: 22, right: 10, left: 0, bottom: 70 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f3" vertical={false} />
              <XAxis dataKey="sku" tick={{ fontSize: 10, fill: MUTE }} angle={-50} textAnchor="end" interval={0} height={90} axisLine={{ stroke: '#d2d2d7' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: MUTE }} tickFormatter={(v) => fmtNum(v)} axisLine={false} tickLine={false} />
              <Bar dataKey="qty" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={34}>
                {skuTrend.map((_, i) => <Cell key={i} fill={RANK_COLORS[i % RANK_COLORS.length]} />)}
                <LabelList dataKey="qty" position="top" formatter={(v: any) => fmtNum(v)} style={{ fontSize: 9, fill: INK }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* ===== 聚合明细 ===== */}
          <SectionHead title="订单聚合明细" hint={`月 × SKU × 渠道 · ${sortedAgg.length} 行`} />
          <div className="flex gap-2 flex-wrap items-center mb-3">
            <Sel label="年" value={yearFilter} onChange={setYearFilter} options={options.years} />
            <Sel label="月" value={monthFilter} onChange={setMonthFilter} options={options.months} />
            <Sel label="SKU" value={skuFilter} onChange={setSkuFilter} options={options.skus} />
            <Sel label="渠道" value={kaFilter} onChange={setKaFilter} options={options.kas} />
            <Sel label="类目" value={categoryFilter} onChange={setCategoryFilter} options={options.cats} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 SKU / 产品 / 渠道 / PO…"
              className="px-3 py-1.5 border border-[#d2d2d7] rounded-md text-sm w-56 bg-white" />
            <button onClick={resetFilters} className="ml-auto px-3 py-1.5 text-sm text-[#6e6e73] border border-[#d2d2d7] rounded-md hover:bg-[#f5f5f7]">重置</button>
          </div>
          <div className="text-xs text-[#86868b] mb-2">共 <strong className="text-[#1d1d1f]">{sortedAgg.length}</strong> 行 · 合计 <strong className="text-[#1d1d1f]">{fmtNum(aggTotal)}</strong> 件</div>
          <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
            <table className="w-full" style={{ font: '400 12px Arial, sans-serif' }}>
              <thead className="sticky top-0 z-10 bg-white">
                <tr>
                  <Th col="month" label="月份" sc={sortCol} sd={sortDir} on={toggleSort} />
                  <Th col="sku_code" label="SKU" sc={sortCol} sd={sortDir} on={toggleSort} />
                  <Th col="sku_name" label="产品" sc={sortCol} sd={sortDir} on={toggleSort} />
                  <Th col="ka_name" label="渠道" sc={sortCol} sd={sortDir} on={toggleSort} />
                  <Th col="country_code" label="国家" sc={sortCol} sd={sortDir} on={toggleSort} />
                  <Th col="category" label="类目" sc={sortCol} sd={sortDir} on={toggleSort} />
                  <Th col="qty" label="数量" sc={sortCol} sd={sortDir} on={toggleSort} align="right" />
                  <th className="px-3 py-3 text-right text-[11px] font-semibold text-[#86868b] uppercase border-b-2 border-[#1d1d1f]">次数</th>
                </tr>
              </thead>
              <tbody>
                {sortedAgg.map((r, i) => (
                  <tr key={i} className="hover:bg-[#f5f5f7]">
                    <td className="px-3 py-2.5 font-semibold text-[11px] border-b border-[#f0f0f3] whitespace-nowrap">{r.month}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] border-b border-[#f0f0f3]">{r.sku_code}</td>
                    <td className="px-3 py-2.5 text-[#6e6e73] border-b border-[#f0f0f3] truncate max-w-[200px]">{r.sku_name || '-'}</td>
                    <td className="px-3 py-2.5 border-b border-[#f0f0f3]">{r.ka_name}</td>
                    <td className="px-3 py-2.5 border-b border-[#f0f0f3] whitespace-nowrap">{r.country_flag} {r.country_code}</td>
                    <td className="px-3 py-2.5 border-b border-[#f0f0f3]">{r.category ? <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-[#f0f0f3] text-[#6e6e73]">{r.category}</span> : <span className="text-[#c7c7cc]">-</span>}</td>
                    <td className="px-3 py-2.5 text-right font-semibold font-mono border-b border-[#f0f0f3] tabular-nums">{fmtNum(r.qty)}</td>
                    <td className="px-3 py-2.5 text-right text-[#86868b] border-b border-[#f0f0f3]">{r.count}</td>
                  </tr>
                ))}
                {!sortedAgg.length && <tr><td colSpan={8} className="py-12 text-center text-[#c7c7cc]">无匹配记录</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============== 子组件 ==============

function KpiCell({ value, label, hint, last }: { value: string; label: string; hint?: string; last?: boolean }) {
  return (
    <div className={`px-5 py-5 border-t border-[#e8e8ed] ${last ? '' : 'md:border-r'} border-r border-[#e8e8ed]`}>
      <div className="text-[22px] font-semibold leading-none tabular-nums text-[#1d1d1f]">{value}</div>
      <div className="text-[11px] font-medium text-[#86868b] mt-2">{label}</div>
      {hint && <div className="text-[10px] text-[#c7c7cc] mt-1.5 leading-tight">{hint}</div>}
    </div>
  )
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-end justify-between border-b-2 border-[#1d1d1f] pb-3.5 mt-10 mb-6">
      <span className="text-[13px] font-semibold tracking-[.2px] text-[#1d1d1f]">{title}</span>
      {hint && <span className="text-[11px] text-[#86868b]">{hint}</span>}
    </div>
  )
}

function Pill({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition border ${
        active ? 'bg-[#1d1d1f] text-white border-[#1d1d1f] shadow' : 'bg-white text-[#1d1d1f] border-[#d2d2d7] hover:border-[#86868b]'
      }`}>
      {children}
    </button>
  )
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 px-1.5 rounded bg-black/10 text-xs font-mono">{children}</span>
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-[#86868b] text-xs">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-2 py-1 border border-[#d2d2d7] rounded-md text-sm bg-white">
        <option value="ALL">全部</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

function Th({ col, label, sc, sd, on, align }: { col: string; label: string; sc: string; sd: 'asc' | 'desc'; on: (c: string) => void; align?: 'right' }) {
  const active = col === sc
  return (
    <th onClick={() => on(col)}
      className={`px-3 py-3 text-[11px] font-semibold text-[#86868b] uppercase cursor-pointer hover:text-[#1d1d1f] select-none whitespace-nowrap border-b-2 border-[#1d1d1f] ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {label}{active && <span className="ml-1 text-[#0071e3]">{sd === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}
