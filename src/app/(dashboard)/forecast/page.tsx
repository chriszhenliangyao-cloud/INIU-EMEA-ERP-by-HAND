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
    .select('id, code, region, period_start, period_end, status, filled_cells, total_qty, sku_count, ka_count, country_count, created_by_name, submitted_at, approved_at, published_at')
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

  // 去年同期数据（hover-peek 备用）
  const startDate = new Date(selectedRun.period_start)
  const lyStart = new Date(startDate); lyStart.setFullYear(lyStart.getFullYear() - 1)
  const lyEnd = new Date(lyStart); lyEnd.setMonth(lyEnd.getMonth() + 4)
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
  // 数据量级：24 KA × 6 国家 + cells（当前 0 行）+ 5 年 shipment ≈ <100KB
  // RLS 会自动把 sales 看不到的国家/KA/cell 过滤掉，所以"全拉"不会越权
  const startDate = new Date(selectedRun.period_start)
  const lyStart = new Date(startDate); lyStart.setFullYear(lyStart.getFullYear() - 1)
  const lyEnd = new Date(lyStart); lyEnd.setMonth(lyEnd.getMonth() + 4)
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()
  const ytdMonthsCount = currentMonth

  const [
    { data: allEuCountries },
    { data: allSkus },
    { data: allKas },
    { data: allCells },
    { data: lyData },
    { data: ytdData },
  ] = await Promise.all([
    supabase.from('country')
      .select('id, code, name_en, flag_emoji, region, sort_order')
      .eq('region', 'EU').eq('is_active', true)
      .order('sort_order'),

    supabase.from('sku')
      .select('id, code, name, category, sort_order, lifecycle, region_scope')
      .eq('is_active', true)
      .order('sort_order').order('code'),

    // 一次拉所有 KA (active+inactive) —— RLS 会让 sales 只看自己国家
    //   - 主表格在客户端 filter is_active=true（保持现有渲染）
    //   - Manage Channels Modal 用全部（含 inactive 用于 reactivate / 永久删除）
    supabase.from('ka')
      .select('id, name, country_id, parent_distributor, ka_type, tier, sort_order, is_active, notes')
      .order('country_id').order('sort_order').order('name'),

    // 一次拉本 run 的所有 cells —— RLS 会过滤
    supabase.from('forecast_cell')
      .select('run_id, sku_id, ka_id, month, qty, updated_by, updated_at')
      .eq('run_id', selectedRun.id),

    // 去年同期：拉所有国家的 4 个月 shipment（一次到位）
    supabase.from('shipment')
      .select(`qty, effective_date, country_id, sku:sku_id ( id, code )`)
      .eq('source_type', 'channel')
      .gte('effective_date', lyStart.toISOString().slice(0, 10))
      .lt('effective_date', lyEnd.toISOString().slice(0, 10)),

    // YTD：拉所有国家的今年到目前的 shipment
    ytdMonthsCount > 0
      ? supabase.from('shipment')
          .select(`qty, effective_date, country_id, sku:sku_id ( id, code )`)
          .eq('source_type', 'channel')
          .gte('effective_date', `${currentYear}-01-01`)
          .lt('effective_date', `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`)
      : Promise.resolve({ data: [] as any[] }),
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

  // ───────── 服务端聚合 hover-peek 数据（按 country_id 分桶）─────────
  // lyByCountrySku[country_id][sku_code][YYYY-MM] = qty
  const lyByCountrySku: Record<number, Record<string, Record<string, number>>> = {}
  ;(lyData ?? []).forEach((r: any) => {
    const cid = r.country_id
    const skuCode = r.sku?.code
    const ym = String(r.effective_date).slice(0, 7)
    if (!cid || !skuCode) return
    if (!lyByCountrySku[cid]) lyByCountrySku[cid] = {}
    if (!lyByCountrySku[cid][skuCode]) lyByCountrySku[cid][skuCode] = {}
    lyByCountrySku[cid][skuCode][ym] = (lyByCountrySku[cid][skuCode][ym] ?? 0) + (r.qty ?? 0)
  })

  // ytdByCountrySku[country_id][sku_code] = 月均
  const ytdByCountrySku: Record<number, Record<string, number>> = {}
  const ytdSumTmp: Record<number, Record<string, number>> = {}
  ;(ytdData ?? []).forEach((r: any) => {
    const cid = r.country_id
    const skuCode = r.sku?.code
    if (!cid || !skuCode) return
    if (!ytdSumTmp[cid]) ytdSumTmp[cid] = {}
    ytdSumTmp[cid][skuCode] = (ytdSumTmp[cid][skuCode] ?? 0) + (r.qty ?? 0)
  })
  Object.entries(ytdSumTmp).forEach(([cid, m]) => {
    ytdByCountrySku[Number(cid)] = {}
    Object.entries(m).forEach(([k, v]) => {
      ytdByCountrySku[Number(cid)][k] = ytdMonthsCount > 0 ? Math.round(v / ytdMonthsCount) : 0
    })
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
      lyByCountrySku={lyByCountrySku}
      ytdByCountrySku={ytdByCountrySku}
      ytdMonthsCount={ytdMonthsCount}
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
