import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { ForecastSummaryView } from './summary-view'
import { ForecastEditView } from './edit-view'
import { redirect } from 'next/navigation'

type SearchParams = { run?: string; view?: 'summary' | 'edit'; country?: string }

export default async function ForecastPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getCurrentUser()
  const supabase = createClient()

  // —— 拉 forecast_runs 列表（admin/sales 都需要看到所有周期）——
  const { data: runs, error: runsErr } = await supabase
    .from('forecast_run_summary')
    .select('id, code, region, period_start, period_end, status, month_count, filled_cells, total_qty, sku_count, ka_count, country_count, created_by_name, submitted_at, approved_at, published_at')
    .eq('region', 'EU')
    .order('period_start', { ascending: false })

  if (runsErr) {
    return <ErrorBlock msg={`Failed to load forecast cycles: ${runsErr.message}`} />
  }

  if (!runs?.length) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">📈 Demand Forecast</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">📋</div>
          <div className="text-gray-700 font-medium mb-1">No forecast cycles yet</div>
          <div className="text-sm text-gray-500">{me.isAdmin ? 'Use the button above to create the first cycle' : 'Waiting for HQ to create the current cycle'}</div>
        </div>
      </div>
    )
  }

  const selectedRunId = searchParams?.run ? Number(searchParams.run) : runs[0].id
  const selectedRun = runs.find(r => r.id === selectedRunId) ?? runs[0]

  // —— 决定显示哪个视图 ——
  // - 显式 URL 参数最优先
  // - 否则按角色默认：admin → summary, sales → edit
  const requestedView = searchParams?.view
  const view: 'summary' | 'edit' =
    requestedView === 'summary' ? 'summary'
    : requestedView === 'edit' ? 'edit'
    : (me.isAdmin ? 'summary' : 'edit')

  if (view === 'summary') {
    return <SummaryPage me={me} runs={runs} selectedRun={selectedRun} supabase={supabase} />
  } else {
    return <EditPage me={me} runs={runs} selectedRun={selectedRun} supabase={supabase} countryParam={searchParams?.country} />
  }
}

