'use client'

import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { fmtNum } from '@/lib/utils'

type FlatRow = {
  id: number
  effective_date: string
  ship_date: string | null
  plan_date: string | null
  delivery_date: string | null
  qty: number
  status: string
  po_number: string | null
  source_type: string
  internal_customer_name: string | null
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

export function ShipmentsView({ rows, viewerIsAdmin, viewerName, marketCount }: { rows: FlatRow[]; viewerIsAdmin: boolean; viewerName: string; marketCount: number }) {
  // ============== 筛选状态 ==============
  const [yearFilter, setYearFilter] = useState<string>(String(new Date().getFullYear()))
  const [countryFilter, setCountryFilter] = useState<string>('ALL')
  const [monthFilter, setMonthFilter] = useState<string>('ALL')
  const [skuFilter, setSkuFilter] = useState<string>('ALL')
  const [kaFilter, setKaFilter] = useState<string>('ALL')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [search, setSearch] = useState<string>('')
  const [excludeInternal, setExcludeInternal] = useState<boolean>(true)
  const [sortCol, setSortCol] = useState<string>('month')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // ============== 衍生：除国家外的筛选（用于国家 pills 数字保持原值） ==============
  const filteredExceptCountry = useMemo(() => {
    return rows.filter(r => {
      if (excludeInternal && r.source_type === 'internal_replenish') return false
      if (yearFilter !== 'ALL') {
        const year = r.effective_date?.slice(0, 4) ?? ''
        if (year !== yearFilter) return false
      }
      const ym = r.effective_date?.slice(0, 7) ?? ''
      if (monthFilter !== 'ALL' && ym !== monthFilter) return false
      if (skuFilter !== 'ALL' && r.sku_code !== skuFilter) return false
      if (kaFilter !== 'ALL' && r.ka_name !== kaFilter) return false
      if (categoryFilter !== 'ALL' && r.sku_category !== categoryFilter) return false
      if (search) {
        const s = search.toLowerCase()
        if (
          !r.sku_code?.toLowerCase().includes(s) &&
          !r.sku_name?.toLowerCase().includes(s) &&
          !r.ka_name?.toLowerCase().includes(s) &&
          !r.po_number?.toLowerCase().includes(s)
        ) return false
      }
      return true
    })
  }, [rows, yearFilter, excludeInternal, monthFilter, skuFilter, kaFilter, categoryFilter, search])

  const filtered = useMemo(() => {
    if (countryFilter === 'ALL') return filteredExceptCountry
    return filteredExceptCountry.filter(r => r.country_code === countryFilter)
  }, [filteredExceptCountry, countryFilter])

  // 衍生：除 month filter 外其他都应用 —— 让月份 pills 显示"该月独立 qty"，不被当前选中月份归零
  const filteredExceptMonth = useMemo(() => {
    return rows.filter(r => {
      if (excludeInternal && r.source_type === 'internal_replenish') return false
      if (yearFilter !== 'ALL') {
        const year = r.effective_date?.slice(0, 4) ?? ''
        if (year !== yearFilter) return false
      }
      // 跳过 monthFilter
      if (countryFilter !== 'ALL' && r.country_code !== countryFilter) return false
      if (skuFilter !== 'ALL' && r.sku_code !== skuFilter) return false
      if (kaFilter !== 'ALL' && r.ka_name !== kaFilter) return false
      if (categoryFilter !== 'ALL' && r.sku_category !== categoryFilter) return false
      if (search) {
        const s = search.toLowerCase()
        if (
          !r.sku_code?.toLowerCase().includes(s) &&
          !r.sku_name?.toLowerCase().includes(s) &&
          !r.ka_name?.toLowerCase().includes(s) &&
          !r.po_number?.toLowerCase().includes(s)
        ) return false
      }
      return true
    })
  }, [rows, yearFilter, excludeInternal, countryFilter, skuFilter, kaFilter, categoryFilter, search])

  // ============== KPI ==============
  const stats = useMemo(() => {
    const totalQty = filtered.reduce((s, r) => s + r.qty, 0)
    const shippedCount = filtered.filter(r => r.status === 'shipped' || r.status === 'delivered').length
    const plannedCount = filtered.filter(r => r.status === 'planned').length
    const skuCount = new Set(filtered.map(r => r.sku_code)).size
    const kaCount = new Set(filtered.filter(r => r.ka_name).map(r => r.ka_name)).size
    const countryCount = new Set(filtered.map(r => r.country_code)).size
    return { totalQty, shippedCount, plannedCount, skuCount, kaCount, countryCount }
  }, [filtered])

  // ============== 筛选选项 ==============
  const options = useMemo(() => {
    const months = Array.from(new Set(rows.map(r => r.effective_date?.slice(0, 7) ?? ''))).filter(Boolean).sort().reverse()
    const skus = Array.from(new Set(rows.map(r => r.sku_code))).sort()
    const kas = Array.from(new Set(rows.filter(r => r.ka_name).map(r => r.ka_name as string))).sort()
    const cats = Array.from(new Set(rows.map(r => r.sku_category).filter(Boolean) as string[])).sort()
    const years = Array.from(new Set(rows.map(r => r.effective_date?.slice(0, 4) ?? ''))).filter(Boolean).sort().reverse()
    return { months, skus, kas, cats, years }
  }, [rows])

  // ============== 国家 pills ==============
  const countryMeta = useMemo(() => {
    const map: Record<string, { flag: string; name: string; qty: number }> = {}
    rows.forEach(r => {
      if (!map[r.country_code]) map[r.country_code] = { flag: r.country_flag, name: r.country_name, qty: 0 }
    })
    filteredExceptCountry.forEach(r => {
      if (map[r.country_code]) map[r.country_code].qty += r.qty
    })
    return map
  }, [rows, filteredExceptCountry])

  // 当前作用域显示用 label（用中文国家名，更友好）：
  //  · 选了具体国家 → 该国 name（如 "法国"）
  //  · 没选（'ALL'）+ admin → "欧洲"
  //  · 没选 + 单国 sales → 该国 name
  //  · 没选 + 多国 sales → 拼接所有国家名（如 "法国 + 荷兰"）
  const countryCodes = Object.keys(countryMeta)
  const currentCountryLabel = (() => {
    if (countryFilter !== 'ALL') return countryMeta[countryFilter]?.name ?? countryFilter
    if (viewerIsAdmin) return 'EU'
    if (countryCodes.length === 1) return Object.values(countryMeta)[0]?.name ?? countryCodes[0]
    // 多国 sales：按 qty 排序拼接
    return Object.entries(countryMeta)
      .sort((a, b) => b[1].qty - a[1].qty)
      .map(([_, m]) => m.name)
      .join(' + ')
  })()

  // ============== 月度趋势 + Top KA 数据 ==============
  const monthlyTrend = useMemo(() => {
    const m: Record<string, number> = {}
    filtered.forEach(r => {
      const ym = r.effective_date?.slice(0, 7) ?? ''
      if (ym) m[ym] = (m[ym] ?? 0) + r.qty
    })
    return Object.entries(m).sort().map(([month, qty]) => ({ month, qty }))
  }, [filtered])

  const topKas = useMemo(() => {
    const m: Record<string, number> = {}
    filtered.forEach(r => {
      const name = r.ka_name ?? r.internal_customer_name ?? 'Unspecified'
      m[name] = (m[name] ?? 0) + r.qty
    })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, qty]) => ({ name, qty }))
  }, [filtered])

  // ============== SKU 趋势（柱形图）==============
  const skuTrend = useMemo(() => {
    const m: Record<string, number> = {}
    filtered.forEach(r => {
      m[r.sku_code] = (m[r.sku_code] ?? 0) + r.qty
    })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([sku, qty]) => ({ sku, qty }))
  }, [filtered])

  // ============== 聚合表数据（月 × SKU × KA × 国家 × 类目） ==============
  type AggRow = { month: string; sku_code: string; sku_name: string; ka_name: string; country_code: string; country_name: string; country_flag: string; category: string | null; qty: number; count: number }
  const aggRows = useMemo<AggRow[]>(() => {
    const map = new Map<string, AggRow>()
    filtered.forEach(r => {
      const ym = r.effective_date?.slice(0, 7) ?? ''
      const ka = r.ka_name ?? r.internal_customer_name ?? '-'
      const key = `${ym}|${r.sku_code}|${ka}|${r.country_code}`
      const existing = map.get(key)
      if (existing) {
        existing.qty += r.qty
        existing.count += 1
      } else {
        map.set(key, {
          month: ym,
          sku_code: r.sku_code,
          sku_name: r.sku_name,
          ka_name: ka,
          country_code: r.country_code,
          country_name: r.country_name,
          country_flag: r.country_flag,
          category: r.sku_category,
          qty: r.qty,
          count: 1,
        })
      }
    })
    return Array.from(map.values())
  }, [filtered])

  // 排序
  const sortedAgg = useMemo(() => {
    const arr = [...aggRows]
    arr.sort((a: any, b: any) => {
      const va = a[sortCol]; const vb = b[sortCol]
      if (typeof va === 'number' && typeof vb === 'number') {
        const cmp = sortDir === 'asc' ? va - vb : vb - va
        if (cmp !== 0) return cmp
        // 次要排序：相同时按数量降序
        return b.qty - a.qty
      }
      const cmp = sortDir === 'asc'
        ? String(va ?? '').localeCompare(String(vb ?? ''))
        : String(vb ?? '').localeCompare(String(va ?? ''))
      if (cmp !== 0) return cmp
      return b.qty - a.qty
    })
    return arr
  }, [aggRows, sortCol, sortDir])

  const aggTotal = sortedAgg.reduce((s, r) => s + r.qty, 0)

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
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header + identity */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">📊 Shipments</h1>
        <p className="text-sm text-gray-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {viewerIsAdmin ? (
            <>
              <span>Signed in as <span className="text-purple-600 font-medium">🌍 Admin ({viewerName})</span> · viewing all countries · "Overseas warehouse / DTC restock" excluded (toggle in filters)</span>
            </>
          ) : (
            <>
              <span>Signed in as <span className="text-blue-600 font-medium">🧑‍💼 Sales ({viewerName})</span></span>
              {Object.entries(countryMeta).sort((a, b) => b[1].qty - a[1].qty).map(([code, m]) => (
                <span key={code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700">
                  <span>{m.flag}</span>
                  <span className="font-medium">{m.name}</span>
                  <span className="text-xs text-gray-500">·</span>
                  <strong className="tabular-nums">{fmtNum(m.qty)}</strong>
                  <span className="text-xs text-gray-500">units</span>
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      {/* 5 KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <KpiCard label="Total Shipped" value={fmtNum(stats.totalQty)} hint="units" />
        <KpiCard label="Shipment Records" value={fmtNum(filtered.length)} hint={`Shipped ${stats.shippedCount} · Planned ${stats.plannedCount}`} color="blue" />
        <KpiCard label="SKUs" value={fmtNum(stats.skuCount)} hint="distinct product codes" color="purple" />
        <KpiCard label="Key Accounts" value={fmtNum(stats.kaCount)} hint="KAs / restock types" color="amber" />
        <KpiCard label="Markets" value={fmtNum(marketCount)} hint="active countries" color="green" />
      </div>

      {/* Top two charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">📈 Monthly shipment volume</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyTrend} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
              <Bar dataKey="qty" fill="#3b82f6" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="qty" position="top" formatter={(v: any) => fmtNum(v)} style={{ fontSize: 11, fill: '#374151' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">🏢 Top 10 key accounts by volume</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topKas} layout="vertical" margin={{ top: 5, right: 60, left: 60, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
              <Bar dataKey="qty" fill="#10b981" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                <LabelList dataKey="qty" position="right" formatter={(v: any) => fmtNum(v)} style={{ fontSize: 11, fill: '#374151' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Business metrics block (placeholder cards + pills + SKU trend) */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <span className="text-base font-semibold text-gray-700">
            📈 {currentCountryLabel} business metrics
          </span>
          {viewerIsAdmin && <span className="text-xs text-gray-400">Each market operates independently · switch country to view per-market metrics</span>}
        </div>

        {/* Country pills: admin sees all + each; multi-country sales only sees each (no "All"); single-country sales hides whole row (already shown in subtitle) */}
        {(viewerIsAdmin || Object.keys(countryMeta).length > 1) && (
          <div className="flex gap-2 flex-wrap mb-3">
            {viewerIsAdmin && (
              <PillButton color="purple" active={countryFilter === 'ALL'} onClick={() => setCountryFilter('ALL')}>
                🌍 All EU <Badge>{fmtNum(filteredExceptCountry.reduce((s, r) => s + r.qty, 0))}</Badge>
              </PillButton>
            )}
            {Object.entries(countryMeta).sort((a, b) => b[1].qty - a[1].qty).map(([code, m]) => (
              <PillButton key={code} color="purple" active={countryFilter === code} onClick={() => setCountryFilter(code)}>
                <span>{m.flag}</span><span>{code}</span><Badge>{fmtNum(m.qty)}</Badge>
              </PillButton>
            ))}
          </div>
        )}

        {/* Month pills (qty based on filteredExceptMonth: selecting one month doesn't zero out others) */}
        <div className="flex gap-2 flex-wrap mb-4">
          <PillButton color="amber" active={monthFilter === 'ALL'} onClick={() => setMonthFilter('ALL')}>
            📅 All months <Badge>{fmtNum(filteredExceptMonth.reduce((s, r) => s + r.qty, 0))}</Badge>
          </PillButton>
          {options.months
            .filter(m => {
              if (yearFilter === 'ALL') return true
              return m.startsWith(yearFilter)
            })
            .map(m => {
              const qty = filteredExceptMonth.filter(r => r.effective_date?.startsWith(m)).reduce((s, r) => s + r.qty, 0)
              return (
                <PillButton key={m} color="amber" active={monthFilter === m} onClick={() => setMonthFilter(m)}>
                  {m} <Badge>{fmtNum(qty)}</Badge>
                </PillButton>
              )
            })}
        </div>

        {/* 3 placeholder cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <PlaceholderCard icon="💶" title="Revenue" desc="Monthly / KA / SKU revenue" hint={`Pending data entry (${currentCountryLabel})`} />
          <PlaceholderCard icon="🏷️" title="Unit Price" desc="SKU unit price / price trend" hint={`Pending data entry (${currentCountryLabel})`} />
          <PlaceholderCard icon="🎯" title="Target" desc="Monthly / quarterly target & attainment" hint={`Pending data entry (${currentCountryLabel})`} />
        </div>

        {/* SKU trend bar chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-700">
              📊 SKU shipment volume trend
              <span className="ml-2 text-xs text-gray-400">· {currentCountryLabel} · {monthFilter === 'ALL' ? 'All months' : monthFilter}</span>
            </div>
            <div className="text-xs text-gray-400">{skuTrend.length} SKUs</div>
          </div>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={skuTrend} margin={{ top: 25, right: 10, left: 0, bottom: 70 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="sku" tick={{ fontSize: 10 }} angle={-50} textAnchor="end" interval={0} height={90} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
              <Bar dataKey="qty" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {skuTrend.map((entry, i) => (
                  <Cell key={i} fill={`hsl(${Math.round((i * 360) / Math.max(skuTrend.length, 1))}, 65%, 55%)`} />
                ))}
                <LabelList dataKey="qty" position="top" formatter={(v: any) => fmtNum(v)} style={{ fontSize: 10, fill: '#374151' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Month × SKU × KA aggregation table */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-base font-semibold text-gray-900 mb-3">📋 Month × SKU × KA aggregation</div>

        {/* Filter row */}
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <FilterSelect label="Year" value={yearFilter} onChange={setYearFilter} options={options.years} />
          <FilterSelect label="Month" value={monthFilter} onChange={setMonthFilter} options={options.months} />
          <FilterSelect label="SKU" value={skuFilter} onChange={setSkuFilter} options={options.skus} />
          <FilterSelect label="KA" value={kaFilter} onChange={setKaFilter} options={options.kas} />
          <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter} options={options.cats} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU / product / account / PO..."
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-60"
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={excludeInternal} onChange={(e) => setExcludeInternal(e.target.checked)} />
            Exclude internal restock
          </label>
          <button onClick={resetFilters} className="ml-auto px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">
            Reset
          </button>
        </div>

        <div className="text-xs text-gray-500 mb-2">
          Showing <strong className="text-gray-900">{sortedAgg.length}</strong> rows · Total <strong className="text-gray-900">{fmtNum(aggTotal)}</strong> units ·
          <span className="text-purple-600 ml-1">Unit Price / Revenue / Target — pending data entry</span>
        </div>

        <div className="overflow-x-auto max-h-[700px] overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <SortableHeader col="month" label="Month" currentCol={sortCol} currentDir={sortDir} onClick={toggleSort} />
                <SortableHeader col="sku_code" label="SKU" currentCol={sortCol} currentDir={sortDir} onClick={toggleSort} />
                <SortableHeader col="sku_name" label="Product" currentCol={sortCol} currentDir={sortDir} onClick={toggleSort} />
                <SortableHeader col="ka_name" label="KA" currentCol={sortCol} currentDir={sortDir} onClick={toggleSort} />
                <SortableHeader col="country_code" label="Country" currentCol={sortCol} currentDir={sortDir} onClick={toggleSort} />
                <SortableHeader col="category" label="Category" currentCol={sortCol} currentDir={sortDir} onClick={toggleSort} />
                <SortableHeader col="qty" label="Qty" currentCol={sortCol} currentDir={sortDir} onClick={toggleSort} align="right" />
                <th className="px-4 py-3 text-right text-xs font-semibold text-purple-500 uppercase">Unit Price</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-purple-500 uppercase">Revenue</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-purple-500 uppercase">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedAgg.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">{r.month}</span></td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{r.sku_code}</td>
                  <td className="px-4 py-2 text-gray-600 truncate max-w-xs">{r.sku_name || '-'}</td>
                  <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">{r.ka_name}</span></td>
                  <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">{r.country_flag} {r.country_name}</span></td>
                  <td className="px-4 py-2"><CategoryBadge cat={r.category} /></td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtNum(r.qty)}</td>
                  <td className="px-4 py-2 text-right text-purple-300 italic text-xs">pending</td>
                  <td className="px-4 py-2 text-right text-purple-300 italic text-xs">pending</td>
                  <td className="px-4 py-2 text-right text-purple-300 italic text-xs">pending</td>
                </tr>
              ))}
              {!sortedAgg.length && <tr><td colSpan={10} className="py-12 text-center text-gray-400">No matching records</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============== 子组件 ==============

function KpiCard({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  const cMap: Record<string, string> = { blue: 'text-blue-600', amber: 'text-amber-600', purple: 'text-purple-600', green: 'text-green-600' }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ? cMap[color] : 'text-gray-900'} tabular-nums`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  )
}

function PillButton({ children, active, onClick, color }: { children: React.ReactNode; active: boolean; onClick: () => void; color: 'purple' | 'amber' }) {
  const activeStyle = color === 'purple' ? 'bg-purple-600 text-white border-purple-600 shadow' : 'bg-amber-500 text-white border-amber-500 shadow'
  const hoverStyle = color === 'purple' ? 'hover:border-purple-400' : 'hover:border-amber-400'
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition border ${
        active ? activeStyle : `bg-white text-gray-700 border-gray-300 ${hoverStyle}`
      }`}
    >
      {children}
    </button>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 px-1.5 rounded bg-black/10 text-xs">{children}</span>
}

function PlaceholderCard({ icon, title, desc, hint }: { icon: string; title: string; desc: string; hint: string }) {
  return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-5 text-center hover:border-purple-400 transition">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-base font-semibold text-gray-700 mb-1">{title}</div>
      <div className="text-xs text-gray-500 mb-3">{desc}</div>
      <div className="inline-block px-3 py-1 rounded-full bg-gray-100 text-xs text-gray-500">{hint}</div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-gray-600 text-xs">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-md text-sm">
        <option value="ALL">All</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

function SortableHeader({ col, label, currentCol, currentDir, onClick, align }:
  { col: string; label: string; currentCol: string; currentDir: 'asc' | 'desc'; onClick: (c: string) => void; align?: 'right' }) {
  const active = col === currentCol
  return (
    <th
      onClick={() => onClick(col)}
      className={`px-4 py-3 text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {label}
      {active && <span className="ml-1 text-purple-600">{currentDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}

function CategoryBadge({ cat }: { cat: string | null }) {
  if (!cat) return <span className="text-gray-300">-</span>
  return <span className="inline-block px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">{cat}</span>
}
