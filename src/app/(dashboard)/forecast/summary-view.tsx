'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtNum } from '@/lib/utils'
import { RunControls } from './run-controls'
import { buildWorkbook, downloadWorkbook, type XCell, type XRow, type XSheet } from '@/lib/spreadsheet'

type Run = {
  id: number
  code: string
  region: string
  period_start: string
  period_end: string
  status: string
  month_count?: number   // 动态周期长度（新 cycle=3, 历史默认 4）
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

// 导出「按国家」分页用：KA 级填报明细 + KA 主数据
type KaCell = { sku_id: number; ka_id: number; month: string; qty: number }
type Ka = { id: number; name: string; country_id: number; parent_ka_id: number | null; ka_type: string | null; sort_order: number | null; is_active: boolean }

export function ForecastSummaryView({
  runs, selectedRun, cells, allSkus, countries, lastYearData,
  fdStockBySkuCode, hqCnStockBySkuCode, hqOvsStockBySkuCode, hqStockExportRows,
  kaCells = [], kas = [],
  viewerIsAdmin, viewerName,
}: {
  runs: Run[]
  selectedRun: Run
  cells: Cell[]
  allSkus: Sku[]
  countries: Country[]
  lastYearData: Record<string, Record<string, Record<string, number>>>
  fdStockBySkuCode?: Record<string, number>
  hqCnStockBySkuCode?: Record<string, number>   // HQ 国内库存
  hqOvsStockBySkuCode?: Record<string, number>  // HQ 海外仓库存
  hqStockExportRows?: { sku_code: string; sku_name: string; warehouse: string; location: string; qty: number; as_of: string }[]
  kaCells?: KaCell[]      // KA 级明细 —— 导出「按国家」分页时还原填报格式
  kas?: Ka[]
  viewerIsAdmin: boolean
  viewerName: string
}) {
  const router = useRouter()
  const [hideZero, setHideZero] = useState(false)

  // ============== 计算月份（动态：新 cycle=3, 历史=4）==============
  const monthCount = (selectedRun as any).month_count ?? 4
  const months = useMemo(() => {
    const result: string[] = []
    const start = new Date(selectedRun.period_start)
    for (let i = 0; i < monthCount; i++) {
      const d = new Date(start)
      d.setMonth(d.getMonth() + i)
      result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return result
  }, [selectedRun, monthCount])

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

  // ============== 导出 Excel：Tab1 总览 + 每国一个 Tab（还原填报格式）==============
  const exportWorkbook = () => {
    const MN = monthLabels.map(l => l.short)

    // ---- Sheet 1: Overview —— 与屏幕表格同构 ----
    const LAST = months.length - 1                         // 每个国家块的最后一个月 → 右侧加分界线
    const bd = (c: XCell): XCell => ({ ...c, bR: true })    // 给单元格加右分界线
    // 把每个国家/月的取值函数铺成一行，块末月加分界线
    const perMonthBlock = (fn: (code: string, m: string) => XCell) =>
      tableCountries.flatMap(c => months.map((m, i) => i === LAST ? bd(fn(c.code, m)) : fn(c.code, m)))
    const euBlock = (fn: (m: string) => XCell) =>
      months.map((m, i) => i === LAST ? bd(fn(m)) : fn(m))

    const g = (v: any, span?: number, s = 'grp'): XCell => ({ v, span, s })
    const head1: XRow = [
      { v: 'SKU', s: 'hdrL' }, { v: 'PRODUCT', s: 'hdrL' },
      ...tableCountries.map(c => bd(g(`${c.flag_emoji} ${c.code} ${c.name_en}`, months.length))),
      bd(g('EU TTL', months.length)),
      g(`Total (${monthCount}-month sum)`, undefined, 'grpA'),
      g('Stock-FD', undefined, 'grpA'),
      g('Stock-HQ CN', undefined, 'grpA'),
      g('Stock-HQ Oversea', undefined, 'grpA'),
    ]
    const mhdr = (m: string, i: number): XCell => i === LAST ? bd({ v: m, s: 'hdr' }) : { v: m, s: 'hdr' }
    const head2: XRow = [
      { v: '', s: 'hdr' }, { v: '', s: 'hdr' },
      ...tableCountries.flatMap(() => MN.map(mhdr)),
      ...MN.map(mhdr),
      { v: '', s: 'hdr' }, { v: '', s: 'hdr' }, { v: '', s: 'hdr' }, { v: '', s: 'hdr' },
    ]

    const num = (n: number): XCell => n > 0 ? { v: n, num: true, s: 'n0' } : { v: '-', s: 'dim' }
    const ovRows: XRow[] = [head1, head2]
    tableRows.forEach(r => ovRows.push([
      { v: r.sku_code, s: 'code' }, { v: r.sku_name },
      ...perMonthBlock((code, m) => num(r.countryMonthQty[code]?.[m] ?? 0)),
      ...euBlock(m => num(r.monthlyTtl[m] ?? 0)),
      { v: r.subTotal, num: true, s: 'sub0' },
      num(fdStockBySkuCode?.[r.sku_code] ?? 0),
      num(hqCnStockBySkuCode?.[r.sku_code] ?? 0),
      num(hqOvsStockBySkuCode?.[r.sku_code] ?? 0),
    ]))
    const sumOf = (rec?: Record<string, number>) => Object.values(rec ?? {}).reduce((s, v) => s + v, 0)
    ovRows.push([
      { v: 'TOTAL', s: 'tot' }, { v: `${tableRows.length} SKUs`, s: 'tot' },
      ...perMonthBlock((code, m) => ({ v: footTotals.byCountryMonth[code]?.[m] ?? 0, num: true, s: 'tot0' })),
      ...euBlock(m => ({ v: footTotals.byEuMonth[m] ?? 0, num: true, s: 'tot0' })),
      { v: footTotals.grandTotal, num: true, s: 'tot0' },
      { v: sumOf(fdStockBySkuCode), num: true, s: 'tot0' },
      { v: sumOf(hqCnStockBySkuCode), num: true, s: 'tot0' },
      { v: sumOf(hqOvsStockBySkuCode), num: true, s: 'tot0' },
    ])
    const sheets: XSheet[] = [{
      name: 'Overview',
      rows: ovRows,
      freezeRows: 2,
      widths: [80, 175, ...tableCountries.flatMap(() => months.map(() => 46)), ...months.map(() => 46), 62, 55, 55, 62],
    }]

    // ---- Sheet 2..N: 每个国家 —— 还原填报格式（SKU × KA × 月）----
    // KA 列：本国 active、非 group 节点；顶层 KA 后紧跟其子渠道，和填报表的 FD 分组同序
    const cellQty = new Map<string, number>()   // `${sku_id}|${ka_id}|YYYY-MM` -> qty
    kaCells.forEach(c => {
      const k = `${c.sku_id}|${c.ka_id}|${c.month.slice(0, 7)}`
      cellQty.set(k, (cellQty.get(k) ?? 0) + (c.qty ?? 0))
    })
    const byOrder = (a: Ka, b: Ka) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name)

    // 本周期有数据的 KA —— 即使已停用也必须出列，否则导出会静默丢数、与 Overview 对不上
    // （Overview 走 forecast_eu_summary，该视图不过滤 is_active）
    const kaWithData = new Set(kaCells.filter(c => (c.qty ?? 0) !== 0).map(c => c.ka_id))

    tableCountries.forEach(country => {
      const countryKas = kas.filter(k =>
        k.country_id === country.id && k.ka_type !== 'group' &&
        (k.is_active !== false || kaWithData.has(k.id)))
      const tops = countryKas.filter(k => k.parent_ka_id == null).sort(byOrder)
      const cols: { ka: Ka; fd: string | null }[] = []
      const pushed = new Set<number>()
      tops.forEach(t => {
        const kids = countryKas.filter(k => k.parent_ka_id === t.id).sort(byOrder)
        // 分销商带下级 → FD 作为分组表头、子渠道为输入列（与填报表一致）；
        // FD 自身仅在有直接数据时才单独占一列，否则不出现（避免「Bigben › Bigben」冗余列）
        if (t.ka_type === 'distributor' && kids.length > 0) {
          if (kaWithData.has(t.id)) cols.push({ ka: t, fd: t.name })
          pushed.add(t.id)
          kids.forEach(k => { cols.push({ ka: k, fd: t.name }); pushed.add(k.id) })
        } else {
          cols.push({ ka: t, fd: null }); pushed.add(t.id)
          kids.forEach(k => { cols.push({ ka: k, fd: null }); pushed.add(k.id) })
        }
      })
      countryKas.forEach(k => { if (!pushed.has(k.id)) cols.push({ ka: k, fd: null }) })  // 兜底，绝不丢列

      const h1: XRow = [{ v: 'SKU', s: 'hdrL' }, { v: 'Product', s: 'hdrL' }]
      cols.forEach(c => {
        const base = c.fd && c.fd !== c.ka.name ? `${c.fd} › ${c.ka.name}` : c.ka.name
        // 已停用但本周期仍有数据的渠道，标注出来（数据保留，避免与 Overview 对不上）
        h1.push(bd(g(c.ka.is_active === false ? `${base} (inactive)` : base, months.length)))
      })
      h1.push(bd(g('Sub-total', months.length, 'grpA')), g('Total', undefined, 'grpA'))
      const mhdrC = (m: string, i: number): XCell => i === LAST ? bd({ v: m, s: 'hdr' }) : { v: m, s: 'hdr' }
      const h2: XRow = [{ v: '', s: 'hdr' }, { v: '', s: 'hdr' },
        ...cols.flatMap(() => MN.map(mhdrC)),  // 各渠道块末月分界
        ...MN.map(mhdrC),                       // Sub-total 块
        { v: '', s: 'hdr' },                    // Total
      ]

      const rows: XRow[] = [h1, h2]
      const colTot: number[] = new Array(cols.length * months.length).fill(0)
      const monTot: number[] = new Array(months.length).fill(0)
      let grand = 0
      allSkus.forEach(sku => {
        const perMonth = months.map(() => 0)
        const cells: XCell[] = []
        cols.forEach((c, ci) => months.forEach((m, mi) => {
          const q = cellQty.get(`${sku.id}|${c.ka.id}|${m}`) ?? 0
          perMonth[mi] += q
          colTot[ci * months.length + mi] += q
          const cell: XCell = q > 0 ? { v: q, num: true, s: 'n0' } : { v: '-', s: 'dim' }
          cells.push(mi === LAST ? bd(cell) : cell)
        }))
        const rowTot = perMonth.reduce((s, v) => s + v, 0)
        if (hideZero && rowTot === 0) return
        perMonth.forEach((v, i) => { monTot[i] += v })
        grand += rowTot
        rows.push([
          { v: sku.code, s: 'code' }, { v: sku.name }, ...cells,
          ...perMonth.map((v, i) => {
            const cell: XCell = v > 0 ? { v, num: true, s: 'sub0' } : { v: '-', s: 'dim' }
            return i === LAST ? bd(cell) : cell
          }),
          rowTot > 0 ? { v: rowTot, num: true, s: 'sub0' } : { v: '-', s: 'dim' },
        ])
      })
      rows.push([
        { v: 'TOTAL', s: 'tot' }, { v: `${country.name_en}`, s: 'tot' },
        ...colTot.map((v, idx) => { const cell: XCell = { v, num: true, s: 'tot0' }; return idx % months.length === LAST ? bd(cell) : cell }),
        ...monTot.map((v, i) => { const cell: XCell = { v, num: true, s: 'tot0' }; return i === LAST ? bd(cell) : cell }),
        { v: grand, num: true, s: 'tot0' },
      ])

      sheets.push({
        name: `${country.code} ${country.name_en}`,
        rows,
        freezeRows: 2,
        widths: [80, 175, ...cols.flatMap(() => months.map(() => 46)), ...months.map(() => 46), 62],
      })
    })

    downloadWorkbook(buildWorkbook(sheets), `${selectedRun.code}-FCST`)
  }

  // ============== 导出 Stock CSV（仓库级明细，给客户的下载版本）==============
  // 格式（Chris 定）：每个仓库一行，海外仓不合并；含国内（生产部）与各海外仓
  const exportStockCsv = () => {
    const rows = hqStockExportRows ?? []
    const lines: string[] = []
    lines.push(['SKU', 'Product Name', 'Warehouse', 'Location', 'Qty', 'As of'].join(','))
    rows.forEach(r => {
      lines.push([
        r.sku_code,
        `"${(r.sku_name ?? '').replace(/"/g, '""')}"`,
        `"${r.warehouse.replace(/"/g, '""')}"`,
        r.location,
        r.qty,
        r.as_of,
      ].join(','))
    })
    // 合计行
    lines.push(['TOTAL', '', '', '', rows.reduce((s, r) => s + r.qty, 0), ''].join(','))
    // BOM（仓库名含中文，Excel 需要 BOM 才不乱码）
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `INIU-stock-${new Date().toISOString().slice(0, 10)}.csv`
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
            <button onClick={exportWorkbook}
              title="导出 Excel：第 1 页总览（同本页表格），之后每国一页、还原填报格式（SKU × 渠道 × 月）"
              className="px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700">
              ⬇️ Export FCST Excel
            </button>
            <button onClick={exportStockCsv}
              title="导出 HQ 库存仓库级明细（国内 + 各海外仓逐行），可直接发给客户"
              className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700">
              📤 Export Stock CSV
            </button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <KpiCard label={`EU ${monthCount}-month total`} value={fmtNum(totalQty)} hint={`${tableRows.length} SKUs · ${tableCountries.length} countries × ${monthCount} months`} color="purple" big />
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
        <Legend color="#fef3c7" label={`Total (${monthCount}-month sum) · Stock`} textColor="text-amber-800" />
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
                {/* TOTAL block：Total / Stock-FD 占双行，Stock-HQ 分组下挂 CN / Oversea */}
                <th className="sticky top-0 z-30 px-2 py-1.5 text-center text-[11px] font-bold uppercase text-amber-800 border-b border-r border-gray-200 bg-amber-100 align-middle" rowSpan={2}>
                  Total
                </th>
                <th className="sticky top-0 z-30 px-2 py-1.5 text-center text-[11px] font-bold uppercase text-amber-800 border-b border-r border-gray-200 bg-amber-100 align-middle" rowSpan={2} title="Stock from FD (channel distributor latest)">
                  Stock-FD
                </th>
                <th className="sticky top-0 z-30 px-3 py-2 text-center text-xs font-bold uppercase border-b border-r border-gray-300 bg-amber-100 text-amber-800" colSpan={2}>
                  Stock-HQ
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
                {/* Stock-HQ 子列 */}
                <th className="sticky top-[32px] z-30 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" title="HQ 国内库存 (domestic warehouse)">
                  CN
                </th>
                <th className="sticky top-[32px] z-30 px-2 py-1.5 text-center text-[11px] font-medium text-amber-700 border-b border-r border-gray-200 bg-amber-50" title="HQ 海外仓库存 (overseas warehouse)">
                  Oversea
                </th>
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
                  {/* TOTAL block */}
                  <td className="px-2 py-2 text-right text-sm tabular-nums font-bold bg-amber-50 text-amber-900 border-b border-r border-amber-200">
                    {r.subTotal > 0 ? fmtNum(r.subTotal) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums bg-amber-50 text-gray-700 border-b border-r border-amber-200">
                    {(fdStockBySkuCode?.[r.sku_code] ?? 0) > 0 ? fmtNum(fdStockBySkuCode![r.sku_code]) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums bg-amber-50 text-gray-700 border-b border-r border-amber-200">
                    {(hqCnStockBySkuCode?.[r.sku_code] ?? 0) > 0 ? fmtNum(hqCnStockBySkuCode![r.sku_code]) : <span className="text-gray-300" title="HQ domestic stock not yet imported">-</span>}
                  </td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums bg-amber-50 text-gray-700 border-b border-r border-amber-200">
                    {(hqOvsStockBySkuCode?.[r.sku_code] ?? 0) > 0 ? fmtNum(hqOvsStockBySkuCode![r.sku_code]) : <span className="text-gray-300" title="HQ overseas stock not yet imported">-</span>}
                  </td>
                </tr>
              ))}
              {!tableRows.length && (
                <tr>
                  <td colSpan={2 + tableCountries.length * months.length + months.length + 4} className="py-12 text-center text-gray-400">
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
                  {/* TOTAL block footer */}
                  <td className="px-2 py-3 text-right text-sm font-bold tabular-nums bg-amber-100 text-amber-900 border-r border-t-2 border-amber-300">
                    {fmtNum(footTotals.grandTotal)}
                  </td>
                  <td className="px-2 py-3 text-right text-xs font-bold tabular-nums bg-amber-50 text-gray-700 border-r border-t-2 border-amber-300">
                    {(() => {
                      const t = Object.values(fdStockBySkuCode ?? {}).reduce((s, v) => s + v, 0)
                      return t > 0 ? fmtNum(t) : '-'
                    })()}
                  </td>
                  <td className="px-2 py-3 text-right text-xs font-bold tabular-nums bg-amber-50 text-gray-700 border-r border-t-2 border-amber-300">
                    {(() => {
                      const t = Object.values(hqCnStockBySkuCode ?? {}).reduce((s, v) => s + v, 0)
                      return t > 0 ? fmtNum(t) : '-'
                    })()}
                  </td>
                  <td className="px-2 py-3 text-right text-xs font-bold tabular-nums bg-amber-50 text-gray-700 border-r border-t-2 border-amber-300">
                    {(() => {
                      const t = Object.values(hqOvsStockBySkuCode ?? {}).reduce((s, v) => s + v, 0)
                      return t > 0 ? fmtNum(t) : '-'
                    })()}
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
        Total = {monthCount}-month sum of EU TTL
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
