import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { PerformanceView } from './performance-view'

/**
 * /performance — 销售季度 KPI 记分卡（FCST vs Achieve vs Achieve%）
 *
 * 口径（与业务确认）：
 *  1. 产品          = sku 主数据（code + name）
 *  2. FCST(预测)    = 跨周期平均：对每个目标月，取「所有预测过该 国家×SKU×月 的周期」各自
 *                     （跨该国渠道求和后的）预测值，再求平均。Q = 三个月之和。
 *  3. Achieve(达成) = shipment(source_type='channel') 实际出货，按 国家×SKU×月。Q = 三个月之和。
 *  4. Achieve %     = 实际出货 ÷ 预测 × 100%（每月 + 整季 Q）。
 *  5. Score         = ⏳ 待业务公式（前端先占位）。
 * RLS：forecast_cell / shipment 按 can_access_country 自动过滤（销售只看自己国家）。
 * 备注：FCST 当前纳入「所有周期(含 draft)」；正式考核如只认 published，把下方 cells 查询加 run 状态过滤即可。
 */
type SearchParams = { year?: string; q?: string; country?: string }
const QUARTER_MONTHS: Record<number, number[]> = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] }
const pad = (n: number) => String(n).padStart(2, '0')
const addMonths = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10) }

export default async function PerformancePage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getCurrentUser()
  const supabase = createClient()

  const { data: runs } = await supabase
    .from('forecast_run').select('id, period_start').eq('region', 'EU').order('period_start', { ascending: false })

  // 可选年份：来自所有周期的年份（保证至少有最新周期那年）
  // 默认 = 当前自然季度（今天所在的季度），不是最新预测周期
  const now = new Date()
  const defaultYear = now.getFullYear()
  const defaultQ = Math.floor(now.getMonth() / 3) + 1
  const runYears = Array.from(new Set((runs ?? []).map((r: any) => Number(String(r.period_start).slice(0, 4)))))
  const years = Array.from(new Set([defaultYear, ...runYears])).sort((a, b) => b - a)

  const year = Number(searchParams?.year) || defaultYear
  const q = ([1, 2, 3, 4].includes(Number(searchParams?.q)) ? Number(searchParams?.q) : defaultQ)
  const monthsIso = QUARTER_MONTHS[q].map(m => `${year}-${pad(m)}-01`)
  const monthIndex: Record<string, number> = {}
  monthsIso.forEach((m, i) => { monthIndex[m.slice(0, 7)] = i })
  const M = monthsIso.length
  const periodStart = monthsIso[0]
  const endExclusive = addMonths(monthsIso[M - 1], 1)

  // 上一季度（用于在本季 Progress 前展示"上季 Target"，来自上一季 Action Plan 的 target）
  const prevQ = q === 1 ? 4 : q - 1
  const prevY = q === 1 ? year - 1 : year

  const [{ data: kas }, { data: skus }, { data: allCountries }, { data: cells }, { data: ships }, { data: reviewRows }, { data: prevReviewRows }] = await Promise.all([
    supabase.from('ka').select('id, name, country_id, sort_order, ka_type').eq('is_active', true).order('country_id').order('sort_order').order('name'),
    supabase.from('sku').select('id, code, name, category, sort_order').eq('is_active', true).order('sort_order').order('code'),
    supabase.from('country').select('id, code, name_en, flag_emoji, region, sort_order').eq('region', 'EU').eq('is_active', true).order('sort_order'),
    supabase.from('forecast_cell').select('run_id, sku_id, ka_id, month, qty').gte('month', periodStart).lt('month', endExclusive).range(0, 49999),
    supabase.from('shipment').select('sku_id, country_id, effective_date, qty').eq('source_type', 'channel').gte('effective_date', periodStart).lt('effective_date', endExclusive).range(0, 49999),
    supabase.from('channel_quarterly_review').select('*').eq('year', year).eq('quarter', q),
    supabase.from('channel_quarterly_review').select('country_id, channel_name, target').eq('year', prevY).eq('quarter', prevQ),
  ])

  const countries = (allCountries ?? []).filter((c: any) => me.canAccessCountry(c.id))
  const kaCountry: Record<number, number> = {}
  ;(kas ?? []).forEach((k: any) => { kaCountry[k.id] = k.country_id })

  // 渠道(给季度复盘用)：在售、非 group 节点
  const channels = (kas ?? [])
    .filter((k: any) => k.ka_type !== 'group')
    .map((k: any) => ({ id: k.id, name: k.name, country_id: k.country_id, sort_order: k.sort_order ?? 0 }))
  const reviews = reviewRows ?? []  // 复盘行(country×quarter×channel_name)，view 按选中国家过滤
  const prevReviews = prevReviewRows ?? []  // 上一季复盘行(只取 target)，用于本季 Progress 前的"上季 Target"列

  // FCST：先按 (country,sku,month,run) 跨渠道求和；再对该 (country,sku,month) 跨"有填的周期"求平均
  const perRun: Record<number, Record<number, Array<Map<number, number>>>> = {}
  ;(cells ?? []).forEach((c: any) => {
    const cid = kaCountry[c.ka_id]; if (cid == null) return
    const mi = monthIndex[String(c.month).slice(0, 7)]; if (mi == null) return
    const arr = ((perRun[cid] ??= {})[c.sku_id] ??= Array.from({ length: M }, () => new Map<number, number>()))
    arr[mi].set(c.run_id, (arr[mi].get(c.run_id) ?? 0) + (Number(c.qty) || 0))
  })
  const forecast: Record<number, Record<number, number[]>> = {}
  for (const cid of Object.keys(perRun)) {
    for (const sid of Object.keys(perRun[Number(cid)])) {
      forecast[Number(cid)] ??= {}
      forecast[Number(cid)][Number(sid)] = perRun[Number(cid)][Number(sid)].map(
        m => (m.size ? Math.round([...m.values()].reduce((a, b) => a + b, 0) / m.size) : 0)
      )
    }
  }

  // Achieve：shipment 实际出货
  const achieve: Record<number, Record<number, number[]>> = {}
  ;(ships ?? []).forEach((s: any) => {
    const mi = monthIndex[String(s.effective_date).slice(0, 7)]; if (mi == null) return
    ;((achieve[s.country_id] ??= {})[s.sku_id] ??= Array(M).fill(0))[mi] += Number(s.qty) || 0
  })

  const initialCountryCode = (searchParams?.country && countries.some((c: any) => c.code === searchParams.country))
    ? searchParams.country : (countries[0] as any)?.code ?? ''

  return (
    <PerformanceView
      years={years}
      selectedYear={year}
      selectedQuarter={q}
      monthsIso={monthsIso}
      countries={countries}
      skus={skus ?? []}
      forecast={forecast}
      achieve={achieve}
      channels={channels}
      reviews={reviews}
      prevReviews={prevReviews}
      prevQuarterLabel={`${prevY} Q${prevQ}`}
      initialCountryCode={initialCountryCode}
      viewerName={me.displayName}
      viewerIsAdmin={me.isAdmin}
    />
  )
}

export const metadata = { title: 'Performance · INIU ERP' }
