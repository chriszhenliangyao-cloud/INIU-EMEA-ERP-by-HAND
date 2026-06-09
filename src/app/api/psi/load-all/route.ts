import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'

/**
 * PSI Dashboard 数据源 API.
 *
 * 跟 Google Apps Script `loadAllData()` 返回结构 1:1 一致，
 * 这样前端 vanilla JS (psi-dashboard.html) 几乎不用改。
 */
export async function GET() {
  try {
    const me = await getCurrentUser()
    const supabase = createClient()

    // ─── 拉所有主数据（RLS 自动过滤 sales 看不到的）─────────────────
    const [
      { data: dbSkus },
      { data: dbKas },
      { data: dbCountries },
      { data: psiRaw },
    ] = await Promise.all([
      supabase.from('sku')
        .select('code, name, category, series, family')
        .eq('is_active', true),
      supabase.from('ka')
        .select('id, name, country_id, ka_type, downstream'),
      supabase.from('country')
        .select('id, code'),
      // weekly_psi RLS：sales 只看自己国家，admin 看全部
      // ⚠️ 必须用 range() — supabase JS client 默认 .select() 上限 1000 行，4255 行会被截断
      supabase.from('weekly_psi')
        .select('country_id, ka_id, sku_id, iso_year, iso_week, week_label, metric, qty')
        .order('week_label')
        .range(0, 49999),
    ])

    if (!dbSkus || !dbKas || !dbCountries || !psiRaw) {
      return NextResponse.json({
        backendError: 'Failed to load master data',
        products: [], productsFamily: [], retailers: [], weeklyPSI: [], weeks: [], config: {}, userCountries: [],
      })
    }

    // ─── 构建 id → code/name 映射 ─────────────────
    const countryById: Record<number, string> = {}
    dbCountries.forEach((c: any) => { countryById[c.id] = c.code })

    type KaInfo = { name: string; country: string; type: string; downstream: string[] | null }
    const kaById: Record<number, KaInfo> = {}
    dbKas.forEach((k: any) => {
      kaById[k.id] = {
        name: k.name,
        country: countryById[k.country_id] ?? '',
        type: k.ka_type ?? 'retailer',
        downstream: k.downstream,
      }
    })

    type SkuInfo = { code: string; name: string; category: string; series: string | null; family: string | null }
    const skuById: Record<number, SkuInfo> = {}
    // sku 查询出来用 code 做主键 lookup（id 没在 select 里——补一下）
    const { data: skusWithId } = await supabase
      .from('sku')
      .select('id, code, name, category, series, family')
      .eq('is_active', true)
    ;(skusWithId ?? []).forEach((s: any) => {
      skuById[s.id] = { code: s.code, name: s.name, category: s.category, series: s.series, family: s.family }
    })

    // ─── 构建 weeks 数组（按 ISO 顺序）─────────────────
    const weeksSet = new Set<string>()
    psiRaw.forEach((r: any) => weeksSet.add(r.week_label))
    const weeks = Array.from(weeksSet).sort()

    // ─── Pivot weekly_psi long → wide ─────────────────
    // 每行 key = `${country}|${retailer}|${model}|${metric}`
    // 行内容 = { Country, Retailer, Model, "Product Name", Metric, "2025W32": N, ... }
    const wideMap = new Map<string, any>()
    psiRaw.forEach((r: any) => {
      const ka = kaById[r.ka_id]
      const sku = skuById[r.sku_id]
      const country = countryById[r.country_id]
      if (!ka || !sku || !country) return
      const key = `${country}|${ka.name}|${sku.code}|${r.metric}`
      let row = wideMap.get(key)
      if (!row) {
        row = {
          Country: country,
          Retailer: ka.name,
          Model: sku.code,
          'Product Name': sku.name,
          Metric: r.metric,
        }
        // 初始化所有周列为空字符串（跟 Google Sheet 一致）
        weeks.forEach(w => { row[w] = '' })
        wideMap.set(key, row)
      }
      row[r.week_label] = Number(r.qty)
    })
    const weeklyPSI = Array.from(wideMap.values())

    // ─── retailers（dashboard 只用到 retailer 维度）─────────────────
    const retailers = dbKas
      .filter((k: any) => k.ka_type === 'retailer' || k.ka_type === 'distributor')
      .map((k: any) => ({
        Retailer: k.name,
        Country: countryById[k.country_id] ?? '',
        Status: 'Active',
        Type: k.ka_type === 'distributor' ? 'Distributor' : 'Retailer',
        Downstream: k.downstream ? k.downstream.join(', ') : '',
      }))

    // ─── products / productsFamily（前端 PRODUCTS_META 派生用）─────────
    const products = (skusWithId ?? []).map((s: any) => ({
      Model: s.code,
      'Product Name': s.name,
      Category: s.category,
      EAN: '',
      Status: 'Active',
    }))
    const productsFamily = (skusWithId ?? [])
      .filter((s: any) => s.series && s.family)
      .map((s: any) => ({
        'Product Name': s.name,
        Category: s.category,
        Series: s.series,
        Family: s.family,
      }))

    return NextResponse.json({
      products,
      productsFamily,
      retailers,
      weeklyPSI,
      weeks,
      config: {},
      userCountries: me.isAdmin
        ? ['ALL']
        : me.countryIds.map(id => countryById[id]).filter(Boolean),
      accessDenied: !me.isActive,
    })
  } catch (err: any) {
    return NextResponse.json({
      backendError: err?.message ?? String(err),
      products: [], productsFamily: [], retailers: [], weeklyPSI: [], weeks: [], config: {}, userCountries: [],
    })
  }
}
