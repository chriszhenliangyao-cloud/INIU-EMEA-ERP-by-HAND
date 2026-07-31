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

// Profitability(P&L) 折算成 EUR 用的实时汇率：ECB(frankfurter) 主源、er-api 兜底、周缓存。
// base→EUR 应 <1（外币比 EUR 小），失败回退给定 fallback。
async function getToEur(base: string, fallback: number): Promise<number> {
  const WEEK = 60 * 60 * 24 * 7
  const sources = [
    `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=EUR`,
    `https://open.er-api.com/v6/latest/${base}`,
  ]
  for (const url of sources) {
    try {
      const res = await fetch(url, { next: { revalidate: WEEK } })
      if (!res.ok) continue
      const j: any = await res.json()
      const r = j?.rates?.EUR
      if (typeof r === 'number' && r > 0 && r < 5) return r
    } catch { /* 试下一个源 */ }
  }
  return fallback
}

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
    supabase.from('sku').select('id, code, name, category, sort_order, bom_cost_rmb').eq('is_active', true).order('sort_order').order('code'),
    supabase.from('country').select('id, code, name_en, flag_emoji, region, sort_order').eq('region', 'EU').eq('is_active', true).order('sort_order'),
    supabase.from('forecast_cell').select('run_id, sku_id, ka_id, month, qty').gte('month', periodStart).lt('month', endExclusive).range(0, 49999),
    supabase.from('channel_po').select('sku_id, country_id, po_date, qty_ordered, turnover, currency, po_number, ka_id').gte('po_date', periodStart).lt('po_date', endExclusive).range(0, 49999),
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

  // ── Profitability(P&L)：营收 + 运费 + BOM + CN（都折成 EUR）──
  const [{ data: freightRows }, { data: cnRows }, { data: bpRows }, { data: yearPosRows }, { data: bpDetailRows }, plnToEur, cnyToEur] = await Promise.all([
    supabase.from('po_freight').select('po_number, delivery_fee, currency').range(0, 9999),
    supabase.from('credit_note').select('country_id, base_model, product, amount, currency').gte('cn_date', periodStart).lt('cn_date', endExclusive).range(0, 9999),
    supabase.from('business_plan').select('country_id, month, category, si_value').eq('year', year).range(0, 9999),
    supabase.from('channel_po').select('country_id, po_date, turnover, currency, sku_id, qty_ordered').gte('po_date', `${year}-01-01`).lt('po_date', `${year + 1}-01-01`).range(0, 49999),
    supabase.from('business_plan_detail').select('country_id, month, model_code, si_qty, si_value').eq('year', year).range(0, 9999),
    getToEur('PLN', 0.23),
    getToEur('CNY', 0.13),
  ])
  const cnEur = (amt: any, ccy: string | null) => (Number(amt) || 0) * (ccy === 'PLN' ? plnToEur : 1)
  // CN 按国家（EUR）
  const cnByCountry: Record<number, number> = {}
  ;(cnRows ?? []).forEach((r: any) => { if (r.country_id != null) cnByCountry[r.country_id] = (cnByCountry[r.country_id] ?? 0) + cnEur(r.amount, r.currency) })
  const fxToEur: Record<string, number> = { EUR: 1, PLN: plnToEur, CNY: cnyToEur }
  const toEur = (v: number, ccy: string | null) => (Number(v) || 0) * (fxToEur[ccy ?? 'EUR'] ?? 1)
  // 归一化 po_number（去掉尾部 .0），映射到运费
  const normPo = (s: any) => String(s ?? '').replace(/\.0$/, '')
  const freightByPo: Record<string, { fee: number; ccy: string }> = {}
  ;(freightRows ?? []).forEach((f: any) => { freightByPo[normPo(f.po_number)] = { fee: Number(f.delivery_fee) || 0, ccy: f.currency || 'EUR' } })

  // BOM 单位成本(RMB) 映射，GP 计算时 × 实时 CNY→EUR
  const skuBomRmb: Record<number, number> = {}
  ;(skus ?? []).forEach((s: any) => { if (s.bom_cost_rmb != null) skuBomRmb[s.id] = Number(s.bom_cost_rmb) })

  // 每国：营收(EUR)、件数、BOM(EUR)、PO 集合；再按 PO 匹配运费（有记录才计入 + 统计覆盖率）
  const plAgg: Record<number, { revenue: number; units: number; bom: number; poSet: Set<string> }> = {}
  ;(pos ?? []).forEach((p: any) => {
    const a = (plAgg[p.country_id] ??= { revenue: 0, units: 0, bom: 0, poSet: new Set() })
    const qty = Number(p.qty_ordered) || 0
    a.revenue += toEur(p.turnover, p.currency)
    a.units += qty
    a.bom += (skuBomRmb[p.sku_id] ?? 0) * qty * cnyToEur   // RMB→EUR，实时汇率
    a.poSet.add(normPo(p.po_number))
  })
  const pnl = countries.map((c: any) => {
    const a = plAgg[c.id]
    if (!a) return { code: c.code, flag: c.flag_emoji, name: c.name_en, pos: 0, units: 0, revenue: 0, freight: 0, freightPos: 0, bom: 0, cn: cnByCountry[c.id] ?? 0 }
    let freight = 0, freightPos = 0
    a.poSet.forEach(po => { const f = freightByPo[po]; if (f) { freight += toEur(f.fee, f.ccy); freightPos++ } })
    return { code: c.code, flag: c.flag_emoji, name: c.name_en, pos: a.poSet.size, units: a.units, revenue: a.revenue, freight, freightPos, bom: a.bom, cn: cnByCountry[c.id] ?? 0 }
  }).filter(r => r.pos > 0).sort((a, b) => b.revenue - a.revenue)

  // ── Yearly Review：annual_plan(FCST，销售填的年度预测) vs channel_po(实际达成，按计划单价估值成 EUR) ──
  const COLOR_WORDS = new Set(['Black', 'White', 'Orange', 'Blue', 'Titan', 'DesertTitan', 'Red', 'LB'])
  const stripColor = (code: string) => { const i = code.lastIndexOf('-'); return i > 0 && COLOR_WORDS.has(code.slice(i + 1)) ? code.slice(0, i) : code }
  const [{ data: planRows }, { data: yPos }, { data: skuAll }] = await Promise.all([
    supabase.from('annual_plan').select('country_id, quarter, ka_id, customer_raw, model_code, product_name, category, si_qty, so_qty, iniu_si_value, ka_si_value, gp, net_profit').eq('year', 2026).range(0, 9999),
    supabase.from('channel_po').select('country_id, ka_id, sku_id, po_date, qty_ordered').gte('po_date', '2026-01-01').lt('po_date', '2027-01-01').range(0, 49999),
    supabase.from('sku').select('id, code, name').range(0, 9999),
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

  // ── Profitability by SKU：本季按 SKU（区分颜色）聚合 SI Qty/SI Value/运费/BOM/GP。
  //    CN 源表大多按机型记 → 把每个机型的 CN 按其"在本范围有 PO 的各 SKU 的 SI Value 占比"分摊到 SKU
  //    （单一 SKU 的机型自动拿 100% = 精确；多色机型按销量近似）；机型无 SKU 有 PO → Others。
  const skuNameById: Record<number, string> = {}
  ;(skuAll ?? []).forEach((s: any) => { skuNameById[s.id] = s.name || skuCode[s.id] || String(s.id) })
  // 机型显示名（用于"没有 PO 但有 CN"的亏损行）：去掉颜色后缀
  const stripColorName = (n: string) => (n || '').replace(/\s*[-–]\s*(Black|White|Orange|Blue|Titan|Desert ?Titan|Red|Light ?Blue|LB)\s*$/i, '').trim()
  const modelDisplay: Record<string, { code: string; name: string }> = {}
  ;(skuAll ?? []).forEach((s: any) => { const b = stripColor(s.code); if (!modelDisplay[b]) modelDisplay[b] = { code: b, name: stripColorName(s.name || b) || b } })
  const ccodeById: Record<number, string> = {}; countries.forEach((c: any) => { ccodeById[c.id] = c.code })

  // 每个 PO 的「每台平均运费(EUR)」= 该 PO 总运费 ÷ 该 PO 总台数（运费整单算）
  const poUnits: Record<string, number> = {}
  ;(pos ?? []).forEach((p: any) => { const po = normPo(p.po_number); poUnits[po] = (poUnits[po] ?? 0) + (Number(p.qty_ordered) || 0) })
  const poFreightPerUnit: Record<string, number> = {}
  for (const [po, f] of Object.entries(freightByPo)) { const u = poUnits[po]; if (u > 0) poFreightPerUnit[po] = toEur(f.fee, f.ccy) / u }

  const kaNameById: Record<number, string> = {}; (kas ?? []).forEach((k: any) => { kaNameById[k.id] = k.name })
  // 按 国家×SKU 聚合（+ ALL 汇总）；同时按 国家×PO 聚合，并记录 机型×PO 的营收（给 CN 分摊到 PO 用）
  const skuAgg: Record<string, Record<number, { qty: number; value: number; bomRmbW: number; poSet: Set<string> }>> = { ALL: {} }
  const poAgg: Record<string, Record<string, { qty: number; value: number; bomRmbW: number; poDate: string; ka: string }>> = { ALL: {} }
  const modelPoVal: Record<string, Record<string, Record<string, number>>> = { ALL: {} } // scope→机型→PO→该机型营收
  ;(pos ?? []).forEach((p: any) => {
    const ccode = ccodeById[p.country_id]; if (!ccode) return
    const code = skuCode[p.sku_id]; if (!code) return
    const base = stripColor(code)
    const qty = Number(p.qty_ordered) || 0, value = toEur(p.turnover, p.currency), bomRmb = skuBomRmb[p.sku_id] ?? 0
    const npo = normPo(p.po_number)
    for (const key of [ccode, 'ALL']) {
      const a = ((skuAgg[key] ??= {})[p.sku_id] ??= { qty: 0, value: 0, bomRmbW: 0, poSet: new Set() })
      a.qty += qty; a.value += value; a.bomRmbW += qty * bomRmb; a.poSet.add(npo)
      const b = ((poAgg[key] ??= {})[npo] ??= { qty: 0, value: 0, bomRmbW: 0, poDate: String(p.po_date), ka: kaNameById[p.ka_id] || '—' })
      b.qty += qty; b.value += value; b.bomRmbW += qty * bomRmb
      if (String(p.po_date) < b.poDate) b.poDate = String(p.po_date)
      ;(((modelPoVal[key] ??= {})[base] ??= {})[npo]) = (modelPoVal[key]?.[base]?.[npo] ?? 0) + value
    }
  })
  // CN 按 scope×机型 汇总；base_model 为空 → 直接进 Others
  const cnModelScope: Record<string, Record<string, number>> = {}
  const cnOthersByCountry: Record<string, number> = {}
  ;(cnRows ?? []).forEach((r: any) => {
    const ccode = ccodeById[r.country_id]; if (!ccode) return
    const eur = cnEur(r.amount, r.currency), bm = r.base_model
    for (const key of [ccode, 'ALL']) {
      if (!bm) cnOthersByCountry[key] = (cnOthersByCountry[key] ?? 0) + eur
      else (cnModelScope[key] ??= {})[bm] = (cnModelScope[key]?.[bm] ?? 0) + eur
    }
  })
  const pnlModelsByCountry: Record<string, Array<{ model: string; name: string; qty: number; value: number; log: number; bom: number; logPos: number; cn: number; noPo: boolean }>> = {}
  for (const [key, agg] of Object.entries(skuAgg)) {
    // 每个 SKU 的基础行
    const rows = Object.entries(agg).map(([sidStr, a]) => {
      const sid = Number(sidStr), code = skuCode[sid] || String(sid)
      let s = 0, n = 0
      a.poSet.forEach(po => { const v = poFreightPerUnit[po]; if (v != null) { s += v; n++ } })
      const logPerUnit = n > 0 ? s / n : 0
      return { _base: stripColor(code), model: code, name: skuNameById[sid] || code, qty: a.qty, value: a.value,
        log: logPerUnit * a.qty, bom: a.bomRmbW * cnyToEur, logPos: n, cn: 0, noPo: false }
    })
    // CN 分摊：机型 CN 按其各 SKU 的 SI Value 占比摊到 SKU（有 PO 时）；
    //   有 CN 但本范围无 PO 的产品 → 单独一行（亏损行，SI Value=0、NP=−CN），不进 Others；
    //   只有非产品 CN（base_model 为空，如运费/调拨）才在 Others（已在上面归集）。
    const byBase: Record<string, typeof rows> = {}
    rows.forEach(r => (byBase[r._base] ??= []).push(r))
    for (const [bm, cnAmt] of Object.entries(cnModelScope[key] ?? {})) {
      const grp = byBase[bm], tv = grp ? grp.reduce((s, r) => s + r.value, 0) : 0
      if (grp && tv > 0) { grp.forEach(r => { r.cn += cnAmt * (r.value / tv) }); continue }
      const d = modelDisplay[bm]
      rows.push({ _base: bm, model: d?.code || bm, name: d?.name || bm, qty: 0, value: 0, log: 0, bom: 0, logPos: 0, cn: cnAmt, noPo: true })
    }
    pnlModelsByCountry[key] = rows.map(({ _base, ...r }) => r).sort((a, b) => b.value - a.value)
  }

  // ── Profitability by PO：每行一个 PO。log=该 PO 实际运费(精确)。CN 按机型在各 PO 的营收占比摊到 PO；
  //    机型本期无 PO / 非产品 CN → Others（by-PO 无"亏损行"，因为没有 PO 行可挂）。
  const pnlPoByCountry: Record<string, Array<{ model: string; name: string; qty: number; value: number; log: number; bom: number; logPos: number; cn: number; noPo: boolean }>> = {}
  const cnOthersPoByCountry: Record<string, number> = { ...cnOthersByCountry }  // 起点=非产品(空 base)CN
  for (const [key, agg] of Object.entries(poAgg)) {
    const rows = Object.entries(agg).map(([po, a]) => {
      const f = freightByPo[po]
      const freight = f ? toEur(f.fee, f.ccy) : 0
      return { _po: po, model: po, name: `${a.ka} · ${a.poDate}`, qty: a.qty, value: a.value,
        log: freight, bom: a.bomRmbW * cnyToEur, logPos: f ? 1 : 0, cn: 0, noPo: false }
    })
    const byPo: Record<string, typeof rows[number]> = {}
    rows.forEach(r => { byPo[r._po] = r })
    for (const [bm, cnAmt] of Object.entries(cnModelScope[key] ?? {})) {
      const posOfModel = modelPoVal[key]?.[bm]
      const total = posOfModel ? Object.values(posOfModel).reduce((s, v) => s + v, 0) : 0
      if (!posOfModel || total <= 0) { cnOthersPoByCountry[key] = (cnOthersPoByCountry[key] ?? 0) + cnAmt; continue }
      for (const [po, rev] of Object.entries(posOfModel)) { if (byPo[po]) byPo[po].cn += cnAmt * (rev / total) }
    }
    pnlPoByCountry[key] = rows.map(({ _po, ...r }) => r).sort((a, b) => b.value - a.value)
  }

  // ── 分品类经营达成：BP 目标(SI Value) vs 实际 P&L(营收−运费−BOM=GP−CN=NP)，按品类 ──
  const skuCat: Record<number, string> = {}; (skus ?? []).forEach((s: any) => { if (s.category) skuCat[s.id] = s.category })
  const baseModelCat: Record<string, string> = {}; (skus ?? []).forEach((s: any) => { const b = stripColor(s.code); if (s.category && !baseModelCat[b]) baseModelCat[b] = s.category })
  const qMonths = new Set(QUARTER_MONTHS[q])   // 本季月份，如 Q2 = [4,5,6]
  const KNOWN_CATS = new Set(['Power bank', 'Charger', 'Cable', 'Wireless charger'])
  const bpTargetCat: Record<string, Record<string, number>> = { ALL: {} }
  ;(bpRows ?? []).forEach((r: any) => {
    if (!qMonths.has(Number(r.month))) return
    const ccode = ccodeById[r.country_id]; if (!ccode) return
    // 未分类 BP 行(如 '(uncat)'：P72-P2/WAL45/TAL101… 未定价机型，si_value=0)归入 Other，避免出现空的 (uncat) 行
    const cat = KNOWN_CATS.has(r.category) ? r.category : 'Other'
    for (const key of [ccode, 'ALL']) (bpTargetCat[key] ??= {})[cat] = (bpTargetCat[key]?.[cat] ?? 0) + (Number(r.si_value) || 0)
  })
  const catAgg: Record<string, Record<string, { qty: number; revenue: number; bomRmbW: number; poSet: Set<string> }>> = { ALL: {} }
  ;(pos ?? []).forEach((p: any) => {
    const ccode = ccodeById[p.country_id]; if (!ccode) return
    const cat = skuCat[p.sku_id] || 'Other'
    const qty = Number(p.qty_ordered) || 0, value = toEur(p.turnover, p.currency), bomRmb = skuBomRmb[p.sku_id] ?? 0, npo = normPo(p.po_number)
    for (const key of [ccode, 'ALL']) {
      const a = ((catAgg[key] ??= {})[cat] ??= { qty: 0, revenue: 0, bomRmbW: 0, poSet: new Set() })
      a.qty += qty; a.revenue += value; a.bomRmbW += qty * bomRmb; a.poSet.add(npo)
    }
  })
  const cnCatScope: Record<string, Record<string, number>> = {}
  ;(cnRows ?? []).forEach((r: any) => {
    const ccode = ccodeById[r.country_id]; if (!ccode) return
    const cat = r.base_model ? (baseModelCat[r.base_model] || 'Other') : 'Other'
    const eur = cnEur(r.amount, r.currency)
    for (const key of [ccode, 'ALL']) (cnCatScope[key] ??= {})[cat] = (cnCatScope[key]?.[cat] ?? 0) + eur
  })
  const CAT_ORDER = ['Power bank', 'Charger', 'Cable', 'Wireless charger']
  const pnlCatByCountry: Record<string, Array<{ category: string; qty: number; revenue: number; log: number; bom: number; logPos: number; cn: number; target: number }>> = {}
  for (const key of new Set<string>([...Object.keys(catAgg), ...Object.keys(bpTargetCat)])) {
    const cats = new Set<string>([...Object.keys(catAgg[key] ?? {}), ...Object.keys(bpTargetCat[key] ?? {}), ...Object.keys(cnCatScope[key] ?? {})])
    pnlCatByCountry[key] = [...cats].map(cat => {
      const a = catAgg[key]?.[cat]; let s = 0, n = 0
      a?.poSet.forEach(po => { const v = poFreightPerUnit[po]; if (v != null) { s += v; n++ } })
      return { category: cat, qty: a?.qty ?? 0, revenue: a?.revenue ?? 0, log: (n > 0 ? s / n : 0) * (a?.qty ?? 0), bom: (a?.bomRmbW ?? 0) * cnyToEur, logPos: n, cn: cnCatScope[key]?.[cat] ?? 0, target: bpTargetCat[key]?.[cat] ?? 0 }
    }).filter(r => r.target > 0 || r.revenue > 0 || r.cn > 0)   // 丢掉全 0 的空品类行（如仅由未定价 uncat 合并出的 Other）
      .sort((x, y) => { const ix = CAT_ORDER.indexOf(x.category), iy = CAT_ORDER.indexOf(y.category); return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || y.revenue - x.revenue })
  }

  // ── 年度达成：selectedYear 各季度 计划(BP) vs 实际(channel_po)，按国家(+ALL)。Value=营收€ / Volume=台数 两套 ──
  const planQ: Record<number, number[]> = {}      // country_id → [Q1..Q4] 计划营收（来自 business_plan，SI×FD买价，与实际同口径）
  const planQtyQ: Record<number, number[]> = {}   // 计划台数
  ;(bpRows ?? []).forEach((r: any) => {
    const qi = Math.floor((Number(r.month) - 1) / 3)
    if (qi < 0 || qi > 3) return
    ;(planQ[r.country_id] ??= [0, 0, 0, 0])[qi] += Number(r.si_value) || 0
  })
  // 台数目标来自 business_plan_detail(SI 数量)；business_plan(品类粒度)没有单独台数，故用明细表
  ;(bpDetailRows ?? []).forEach((r: any) => {
    const qi = Math.floor((Number(r.month) - 1) / 3)
    if (qi < 0 || qi > 3) return
    ;(planQtyQ[r.country_id] ??= [0, 0, 0, 0])[qi] += Number(r.si_qty) || 0
  })
  const actQ: Record<number, number[]> = {}       // country_id → [Q1..Q4] 实际营收(EUR)
  const actQtyQ: Record<number, number[]> = {}    // 实际台数
  ;(yearPosRows ?? []).forEach((p: any) => {
    const mo = Number(String(p.po_date).slice(5, 7)), qi = Math.floor((mo - 1) / 3)
    ;(actQ[p.country_id] ??= [0, 0, 0, 0])[qi] += toEur(p.turnover, p.currency)
    ;(actQtyQ[p.country_id] ??= [0, 0, 0, 0])[qi] += Number(p.qty_ordered) || 0
  })
  const annualByCountry: Record<string, { plan: number[]; actual: number[]; planQty: number[]; actualQty: number[] }> = { ALL: { plan: [0, 0, 0, 0], actual: [0, 0, 0, 0], planQty: [0, 0, 0, 0], actualQty: [0, 0, 0, 0] } }
  countries.forEach((c: any) => {
    const plan = planQ[c.id] ?? [0, 0, 0, 0], actual = actQ[c.id] ?? [0, 0, 0, 0]
    const planQty = planQtyQ[c.id] ?? [0, 0, 0, 0], actualQty = actQtyQ[c.id] ?? [0, 0, 0, 0]
    annualByCountry[c.code] = { plan, actual, planQty, actualQty }
    for (let i = 0; i < 4; i++) { annualByCountry.ALL.plan[i] += plan[i]; annualByCountry.ALL.actual[i] += actual[i]; annualByCountry.ALL.planQty[i] += planQty[i]; annualByCountry.ALL.actualQty[i] += actualQty[i] }
  })
  // 未开始的季度（当年且晚于本季度 → 用斜纹标注）
  const nowQ = Math.floor(now.getMonth() / 3), nowY = now.getFullYear()
  const futureQ = [0, 1, 2, 3].map(qi => year > nowY || (year === nowY && qi > nowQ))

  // ── BP details：全年 BP 目标(SI 数量 & SI Value) vs 实际 PO。SKU 视图按季度折叠(Q1..Q4)；Month 视图列全 12 个月。──
  //    机型 key：目标侧 stripBpColor(BP 机型码，含 PL 的 -B/-BU/-O 等缩写)；实际侧 stripColor(sku.code)；两侧收敛到同一 base。
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const BP_COLOR_ABBR = new Set(['B', 'W', 'T', 'BU', 'D', 'O', 'LB', 'R'])
  const stripBpColor = (code: string) => { const i = code.lastIndexOf('-'); if (i <= 0) return code; const seg = code.slice(i + 1); return (BP_COLOR_ABBR.has(seg) || COLOR_WORDS.has(seg)) ? code.slice(0, i) : code }
  const emptyMon = () => Array.from({ length: 12 }, () => ({ a: 0, b: 0 }))
  const newQuad = () => [{ a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }]  // [Q1..Q4] {siQty/units, siVal/val}
  // 目标（BP，全年）：scope×机型×季度 与 scope×月
  const bpModelQ: Record<string, Record<string, Array<{ a: number; b: number }>>> = { ALL: {} }
  const bpMon: Record<string, Array<{ a: number; b: number }>> = { ALL: emptyMon() }
  const bpDetailName: Record<string, string> = {}
  ;(bpDetailRows ?? []).forEach((r: any) => {
    const ccode = ccodeById[r.country_id]; if (!ccode) return
    const mi = Number(r.month) - 1; if (mi < 0 || mi > 11) return
    const base = stripBpColor(r.model_code || ''); const qi = Math.floor(mi / 3)
    const siQty = Number(r.si_qty) || 0, siVal = Number(r.si_value) || 0
    if (!bpDetailName[base]) bpDetailName[base] = modelDisplay[base]?.name || base
    for (const key of [ccode, 'ALL']) {
      const q4 = ((bpModelQ[key] ??= {})[base] ??= newQuad()); q4[qi].a += siQty; q4[qi].b += siVal
      const arr = (bpMon[key] ??= emptyMon()); arr[mi].a += siQty; arr[mi].b += siVal
    }
  })
  // 实际（PO，全年）：scope×机型×季度 与 scope×月；另存 scope×机型×季度×颜色SKU 明细（供展开看颜色）
  const actModelQ: Record<string, Record<string, Array<{ a: number; b: number }>>> = { ALL: {} }
  const actMon: Record<string, Array<{ a: number; b: number }>> = { ALL: emptyMon() }
  const actColorQ: Record<string, Record<string, Array<Record<string, { units: number; val: number; name: string }>>>> = { ALL: {} }
  ;(yearPosRows ?? []).forEach((p: any) => {
    const ccode = ccodeById[p.country_id]; if (!ccode) return
    const mi = Number(String(p.po_date).slice(5, 7)) - 1; if (mi < 0 || mi > 11) return
    const code = skuCode[p.sku_id]; if (!code) return
    const base = stripColor(code); const qi = Math.floor(mi / 3)
    const units = Number(p.qty_ordered) || 0, val = toEur(p.turnover, p.currency)
    for (const key of [ccode, 'ALL']) {
      const q4 = ((actModelQ[key] ??= {})[base] ??= newQuad()); q4[qi].a += units; q4[qi].b += val
      const arr = (actMon[key] ??= emptyMon()); arr[mi].a += units; arr[mi].b += val
      const cq = ((actColorQ[key] ??= {})[base] ??= [{}, {}, {}, {}])
      const cell = (cq[qi][code] ??= { units: 0, val: 0, name: skuNameById[p.sku_id] || code })
      cell.units += units; cell.val += val
    }
  })
  // 组装：每 scope → { skuByQuarter:[Q1..Q4 各自的机型行], month:[12 个月] }。children=颜色SKU实际（无 BP 目标）
  type BpChild = { key: string; name: string; siAct: number; valAct: number }
  type BpDetailRow = { key: string; name: string; siTgt: number; valTgt: number; siAct: number | null; valAct: number | null; children?: BpChild[] }
  const bpDetailByCountry: Record<string, { skuByQuarter: BpDetailRow[][]; month: BpDetailRow[] }> = {}
  for (const key of new Set<string>([...Object.keys(bpModelQ), ...Object.keys(actModelQ)])) {
    const models = new Set<string>([...Object.keys(bpModelQ[key] ?? {}), ...Object.keys(actModelQ[key] ?? {})])
    const skuByQuarter: BpDetailRow[][] = [0, 1, 2, 3].map(qi =>
      [...models].map(base => {
        const t = bpModelQ[key]?.[base]?.[qi], a = actModelQ[key]?.[base]?.[qi]
        const hasAct = !!a && (a.a > 0 || a.b > 0)
        const childMap = actColorQ[key]?.[base]?.[qi] ?? {}
        const children: BpChild[] = Object.entries(childMap)
          .map(([code, c]) => ({ key: code, name: c.name, siAct: c.units, valAct: c.val }))
          .sort((x, y) => y.valAct - x.valAct)
        return { key: base, name: bpDetailName[base] || modelDisplay[base]?.name || base,
          siTgt: t?.a ?? 0, valTgt: t?.b ?? 0, siAct: hasAct ? a!.a : null, valAct: hasAct ? a!.b : null,
          children: children.length >= 2 ? children : undefined }
      }).filter(r => r.siTgt > 0 || r.valTgt > 0 || r.siAct != null)
        .sort((x, y) => ((y.valTgt || 0) + (y.valAct || 0)) - ((x.valTgt || 0) + (x.valAct || 0))),
    )
    const bm = bpMon[key] ?? emptyMon(), am = actMon[key] ?? emptyMon()
    const month: BpDetailRow[] = MONTHS.map((nm, i) => ({
      key: String(i + 1), name: nm, siTgt: bm[i].a, valTgt: bm[i].b,
      siAct: am[i].a > 0 || am[i].b > 0 ? am[i].a : null, valAct: am[i].a > 0 || am[i].b > 0 ? am[i].b : null,
    }))
    bpDetailByCountry[key] = { skuByQuarter, month }
  }

  // ── CN details：本季每个机型(SKU)的 CN 成本，按类型拆分（Rebate / Price Protection / Margin Protection / Quality / Delivery Fee / Other）──
  //    类型无独立字段 → 从 product 文案关键词判定。金额折 EUR（PLN→EUR）。非产品 CN(base_model 空/'/') → Others。
  const CN_TYPES = ['Rebate', 'Price Protection', 'Margin Protection', 'Quality', 'Delivery Fee', 'Other'] as const
  const cnTypeOf = (p: string | null): string => {
    const s = (p || '').toLowerCase()
    if (/rebate/.test(s)) return 'Rebate'
    if (/price\s*prot/.test(s)) return 'Price Protection'
    if (/margin\s*(protection|gap)/.test(s)) return 'Margin Protection'
    if (/quality/.test(s)) return 'Quality'
    if (/delivery\s*fee|freight|shipping/.test(s)) return 'Delivery Fee'
    return 'Other'
  }
  // 清掉 product 文案里重复的机型/描述噪声，尽量露出颜色。截断过长文案。
  const cnLineLabel = (product: string | null, bm: string): string => {
    let s = (product || bm).trim()
    // 去掉结尾的类型词，突出前面的颜色/描述
    s = s.replace(/\b(stock\s+)?price\s*protection\b.*$/i, '').replace(/\bpromotion\s+rebate\b.*$/i, '')
      .replace(/\bquality\s+issue\s+reimbursement\b.*$/i, '').replace(/\bmargin\s+(protection|gap\s+covering.*)$/i, '')
      .replace(/\bsample\s+support\b.*$/i, '').trim()
    return s.length > 60 ? s.slice(0, 58) + '…' : (s || bm)
  }
  type CnLine = { desc: string; type: string; amt: number }
  const cnSkuAgg: Record<string, Record<string, { name: string; by: Record<string, number>; total: number; lines: CnLine[] }>> = { ALL: {} }
  const cnSkuOthers: Record<string, Record<string, number>> = {}
  ;(cnRows ?? []).forEach((r: any) => {
    const ccode = ccodeById[r.country_id]; if (!ccode) return
    const eur = cnEur(r.amount, r.currency), t = cnTypeOf(r.product), bm = r.base_model
    for (const key of [ccode, 'ALL']) {
      if (!bm || bm === '/') {
        const o = (cnSkuOthers[key] ??= {}); o[t] = (o[t] ?? 0) + eur
      } else {
        const m = ((cnSkuAgg[key] ??= {})[bm] ??= { name: modelDisplay[bm]?.name || bm, by: {}, total: 0, lines: [] })
        m.by[t] = (m.by[t] ?? 0) + eur; m.total += eur
        m.lines.push({ desc: cnLineLabel(r.product, bm), type: t, amt: eur })
      }
    }
  })
  type CnSkuRow = { model: string; name: string; by: Record<string, number>; total: number; lines: CnLine[] }
  const cnBySkuByCountry: Record<string, { rows: CnSkuRow[]; others: Record<string, number>; othersTotal: number }> = {}
  for (const key of new Set<string>([...Object.keys(cnSkuAgg), ...Object.keys(cnSkuOthers)])) {
    const rows = Object.entries(cnSkuAgg[key] ?? {}).map(([model, v]) => ({ model, name: v.name, by: v.by, total: v.total, lines: v.lines.sort((a, b) => b.amt - a.amt) })).sort((a, b) => b.total - a.total)
    const others = cnSkuOthers[key] ?? {}
    const othersTotal = Object.values(others).reduce((s, v) => s + v, 0)
    cnBySkuByCountry[key] = { rows, others, othersTotal }
  }

  const initialCountryCode = (searchParams?.country === 'ALL' || (searchParams?.country && countries.some((c: any) => c.code === searchParams.country)))
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
      pnl={pnl}
      pnlModelsByCountry={pnlModelsByCountry}
      cnOthersByCountry={cnOthersByCountry}
      pnlPoByCountry={pnlPoByCountry}
      cnOthersPoByCountry={cnOthersPoByCountry}
      annualByCountry={annualByCountry}
      futureQ={futureQ}
      pnlCatByCountry={pnlCatByCountry}
      bpDetailByCountry={bpDetailByCountry}
      cnBySkuByCountry={cnBySkuByCountry}
    />
  )
}

export const metadata = { title: 'Performance · INIU ERP' }
