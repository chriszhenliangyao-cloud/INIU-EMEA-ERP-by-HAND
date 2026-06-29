import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'

// 关闭路由静态化，每次 invocation 都新算
export const dynamic = 'force-dynamic'
export const revalidate = 0

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
      { data: throughRaw },
    ] = await Promise.all([
      supabase.from('sku')
        .select('code, name, category, series, family')
        .eq('is_active', true),
      supabase.from('ka')
        .select('id, name, country_id, ka_type, parent_ka_id'),
      supabase.from('country')
        .select('id, code'),
      // weekly_psi_long_compat view：底层是 weekly_psi_v2 (wide)，view 反 pivot 回 long + 派生 DOS
      //   - SI/SO/ST/Stock 4 个 metric：字节级一致于旧 weekly_psi（5 层交叉验证 MD5 通过）
      //   - DOS：SQL window function 实时派生 = stock_qty / avg4(COALESCE(so_qty, st_qty)) * 7
      // RLS 跟着底层 weekly_psi_v2.can_access_country(country_id)
      // 仍保留 range() — PostgREST max-rows 限制是表/view 级的
      supabase.from('weekly_psi_long_compat')
        .select('country_id, ka_id, sku_id, iso_year, iso_week, week_label, metric, qty')
        .order('week_label')
        .range(0, 49999),
      // Sell-through 渠道明细：FD 的 ST 拆到下游 retailer（through_ka_id 非空的行）。
      // compat 视图刻意排除了这些行，所以单独拉，喂给「渠道流向」翻转卡。RLS 同样按 country 隔离。
      supabase.from('weekly_psi_v2')
        .select('country_id, ka_id, through_ka_id, sku_id, week_label, st_qty')
        .not('through_ka_id', 'is', null)
        .order('week_label')
        .range(0, 49999),
    ])

    if (!dbSkus || !dbKas || !dbCountries || !psiRaw) {
      return NextResponse.json({
        backendError: 'Failed to load master data',
        products: [], productsFamily: [], retailers: [], weeklyPSI: [], channelFlow: [], weeks: [], config: {}, userCountries: [],
      })
    }

    // ─── 构建 id → code/name 映射 ─────────────────
    const countryById: Record<number, string> = {}
    dbCountries.forEach((c: any) => { countryById[c.id] = c.code })

    // downstream 从 parent_ka_id 反向派生：parent 的 downstream = 所有 children 的名字
    const childrenByParent: Record<number, string[]> = {}
    dbKas.forEach((k: any) => {
      if (k.parent_ka_id != null) {
        ;(childrenByParent[k.parent_ka_id] ??= []).push(k.name)
      }
    })

    type KaInfo = { name: string; country: string; type: string; downstream: string[] | null }
    const kaById: Record<number, KaInfo> = {}
    dbKas.forEach((k: any) => {
      kaById[k.id] = {
        name: k.name,
        country: countryById[k.country_id] ?? '',
        type: k.ka_type ?? 'retailer',
        downstream: childrenByParent[k.id] ?? null,
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

    // ─── retailers（dashboard 只用到 retailer 维度；group 结构节点不进看板）─────
    const retailers = dbKas
      .filter((k: any) => k.ka_type === 'retailer' || k.ka_type === 'distributor')
      .map((k: any) => ({
        Retailer: k.name,
        Country: countryById[k.country_id] ?? '',
        Status: 'Active',
        Type: k.ka_type === 'distributor' ? 'Distributor' : 'Retailer',
        Downstream: (childrenByParent[k.id] ?? []).join(', '),
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

    // ─── channelFlow：FD sell-through 拆到下游 retailer 的明细（翻转卡多柱图用）──
    // 一行 = 某 distributor 某周某 SKU 卖给某下游 retailer 的 ST。Stock 复用 weeklyPSI 里 distributor 的 Stock metric。
    const channelFlow = (throughRaw ?? []).map((r: any) => {
      const dist = kaById[r.ka_id]
      const ret = kaById[r.through_ka_id]
      const sku = skuById[r.sku_id]
      if (!dist || !ret || !sku) return null
      return {
        Country: countryById[r.country_id] ?? '',
        Distributor: dist.name,
        Retailer: ret.name,
        Model: sku.code,
        'Product Name': sku.name,
        Category: sku.category,
        Series: sku.series,
        Family: sku.family,
        week_label: r.week_label,
        st: Number(r.st_qty) || 0,
      }
    }).filter(Boolean)

    return NextResponse.json({
      products,
      productsFamily,
      retailers,
      weeklyPSI,
      channelFlow,
      weeks,
      config: {},
      userCountries: me.isAdmin
        ? ['ALL']
        : me.countryIds.map(id => countryById[id]).filter(Boolean),
      accessDenied: !me.isActive,
    }, {
      headers: {
        // 60s 短缓存 + 5min SWR：兼顾速度和新鲜度
        // PSI 数据每周更新一次，60s 足够实时
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    })
  } catch (err: any) {
    return NextResponse.json({
      backendError: err?.message ?? String(err),
      products: [], productsFamily: [], retailers: [], weeklyPSI: [], weeks: [], config: {}, userCountries: [],
    })
  }
}