// ============ Summary View（admin 默认 / 显式 view=summary）============
async function SummaryPage({ me, runs, selectedRun, supabase }: any) {
  // 去年同期数据窗口（hover-peek 备用） — 窗口长度跟随 month_count
  const startDate = new Date(selectedRun.period_start)
  const monthCount = (selectedRun as any).month_count ?? 4
  const lyStart = new Date(startDate); lyStart.setFullYear(lyStart.getFullYear() - 1)
  const lyEnd = new Date(lyStart); lyEnd.setMonth(lyEnd.getMonth() + monthCount)

  // 这 4 个查询互不依赖 → 并行（原本串行 4 个往返，现在 1 个往返延迟）
  // RLS 自动按用户身份过滤
  const [
    { data: cells },          // cells（KA 已聚合到国家级）
    { data: allSkus },
    { data: allEuCountries },
    { data: lyData },         // 去年同期 shipment
    { data: kaCellsRaw },     // KA 级明细 —— 仅用于导出「按国家」分页（还原填报格式）
    { data: allKas },
  ] = await Promise.all([
    supabase
      .from('forecast_eu_summary')
      .select('run_id, sku_id, sku_code, sku_name, sku_category, country_id, country_code, country_name, month, qty')
      .eq('run_id', selectedRun.id),
    supabase
      .from('sku')
      .select('id, code, name, category, series, sort_order, lifecycle, region_scope')
      .eq('is_active', true)
      .order('sort_order')
      .order('code'),
    supabase
      .from('country')
      .select('id, code, name_en, flag_emoji, region, sort_order')
      .eq('region', 'EU').eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('shipment')
      .select(`qty, effective_date, sku:sku_id ( id, code ), country:country_id ( id, code )`)
      .eq('source_type', 'channel')
      .gte('effective_date', lyStart.toISOString().slice(0, 10))
      .lt('effective_date', lyEnd.toISOString().slice(0, 10)),
    supabase
      .from('forecast_cell')
      .select('sku_id, ka_id, month, qty')
      .eq('run_id', selectedRun.id),
    supabase
      .from('ka')
      .select('id, name, country_id, parent_ka_id, ka_type, sort_order, is_active')
      .order('country_id').order('sort_order').order('name'),
  ])

  // 🔐 admin 看全部 EU，sales 只看自己负责的国家
  const countries = (allEuCountries ?? []).filter((c: any) => me.canAccessCountry(c.id))

  const ly: Record<string, Record<string, Record<string, number>>> = {}
  ;(lyData ?? []).forEach((r: any) => {
    const skuCode = r.sku?.code, ctryCode = r.country?.code
    const ym = String(r.effective_date).slice(0, 7)
    if (!skuCode || !ctryCode) return
    if (!ly[skuCode]) ly[skuCode] = {}
    if (!ly[skuCode][ctryCode]) ly[skuCode][ctryCode] = {}
    ly[skuCode][ctryCode][ym] = (ly[skuCode][ctryCode][ym] ?? 0) + (r.qty ?? 0)
  })

  // ───── Stock from FD/HQ：按 SKU 聚合（admin summary 跨 KA 跨国家汇总到 SKU 级）─────
  // RLS 自动过滤 admin 看全部 / sales 看自己国家
  const [{ data: fdStockRaw }, { data: hqStockRaw }] = await Promise.all([
    supabase.from('weekly_psi_v2')
      .select('country_id, ka_id, sku_id, week_start, stock_qty')
      .gte('week_start', new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10))
      .order('week_start', { ascending: false })
      .range(0, 49999),
    supabase.from('hq_stock')
      .select('sku_id, stock_qty, as_of_date, location, warehouse')
      .order('as_of_date', { ascending: false })
      .range(0, 9999),
  ])

  // fdBySku[sku_code] = sum of latest stock_qty across all KAs and countries
  // 用三层 map 防重复：先按 (country, ka, sku) 取最新一周，再 sum 到 sku
  const fdLatestByCKSku: Record<string, number> = {}  // key = `${country_id}|${ka_id}|${sku_id}`
  ;(fdStockRaw ?? []).forEach((r: any) => {
    if (r.stock_qty === null || r.stock_qty === undefined) return
    const k = `${r.country_id}|${r.ka_id}|${r.sku_id}`
    if (fdLatestByCKSku[k] === undefined) fdLatestByCKSku[k] = Number(r.stock_qty)
  })
  const fdBySkuId: Record<number, number> = {}
  Object.entries(fdLatestByCKSku).forEach(([k, v]) => {
    const sku_id = Number(k.split('|')[2])
    fdBySkuId[sku_id] = (fdBySkuId[sku_id] ?? 0) + v
  })

  // hqBySku：HQ 库存 = SKU × 仓库 粒度（共享池）。每个 (sku, warehouse) 取最新一条，再按 location 汇总到 SKU
  const hqLatestBySkuWh: Record<string, { qty: number; location: string; as_of: string }> = {}
  ;(hqStockRaw ?? []).forEach((r: any) => {
    const k = `${r.sku_id}|${r.warehouse ?? 'legacy'}`
    if (hqLatestBySkuWh[k] === undefined) {
      hqLatestBySkuWh[k] = { qty: Number(r.stock_qty), location: r.location, as_of: r.as_of_date }
    }
  })
  const hqCnBySkuId: Record<number, number> = {}
  const hqOvsBySkuId: Record<number, number> = {}
  Object.entries(hqLatestBySkuWh).forEach(([k, v]) => {
    const sku_id = Number(k.split('|')[0])
    const target = v.location === 'overseas' ? hqOvsBySkuId : hqCnBySkuId
    target[sku_id] = (target[sku_id] ?? 0) + v.qty
  })

  // 把 sku_id → code 索引（summary view 是按 sku_code 显示的）
  const fdBySkuCode: Record<string, number> = {}
  const hqCnBySkuCode: Record<string, number> = {}
  const hqOvsBySkuCode: Record<string, number> = {}
  ;(allSkus ?? []).forEach((s: any) => {
    if (fdBySkuId[s.id]) fdBySkuCode[s.code] = fdBySkuId[s.id]
    if (hqCnBySkuId[s.id]) hqCnBySkuCode[s.code] = hqCnBySkuId[s.id]
    if (hqOvsBySkuId[s.id]) hqOvsBySkuCode[s.code] = hqOvsBySkuId[s.id]
  })

  // Stock 导出用：仓库级明细行（每个 sku × warehouse 最新一条），给客户的下载版本
  const skuMetaById: Record<number, { code: string; name: string }> = {}
  ;(allSkus ?? []).forEach((s: any) => { skuMetaById[s.id] = { code: s.code, name: s.name } })
  const hqStockExportRows = Object.entries(hqLatestBySkuWh)
    .map(([k, v]) => {
      const [skuIdStr, warehouse] = k.split('|')
      const meta = skuMetaById[Number(skuIdStr)]
      return meta ? {
        sku_code: meta.code,
        sku_name: meta.name,
        warehouse,
        location: v.location === 'overseas' ? 'Overseas' : 'Domestic',
        qty: v.qty,
        as_of: v.as_of,
      } : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.location.localeCompare(b.location) || a.warehouse.localeCompare(b.warehouse) || a.sku_code.localeCompare(b.sku_code))

  return (
    <ForecastSummaryView
      runs={runs}
      selectedRun={selectedRun}
      cells={cells ?? []}
      allSkus={allSkus ?? []}
      countries={countries ?? []}
      lastYearData={ly}
      fdStockBySkuCode={fdBySkuCode}
      hqCnStockBySkuCode={hqCnBySkuCode}
      hqOvsStockBySkuCode={hqOvsBySkuCode}
      hqStockExportRows={hqStockExportRows}
      kaCells={kaCellsRaw ?? []}
      kas={(allKas ?? []).filter((k: any) => me.canAccessCountry(k.country_id))}
      viewerIsAdmin={me.isAdmin}
      viewerName={me.displayName}
    />
  )
}

