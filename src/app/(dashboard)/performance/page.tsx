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
 *  3. Achieve(达成) = channel_po 客户订单(Qty Ordered)，按 国家×SKU×月(PO Date)。Q = 三个月之和。
 *  4. Achieve %     = 订单量 ÷ 预测 × 100%（每月 + 整季 Q）。
 *  5. Score         = ⏳ 待业务公式（前端先占位）。
 * RLS：forecast_cell / channel_po 按 can_access_country 自动过滤（销售只看自己国家）。
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

  const [{ data: kas }, { data: skus }, { data: allCountries }, { data: cells }, { data: pos }, { data: reviewRows }, { data: prevReviewRows }] = await Promise.all([
    supabase.from('ka').select('id, name, country_id, sort_order, ka_type').eq('is_active', true).order('country_id').order('sort_order').order('name'),
    supabase.from('sku').select('id, code, name, category, sort_order').eq('is_active', true).order('sort_order').order('code'),
    supabase.from('country').select('id, code, name_en, flag_emoji, region, sort_order').eq('region', 'EU').eq('is_active', true).order('sort_order'),
    supabase.from('forecast_cell').select('run_id, sku_id, ka_id, month, qty').gte('month', periodStart).lt('month', endExclusive).range(0, 49999),
    supabase.from('channel_po').select('sku_id, country_id, po_date, qty_ordered').gte('po_date', periodStart).lt('po_date', endExclusive).range(0, 49999),
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

  // Achieve：channel_po 客户订单(Qty Ordered)，按 PO Date 月归集
  const achieve: Record<number, Record<number, number[]>> = {}
  ;(pos ?? []).forEach((p: any) => {
    const mi = monthIndex[String(p.po_date).slice(0, 7)]; if (mi == null) return
    ;((achieve[p.country_id] ??= {})[p.sku_id] ??= Array(M).fill(0))[mi] += Number(p.qty_ordered) || 0
  })

  // ── Yearly Review：annual_plan(FCST，销售填的年度预测) vs channel_po(实际达成，按计划单价估值成 EUR) ──
  const COLOR_WORDS = new Set(['Black', 'White', 'Orange', 'Blue', 'Titan', 'DesertTitan', 'Red', 'LB'])
  const stripColor = (code: string) => { const i = code.lastIndexOf('-'); return i > 0 && COLOR_WORDS.has(code.slice(i + 1)) ? code.slice(0, i) : code }
  const [{ data: planRows }, { data: yPos }, { data: skuAll }] = await Promise.all([
    supabase.from('annual_plan').select('country_id, quarter, ka_id, customer_raw, model_code, product_name, category, si_qty, so_qty, iniu_si_value, ka_si_value, gp, net_profit').eq('year', 2026).range(0, 9999),
    supabase.from('channel_po').select('country_id, ka_id, sku_id, po_date, qty_ordered').gte('po_date', '2026-01-01').lt('po_date', '2027-01-01').range(0, 49999),
    supabase.from('sku').select('id, code').range(0, 9999),
  ])
  const skuCode: Record<number, string> = {}; (skuAll ?? []).forEach((s: any) => { skuCode[s.id] = s.code })
  const kaName2: Record<number, string> = {}; (kas ?? []).forEach((k: any) => { kaName2[k.id] = k.name })
  const newAgg = () => ({ qty: 0, val: 0, gp: 0, np: 0, kaSi: 0, byQuarter: {} as any, byCategory: {} as any, _ka: {} as any, _md: {} as any })
  const yc: Record<number, { fcst: any; ach: any }> = {}
  const planUnit: Record<number, Record<string, { val: number; gp: number; np: number; kaSi: number; q: number }>> = {}
  const modelCat: Record<string, string> = {}; const modelName: Record<string, string> = {}
  ;(planRows ?? []).forEach((r: any) => {
    const cid = r.country_id; const f = (yc[cid] ??= { fcst: newAgg(), ach: newAgg() }).fcst
    const val = Number(r.iniu_si_value) || 0, q = Number(r.si_qty) || 0, gp = Number(r.gp) || 0, np = Number(r.net_profit) || 0, kaSi = Number(r.ka_si_value) || 0
    f.qty += q; f.val += val; f.gp += gp; f.np += np; f.kaSi += kaSi
    ;(f.byQuarter[r.quarter] ??= { val: 0, qty: 0 }).val += val; f.byQuarter[r.quarter].qty += q
    if (r.category) f.byCategory[r.category] = (f.byCategory[r.category] || 0) + val
    const kaKey = r.ka_id != null ? (kaName2[r.ka_id] || r.customer_raw || '—') : (r.customer_raw || '—')
    ;(f._ka[kaKey] ??= { name: kaKey, val: 0, qty: 0 }).val += val; f._ka[kaKey].qty += q
    const mc = r.model_code || '—'
    ;(f._md[mc] ??= { code: mc, name: r.product_name || mc, val: 0, qty: 0 }).val += val; f._md[mc].qty += q
    const pu = ((planUnit[cid] ??= {})[mc] ??= { val: 0, gp: 0, np: 0, kaSi: 0, q: 0 })
    pu.val += val; pu.gp += gp; pu.np += np; pu.kaSi += kaSi; pu.q += q
    if (r.category) modelCat[mc] = r.category; modelName[mc] = r.product_name || mc
  })
  ;(yPos ?? []).forEach((p: any) => {
    const cid = p.country_id; const b = (yc[cid] ??= { fcst: newAgg(), ach: newAgg() }).ach
    const code = skuCode[p.sku_id]; if (!code) return; const mc = stripColor(code)
    const q = Number(p.qty_ordered) || 0; const m = Number(String(p.po_date).slice(5, 7)); const qu = 'Q' + (Math.floor((m - 1) / 3) + 1)
    const pu = planUnit[cid]?.[mc]; const rate = pu && pu.q > 0 ? { val: pu.val / pu.q, gp: pu.gp / pu.q, np: pu.np / pu.q, kaSi: pu.kaSi / pu.q } : { val: 0, gp: 0, np: 0, kaSi: 0 }
    const val = q * rate.val
    b.qty += q; b.val += val; b.gp += q * rate.gp; b.np += q * rate.np; b.kaSi += q * rate.kaSi
    ;(b.byQuarter[qu] ??= { val: 0, qty: 0 }).val += val; b.byQuarter[qu].qty += q
    const cat = modelCat[mc]; if (cat) b.byCategory[cat] = (b.byCategory[cat] || 0) + val
    const kaKey = p.ka_id != null ? (kaName2[p.ka_id] || '—') : '—'
    ;(b._ka[kaKey] ??= { name: kaKey, val: 0, qty: 0 }).val += val; b._ka[kaKey].qty += q
    ;(b._md[mc] ??= { code: mc, name: modelName[mc] || mc, val: 0, qty: 0 }).val += val; b._md[mc].qty += q
  })
  const cMeta: Record<number, any> = {}; countries.forEach((c: any) => { cMeta[c.id] = c })
  const fin = (a: any) => ({ qty: a.qty, val: a.val, gp: a.gp, np: a.np, kaSi: a.kaSi, byQuarter: a.byQuarter, byCategory: a.byCategory, byKa: (Object.values(a._ka) as any[]).sort((x: any, y: any) => y.val - x.val), byModel: (Object.values(a._md) as any[]).sort((x: any, y: any) => y.val - x.val) })
  const yearly = Object.keys(yc).map(Number).filter(cid => cMeta[cid]).map(cid => ({
    code: cMeta[cid].code, name: cMeta[cid].name_en, flag: cMeta[cid].flag_emoji, fcst: fin(yc[cid].fcst), ach: fin(yc[cid].ach),
  })).sort((a, b) => a.code.localeCompare(b.code))

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
      yearly={yearly}
    />
  )
}

export const metadata = { title: 'Performance · INIU ERP' }
