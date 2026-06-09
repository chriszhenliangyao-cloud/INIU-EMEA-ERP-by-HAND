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
  // cells（KA 已聚合到国家级）—— RLS 自动按用户身份过滤
  const { data: cells } = await supabase
    .from('forecast_eu_summary')
    .select('run_id, sku_id, sku_code, sku_name, sku_category, country_id, country_code, country_name, month, qty')
    .eq('run_id', selectedRun.id)

  const { data: allSkus } = await supabase
    .from('sku')
    .select('id, code, name, category, sort_order, lifecycle, region_scope')
    .eq('is_active', true)
    .order('sort_order')
    .order('code')

  const { data: allEuCountries } = await supabase
    .from('country')
    .select('id, code, name_en, flag_emoji, region, sort_order')
    .eq('region', 'EU').eq('is_active', true)
    .order('sort_order')

  // 🔐 admin 看全部 EU，sales 只看自己负责的国家
  const countries = (allEuCountries ?? []).filter((c: any) => me.canAccessCountry(c.id))

  // 去年同期数据（hover-peek 备用） — 窗口长度跟随 month_count
  const startDate = new Date(selectedRun.period_start)
  const monthCount = (selectedRun as any).month_count ?? 4
  const lyStart = new Date(startDate); lyStart.setFullYear(lyStart.getFullYear() - 1)
  const lyEnd = new Date(lyStart); lyEnd.setMonth(lyEnd.getMonth() + monthCount)
  const { data: lyData } = await supabase
    .from('shipment')
    .select(`qty, effective_date, sku:sku_id ( id, code ), country:country_id ( id, code )`)
    .eq('source_type', 'channel')
    .gte('effective_date', lyStart.toISOString().slice(0, 10))
    .lt('effective_date', lyEnd.toISOString().slice(0, 10))

  const ly: Record<string, Record<string, Record<string, number>>> = {}
  ;(lyData ?? []).forEach((r: any) => {
    const skuCode = r.sku?.code, ctryCode = r.country?.code
    const ym = String(r.effective_date).slice(0, 7)
    if (!skuCode || !ctryCode) return
    if (!ly[skuCode]) ly[skuCode] = {}
    if (!ly[skuCode][ctryCode]) ly[skuCode][ctryCode] = {}
    ly[skuCode][ctryCode][ym] = (ly[skuCode][ctryCode][ym] ?? 0) + (r.qty ?? 0)
  })

  return (
    <ForecastSummaryView
      runs={runs}
      selectedRun={selectedRun}
      cells={cells ?? []}
      allSkus={allSkus ?? []}
      countries={countries ?? []}
      lastYearData={ly}
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
    { data: rollingPsi },
    { data: fdStockRaw },
    { data: hqStockRaw },
  ] = await Promise.all([
    supabase.from('country')
      .select('id, code, name_en, flag_emoji, region, sort_order')
      .eq('region', 'EU').eq('is_active', true)
      .order('sort_order'),

    supabase.from('sku')
      .select('id, code, name, category, sort_order, lifecycle, region_scope')
      .eq('is_active', true)
      .order('sort_order').order('code'),

    // 全量 KA (active+inactive)，主表格客户端 filter active
    supabase.from('ka')
      .select('id, name, country_id, parent_distributor, ka_type, tier, sort_order, is_active, notes')
      .order('country_id').order('sort_order').order('name'),

    // 本 cycle 的 cells
    supabase.from('forecast_cell')
      .select('run_id, sku_id, ka_id, month, qty, updated_by, updated_at')
      .eq('run_id', selectedRun.id),

    // 第 1 列 SI/SO: 过去 3 完整月平均，view 派生 (country × ka × sku)
    supabase.from('rolling_si_so_avg')
      .select('country_id, ka_id, sku_id, si_avg_3mo, so_avg_3mo, months_with_data, from_month, to_month')
      .range(0, 49999),

    // Stock from FD: PSI 渠道库存 (distributor 类型 KA) 最新一周
    // 拉最近 8 周以确保能找到最新非空 stock
    supabase.from('weekly_psi_v2')
      .select('country_id, ka_id, sku_id, week_start, stock_qty')
      .gte('week_start', new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10))
      .order('week_start', { ascending: false })
      .range(0, 49999),

    // Stock from HQ: 当前数据为空（admin 还没导入），保留 schema 占位
    supabase.from('hq_stock')
      .select('country_id, ka_id, sku_id, stock_qty, as_of_date')
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

  // ───────── Rolling 3-month SI/SO 平均（按 country × ka × sku）─────────
  // 结构：rollingByKaSku[ka_id][sku_id] = { si, so, months }
  const rollingByKaSku: Record<number, Record<number, { si: number; so: number; months: number }>> = {}
  ;(rollingPsi ?? []).forEach((r: any) => {
    if (!rollingByKaSku[r.ka_id]) rollingByKaSku[r.ka_id] = {}
    rollingByKaSku[r.ka_id][r.sku_id] = {
      si: Number(r.si_avg_3mo) || 0,
      so: Number(r.so_avg_3mo) || 0,
      months: r.months_with_data,
    }
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

  // ───────── Stock from HQ: 同上，目前可能为空 ─────────
  const hqStockByKaSku: Record<number, Record<number, number>> = {}
  ;(hqStockRaw ?? []).forEach((r: any) => {
    if (!hqStockByKaSku[r.ka_id]) hqStockByKaSku[r.ka_id] = {}
    if (hqStockByKaSku[r.ka_id][r.sku_id] === undefined) {
      hqStockByKaSku[r.ka_id][r.sku_id] = Number(r.stock_qty)
    }
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
      rollingByKaSku={rollingByKaSku}
      fdStockByKaSku={fdStockByKaSku}
      hqStockByKaSku={hqStockByKaSku}
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