// ============ Edit View（sales 默认 / 显式 view=edit）============
async function EditPage({ me, runs, selectedRun, supabase, countryParam }: any) {
  // ⚡ 一次拉全量数据 —— 切国家在前端纯本地切换，0 网络请求
  // 周期月数动态：新 cycle = 3, 历史 cycle = 4

  const [
    { data: allEuCountries },
    { data: allSkus },
    { data: allKas },
    { data: allCells },
    { data: shipmentPoData },
    { data: rollingSoData },
    { data: fdStockRaw },
    { data: hqStockRaw },
  ] = await Promise.all([
    supabase.from('country')
      .select('id, code, name_en, flag_emoji, region, sort_order')
      .eq('region', 'EU').eq('is_active', true)
      .order('sort_order'),

    supabase.from('sku')
      .select('id, code, name, category, series, sort_order, lifecycle, region_scope')
      .eq('is_active', true)
      .order('sort_order').order('code'),

    supabase.from('ka')
      .select('id, name, country_id, parent_ka_id, ka_type, sort_order, is_active, notes')
      .order('country_id').order('sort_order').order('name'),

    supabase.from('forecast_cell')
      .select('run_id, sku_id, ka_id, month, qty, source, updated_by, updated_at')
      .eq('run_id', selectedRun.id),

    // Σ PO 数据源: shipment 出货量 (country × sku, 过去 3 月均) — PO = Purchase Order
    supabase.from('shipment_po_3mo_avg')
      .select('country_id, sku_id, po_avg_3mo')
      .range(0, 49999),

    // Σ SO 数据源: PSI 按 ka 类型 (retailer=SO / distributor=ST) (ka × sku, 过去 3 月均)
    supabase.from('rolling_so_by_ka_sku')
      .select('country_id, ka_id, sku_id, so_avg_3mo')
      .range(0, 49999),

    supabase.from('weekly_psi_v2')
      .select('country_id, ka_id, sku_id, week_start, stock_qty')
      .gte('week_start', new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10))
      .order('week_start', { ascending: false })
      .range(0, 49999),

    supabase.from('hq_stock')
      .select('sku_id, stock_qty, as_of_date, location, warehouse')
      .order('as_of_date', { ascending: false })
      .range(0, 9999),
  ])

  // 🔐 应用用户权限：admin 看全部 EU 国家，sales 只看自己负责的国家
  // country 表 RLS 是"登录用户都能读"（基础主数据），所以这里需要在应用层按 me.countryIds 过滤
  const myCountries = (allEuCountries ?? []).filter((c: any) => me.canAccessCountry(c.id))

  if (!myCountries.length) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">📈 Demand Forecast</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-gray-700 font-medium mb-1">No countries assigned to you</div>
          <div className="text-sm text-gray-500">Please contact HQ admin to assign your responsible countries</div>
        </div>
      </div>
    )
  }

  // 决定初始选中国家（URL 参数有效性校验：必须在用户可访问的国家列表里）
  const initialCountryCode = countryParam && myCountries.some((c: any) => c.code === countryParam)
    ? countryParam : (myCountries[0] as any).code

  // ───────── Σ PO: shipment 出货 (country × sku, 过去 3 月均) ─────────
  const poByCountrySku: Record<number, Record<number, number>> = {}
  ;(shipmentPoData ?? []).forEach((r: any) => {
    if (!poByCountrySku[r.country_id]) poByCountrySku[r.country_id] = {}
    poByCountrySku[r.country_id][r.sku_id] = Number(r.po_avg_3mo) || 0
  })

  // ───────── Σ SO: PSI 按 ka 类型 (ka × sku, 过去 3 月均) ─────────
  const soByKaSku: Record<number, Record<number, number>> = {}
  ;(rollingSoData ?? []).forEach((r: any) => {
    if (!soByKaSku[r.ka_id]) soByKaSku[r.ka_id] = {}
    soByKaSku[r.ka_id][r.sku_id] = Number(r.so_avg_3mo) || 0
  })

  // ───────── Stock from FD: PSI 最新一周非空 stock_qty by KA × SKU ─────
  // 拉的是最近 60 天降序排列的所有数据，每个 (ka,sku) 取第一条非空 stock
  const fdStockByKaSku: Record<number, Record<number, number>> = {}
  ;(fdStockRaw ?? []).forEach((r: any) => {
    if (r.stock_qty === null || r.stock_qty === undefined) return
    if (!fdStockByKaSku[r.ka_id]) fdStockByKaSku[r.ka_id] = {}
    if (fdStockByKaSku[r.ka_id][r.sku_id] === undefined) {
      // 由于已 ORDER BY week_start DESC，首次见到即为最新
      fdStockByKaSku[r.ka_id][r.sku_id] = Number(r.stock_qty)
    }
  })

  // ───────── Stock from HQ: SKU × 仓库 粒度共享池，按 location 汇总到 SKU ─────────
  // 全 EU 共享同一池货，所有国家的销售看到相同的 HQ 数字
  const hqWhLatest: Record<string, { qty: number; location: string }> = {}
  ;(hqStockRaw ?? []).forEach((r: any) => {
    const k = `${r.sku_id}|${r.warehouse ?? 'legacy'}`
    if (hqWhLatest[k] === undefined) hqWhLatest[k] = { qty: Number(r.stock_qty), location: r.location }
  })
  const hqCnStockBySku: Record<number, number> = {}
  const hqOvsStockBySku: Record<number, number> = {}
  Object.entries(hqWhLatest).forEach(([k, v]) => {
    const sku_id = Number(k.split('|')[0])
    const target = v.location === 'overseas' ? hqOvsStockBySku : hqCnStockBySku
    target[sku_id] = (target[sku_id] ?? 0) + v.qty
  })

  return (
    <ForecastEditView
      runs={runs}
      selectedRun={selectedRun}
      allCountries={myCountries}
      initialCountryCode={initialCountryCode}
      allKas={allKas ?? []}
      allSkus={allSkus ?? []}
      allCells={(allCells ?? []) as any[]}
      poByCountrySku={poByCountrySku}
      soByKaSku={soByKaSku}
      fdStockByKaSku={fdStockByKaSku}
      hqCnStockBySku={hqCnStockBySku}
      hqOvsStockBySku={hqOvsStockBySku}
      editorNameMap={{}}
      viewerIsAdmin={me.isAdmin}
      viewerName={me.displayName}
    />
  )
}

function ErrorBlock({ msg }: { msg: string }) {
  return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{msg}</div>
    </div>
  )
}
