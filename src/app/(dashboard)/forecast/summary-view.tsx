'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtNum } from '@/lib/utils'
import { RunControls } from './run-controls'

type Run = {
  id: number
  code: string
  region: string
  period_start: string
  period_end: string
  status: string
  filled_cells: number
  total_qty: number
  sku_count: number
  ka_count: number
  country_count: number
  created_by_name: string | null
  submitted_at: string | null
  approved_at: string | null
  published_at: string | null
}

type Cell = {
  run_id: number
  sku_id: number
  sku_code: string
  sku_name: string
  sku_category: string | null
  country_id: number
  country_code: string
  country_name: string
  month: string  // 'YYYY-MM-DD'
  qty: number
}

type Country = {
  id: number
  code: string
  name_en: string
  flag_emoji: string
  region: string
}

type Sku = { id: number; code: string; name: string; category: string | null; sort_order: number; lifecycle: string; region_scope: string[] | null }

export function ForecastSummaryView({
  runs, selectedRun, cells, allSkus, countries, lastYearData, viewerIsAdmin, viewerName,
}: {
  runs: Run[]
  selectedRun: Run
  cells: Cell[]
  allSkus: Sku[]
  countries: Country[]
  lastYearData: Record<string, Record<string, Record<string, number>>>
  viewerIsAdmin: boolean
  viewerName: string
}) {
  const router = useRouter()
  const [hideZero, setHideZero] = useState(false)
  const [peekLastYear, setPeekLastYear] = useState(false)

  // ============== 计算 4 个月份（YYYY-MM 格式）==============
  const months = useMemo(() => {
    const result: string[] = []
    const start = new Date(selectedRun.period_start)
    for (let i = 0; i < 4; i++) {
      const d = new Date(start)
      d.setMonth(d.getMonth() + i)
      result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return result
  }, [selectedRun])

  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-')
    const moNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return { ym: m, short: moNames[Number(mo) - 1], full: `${y}-${mo}` }
  })

  // ============== 构造 pivot 数据 ==============
  // 1) cell 索引: sku_code -> country_code -> YYYY-MM -> qty
  const cellIndex = useMemo(() => {
    const map: Record<string, Record<string, Record<string, number>>> = {}
    cells.forEach(c => {
      const ym = c.month.slice(0, 7)
      if (!map[c.sku_code]) map[c.sku_code] = {}
      if (!map[c.sku_code][c.country_code]) map[c.sku_code][c.country_code] = {}
      map[c.sku_code][c.country_code][ym] = (map[c.sku_code][c.country_code][ym] ?? 0) + (c.qty ?? 0)
    })
    return map
  }, [cells])

  // 国家列：直接用 EU active countries（FR/PL/ES/NL 全部展示，不管 cells 里有没有）
  const tableCountries = useMemo(() => {
    return countries.filter(c => c.region === 'EU')
  }, [countries])

  // ============== 表格 rows ==============
  type RowData = {
    sku_code: string
    sku_name: string
    sku_category: string | null
    countryMonthQty: Record<string, Record<string, number>>  // country_code -> month YYYY-MM -> qty
    monthlyTtl: Record<string, number>  // EU TTL per month
    subTotal: number
  }

  const tableRows = useMemo<RowData[]>(() => {
    // 遍历【全部 SKU】，每个 SKU 都做一行；cell 里没有的格子 = 0
    const result: RowData[] = allSkus.map(sku => {
      const cm = cellIndex[sku.code] ?? {}
      const monthlyTtl: Record<string, number> = {}
      months.forEach(m => { monthlyTtl[m] = 0 })
      const countryMonthQty: Record<string, Record<string, number>> = {}
      tableCountries.forEach(c => {
        countryMonthQty[c.code] = {}
        months.forEach(m => {
          const q = cm[c.code]?.[m] ?? 0
          countryMonthQty[c.code][m] = q
          monthlyTtl[m] += q
        })
      })
      const subTotal = months.reduce((s, m) => s + (monthlyTtl[m] ?? 0), 0)
      return {
        sku_code: sku.code,
        sku_name: sku.name,
        sku_category: sku.category,
        countryMonthQty,
        monthlyTtl,
        subTotal,
      }
    })
    // 保持 SKU master 表的顺序（sort_order/code）—— 不按数量排序
    // 隐藏空白 SKU 选项
    return hideZero ? result.filter(r => r.subTotal > 0) : result
  }, [allSkus, cellIndex, tableCountries, months, hideZero])

  // ============== 列总计（Footer）==============
  const footTotals = useMemo(() => {
    const byCountryMonth: Record<string, Record<string, number>> = {}
    const byEuMonth: Record<string, number> = {}
    let grandTotal = 0
    tableCountries.forEach(c => {
      byCountryMonth[c.code] = {}
      months.forEach(m => { byCountryMonth[c.code][m] = 0 })
    })
    months.forEach(m => { byEuMonth[m] = 0 })
    tableRows.forEach(r => {
      tableCountries.forEach(c => {
        months.forEach(m => {
          const q = r.countryMonthQty[c.code]?.[m] ?? 0
          byCountryMonth[c.code][m] += q
          byEuMonth[m] += q
        })
      })
      grandTotal += r.subTotal
    })
    return { byCountryMonth, byEuMonth, grandTotal }
  }, [tableRows, tableCountries, months])

  // ============== KPI ==============
  const totalQty = footTotals.grandTotal
  const totalByCountry = useMemo(() => {
    const map: Record<string, number> = {}
    tableCountries.forEach(c => {
      map[c.code] = months.reduce((s, m) => s + (footTotals.byCountryMonth[c.code]?.[m] ?? 0), 0)
    })
    return map
  }, [footTotals, tableCountries, months])

  // ============== 状态徽章 ==============
  const statusBadge = (() => {
    const map: Record<string, { bg: string; label: string }> = {
      draft: { bg: 'bg-gray-100 text-gray-700', label: '📝 Draft' },
      submitted: { bg: 'bg-blue-100 text-blue-700', label: '📤 Submitted' },
      approved: { bg: 'bg-purple-100 text-purple-700', label: '✓ Approved' },
      published: { bg: 'bg-green-100 text-green-700', label: '🎉 Published' },
      archived: { bg: 'bg-gray-100 text-gray-500', label: '📦 Archived' },
    }
    const s = map[selectedRun.status] ?? { bg: 'bg-gray-100', label: selectedRun.status }
    return <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${s.bg}`}>{s.label}</span>
  })()

  // ============== 导出 CSV ==============
  const exportCsv = () => {
    const lines: string[] = []
    // 表头行 1
    const h1 = ['', '']
    tableCountries.forEach(c => { for (let i = 0; i < months.length; i++) h1.push(i === 0 ? c.code : '') })
    for (let i = 0; i < months.length; i++) h1.push(i === 0 ? 'EU TTL' : '')
    h1.push('Sub-total')
    lines.push(h1.join(','))
    // 表头行 2
    const h2 = ['Model', 'Product Name']
    tableCountries.forEach(() => months.forEach(m => h2.push(m)))
    months.forEach(m => h2.push(m))
    h2.push('')
    lines.push(h2.join(','))
    // 数据
    tableRows.forEach(r => {
      const row: any[] = [r.sku_code, `"${(r.sku_name ?? '').replace(/"/g, '""')}"`]
      tableCountries.forEach(c => months.forEach(m => row.push(r.countryMonthQty[c.code]?.[m] ?? 0)))
      months.forEach(m => row.push(r.monthlyTtl[m] ?? 0))
      row.push(r.subTotal)
      lines.push(row.join(','))
    })
    // BOM + 换行
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${selectedRun.code}.csv`
    a.click()
  }

  // ============== 渲染 ==============
  return (
    <div className="p-6 max-w-[1700px] mx-auto">
      {/* Header + identity */}
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            📋 EU FCST Overview
            <span className="text-base text-gray-500 ml-2 font-normal">· GTM → HQ submission view</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {viewerIsAdmin
              ? <>Signed in as <span className="text-purple-600 font-medium">🌍 Admin ({viewerName})</span> · viewing all 4 countries · backed by <code className="bg-gray-100 px-1 rounded">forecast_eu_summary</code> view</>
              : <>Signed in as <span className="text-blue-600 font-medium">🧑‍💼 Sales ({viewerName})</span> · RLS filters to your countries</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {viewerIsAdmin && (
            <Link href={`/forecast?view=edit&run=${selectedRun.id}`} prefetch
               className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition shadow">
              ✏️ Switch to Input View
            </Link>
          )}
          {statusBadge}
          <RunControls
            selectedRun={selectedRun}
            allRuns={runs}
            viewerIsAdmin={viewerIsAdmin}
          />
        </div>
      </div>

      {/* Run selector + metadata */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm text-gray-600 font-medium">📅 Forecast cycle:</label>
          <select
            value={selectedRun.id}
            onChange={(e) => router.push(`/forecast?run=${e.target.value}`)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium"
          >
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {r.code} · {r.period_start.slice(0, 7)} ~ {r.period_end.slice(0, 7)} · {r.status}
              </option>
            ))}
          </select>
          <div className="text-xs text-gray-500">
            Created by: <span className="text-gray-700">{selectedRun.created_by_name ?? '-'}</span>
            {selectedRun.published_at && <> · Published <span className="text-gray-700">{selectedRun.published_at.slice(0, 10)}</span></>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
              Hide empty SKUs
            </label>
            <button onClick={exportCsv} className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700">
              📤 Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <KpiCard label="EU 4-month total" value={fmtNum(totalQty)} hint={`${tableRows.length} SKUs · ${tableCountries.length} countries × 4 months`} color="purple" big />
        {tableCountries.map(c => (
          <KpiCard key={c.code} label={`${c.flag_emoji} ${c.code} total`} value={fmtNum(totalByCountry[c.code] ?? 0)} hint={`${totalQty > 0 ? ((totalByCountry[c.code] ?? 0) / totalQty * 100).toFixed(1) : '0'}% of EU`} />
        ))}
        {months.map(m => (
          <KpiCard key={m} label={m} value={fmtNum(footTotals.byEuMonth[m] ?? 0)} hint="EU monthly" color="amber" />
        ))}
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-500 mb-2 flex gap-3 flex-wrap items-center">
        <Legend color="#dbeafe" label="FR France" />
        <Legend color="#fee2e2" label="PL Poland" />
        <Legend color="#fef3c7" label="ES Spain" />
        <Legend color="#fce7f3" label="NL Netherlands" />
        <Legend color="#ede9fe" label="EU TTL" />
        <Legend color="#e5e7eb" label="Sub-total (4-month sum)" textColor="text-gray-700" />
      </div>

      {/* 主表 */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[750px]">
          <table className="w-full text-sm border-collapse" style={{ minWidth: 1200 }}>
            <thead>
              {/* 第一行：分组表头 — sticky top-0 冻结 */}
              <tr className="bg-gray-50">
                <th className="sticky left-0 top-0 bg-gray-50 z-40 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r border-gray-200" rowSpan={2} style={{ minWidth: 90, maxWidth: 90 }}>SKU</th>
                <th className="sticky top-0 bg-gray-50 z-40 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b-2 border-r-2 border-gray-300" rowSpan={2} style={{ left: 90, minWidth: 200, maxWidth: 200, boxShadow: '6px 0 8px -4px rgba(91, 33, 182, 0.18)' }}>Product</th>
                {tableCountries.map(c => (
                  <th key={c.code} className={`sticky top-0 z-30 px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r-2 border-gray-300 ${countryHeaderBg(c.code)}`} colSpan={months.length}>
                    {c.flag_emoji} {c.code}
                  </th>
                ))}
                <th className="sticky top-0 z-30 px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r-2 border-gray-300 bg-purple-100 text-purple-700" colSpan={months.length}>
                  EU TTL
                </th>
                <th className="sticky top-0 z-30 px-3 py-2 text-center text-xs font-bold uppercase border-b-2 border-r border-gray-300 bg-gray-100 text-gray-700" rowSpan={2}>
                  Sub-total<br /><span className="text-[10px] font-normal opacity-80">(4 months)</span>
                </th>
              </tr>
              {/* 第二行：月份 — sticky top-[32px] 紧贴第一行 */}
              <tr className="bg-gray-50">
                {tableCountries.map(c => (
                  months.map((m, i) => (
                    <th key={`${c.code}-${m}`} className={`sticky top-[32px] z-30 px-2 py-1.5 text-center text-[11px] font-medium text-gray-600 border-b border-gray-200 ${i === months.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'} ${countryHeaderBg(c.code, true)}`}>
                      {monthLabels[i].short}
                    </th>
                  ))
                ))}
                {months.map((m, i) => (
                  <th key={`eu-${m}`} className={`sticky top-[32px] z-30 px-2 py-1.5 text-center text-[11px] font-medium text-purple-700 border-b border-gray-200 bg-purple-50 ${i === months.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'}`}>
                    {monthLabels[i].short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, ri) => (
                <tr key={r.sku_code} className="hover:bg-gray-50 group">
                  <td className="sticky left-0 bg-white group-hover:bg-gray-50 z-10 px-3 py-2 font-mono text-xs font-bold text-gray-900 border-b border-r border-gray-100" style={{ minWidth: 90, maxWidth: 90 }}>
                    {r.sku_code}
                  </td>
                  <td className="sticky bg-white group-hover:bg-gray-50 z-10 px-3 py-2 text-xs text-gray-600 border-b border-r-2 border-gray-300" style={{ left: 90, minWidth: 200, maxWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.35', boxShadow: '6px 0 8px -4px rgba(91, 33, 182, 0.18)' }}>
                    {r.sku_name || '-'}
                  </td>
                  {tableCountries.map(c => (
                    months.map((m, i) => {
                      const q = r.countryMonthQty[c.code]?.[m] ?? 0
                      return (
                        <td key={`${c.code}-${m}-${ri}`} className={`px-2 py-2 text-right text-xs tabular-nums border-b border-gray-100 ${i === months.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'} ${countryCellBg(c.code)}`}>
                          {q > 0 ? fmtNum(q) : <span className="text-gray-300">-</span>}
                        </td>
                      )
                    })
                  ))}
                  {months.map((m, i) => {
                    const q = r.monthlyTtl[m] ?? 0
                    return (
                      <td key={`eu-${m}-${ri}`} className={`px-2 py-2 text-right text-xs tabular-nums font-semibold text-purple-700 bg-purple-50 border-b border-gray-100 ${i === months.length - 1 ? 'border-r-2 border-gray-300' : 'border-r border-gray-100'}`}>
                        {q > 0 ? fmtNum(q) : <span className="text-gray-300">-</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right text-sm tabular-nums font-bold bg-gray-100 text-gray-900 border-b border-gray-200">
                    {r.subTotal > 0 ? fmtNum(r.subTotal) : '-'}
                  </td>
                </tr>
              ))}
              {!tableRows.length && (
                <tr>
                  <td colSpan={3 + tableCountries.length * months.length + months.length} className="py-12 text-center text-gray-400">
                    No data for this cycle yet · waiting for sales input or switch to another cycle
                  </td>
                </tr>
              )}
            </tbody>
            {tableRows.length > 0 && (
              <tfoot>
                <tr>
                  <td className="sticky left-0 bg-gray-100 text-gray-700 z-10 px-3 py-3 text-xs font-bold uppercase border-r border-t-2 border-gray-300" style={{ minWidth: 90, maxWidth: 90 }}>
                    TTL
                  </td>
                  <td className="sticky bg-gray-100 text-gray-700 z-10 px-3 py-3 text-xs font-medium border-r-2 border-t-2 border-gray-300" style={{ left: 90, minWidth: 200, maxWidth: 200 }}>
                    All SKUs total
                  </td>
                  {tableCountries.map(c => (
                    months.map((m, i) => (
                      <td key={`ft-${c.code}-${m}`} className={`px-2 py-3 text-right text-xs font-bold tabular-nums text-gray-800 bg-gray-100 border-t-2 border-gray-300 ${i === months.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-r-gray-200'}`}>
                        {fmtNum(footTotals.byCountryMonth[c.code]?.[m] ?? 0)}
                      </td>
                    ))
                  ))}
                  {months.map((m, i) => (
                    <td key={`ft-eu-${m}`} className={`px-2 py-3 text-right text-xs font-bold tabular-nums text-purple-700 bg-purple-100 border-t-2 border-gray-300 ${i === months.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-r-purple-200'}`}>
                      {fmtNum(footTotals.byEuMonth[m] ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-gray-900 bg-gray-200 border-t-2 border-gray-300">
                    {fmtNum(footTotals.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Footer hint */}
      <div className="mt-4 text-xs text-gray-400 text-center">
        💡 Source: <code className="bg-gray-100 px-1 rounded text-purple-600">forecast_eu_summary</code> view (KA aggregated to country level) ·
        Monthly EU TTL = FR + PL + ES + NL ·
        Sub-total = 4-month EU TTL sum
      </div>
    </div>
  )
}

// ============== 子组件 ==============

function KpiCard({ label, value, hint, color, big }: { label: string; value: string; hint?: string; color?: string; big?: boolean }) {
  const cMap: Record<string, string> = { blue: 'text-blue-600', amber: 'text-amber-600', purple: 'text-purple-600', green: 'text-green-600' }
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 ${big ? 'ring-2 ring-purple-200' : ''}`}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ? cMap[color] : 'text-gray-900'} tabular-nums`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  )
}

function Legend({ color, label, textColor }: { color: string; label: string; textColor?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm border border-gray-200" style={{ background: color }} />
      <span className={textColor ?? 'text-gray-600'}>{label}</span>
    </span>
  )
}

function countryHeaderBg(code: string, secondRow = false): string {
  const map: Record<string, [string, string]> = {
    FR: ['bg-blue-100 text-blue-700', 'bg-blue-50'],
    PL: ['bg-red-100 text-red-700', 'bg-red-50'],
    ES: ['bg-amber-100 text-amber-700', 'bg-amber-50'],
    NL: ['bg-pink-100 text-pink-700', 'bg-pink-50'],
    DE: ['bg-gray-100 text-gray-700', 'bg-gray-50'],
    SE: ['bg-cyan-100 text-cyan-700', 'bg-cyan-50'],
    GB: ['bg-violet-100 text-violet-700', 'bg-violet-50'],
  }
  return map[code]?.[secondRow ? 1 : 0] ?? 'bg-gray-100 text-gray-700'
}

function countryCellBg(code: string): string {
  const map: Record<string, string> = {
    FR: 'bg-blue-50/30', PL: 'bg-red-50/30', ES: 'bg-amber-50/30', NL: 'bg-pink-50/30',
    DE: 'bg-gray-50/30', SE: 'bg-cyan-50/30', GB: 'bg-violet-50/30',
  }
  return map[code] ?? ''
}
