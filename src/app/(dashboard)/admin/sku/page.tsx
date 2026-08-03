import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { SkuManagementView } from './sku-management-view'

// BOM(RMB) 在抽屉里显示 €≈ 折算用的实时汇率：ECB(frankfurter) 主、er-api 兜底、周缓存。
async function getCnyToEur(): Promise<number> {
  const WEEK = 60 * 60 * 24 * 7
  for (const url of ['https://api.frankfurter.dev/v1/latest?base=CNY&symbols=EUR', 'https://open.er-api.com/v6/latest/CNY']) {
    try {
      const res = await fetch(url, { next: { revalidate: WEEK } })
      if (!res.ok) continue
      const r = (await res.json())?.rates?.EUR
      if (typeof r === 'number' && r > 0 && r < 1) return r
    } catch { /* 下一个源 */ }
  }
  return 0.13
}

/**
 * /admin/sku — SKU Master Data
 *
 * 所有登录用户可进入；admin 可编辑，销售为只读（canEdit=false 时隐藏全部写操作 UI）。
 * 真正的写入闸门在 DB：RLS 的 sku_admin_write / hq_stock_admin_write 仅放行 is_admin()。
 * 数据：全量 SKU（active + inactive）。
 */
export default async function AdminSkuPage() {
  const me = await getCurrentUser()

  const supabase = createClient()

  // 全量 SKU（含 inactive）
  const { data: allSkus, error } = await supabase
    .from('sku')
    .select(`
      id, code, name, name_zh, category, color, ean, box_qty, unit_weight_g,
      carton_dim_cm, carton_gross_kg, cartons_per_pallet, pallet_gross_kg, colorbox_dim_cm,
      rrp_eur, rrp_usd, cost_usd, bom_cost_rmb, lifecycle, launch_date, region_scope,
      sort_order, is_active, notes, series, family,
      created_at, updated_at
    `)
    .order('is_active', { ascending: false })
    .order('sort_order')
    .order('code')

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">⚙️ SKU Master Data</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
          Failed to load SKU data: {error.message}
        </div>
      </div>
    )
  }

  // 库存：hq_stock 每个 (sku, warehouse) 取最新 as_of_date 一条
  const { data: hqRaw } = await supabase
    .from('hq_stock')
    .select('sku_id, stock_qty, as_of_date, location, warehouse')
    .not('warehouse', 'is', null)
    .order('as_of_date', { ascending: false })
    .range(0, 9999)

  const seen = new Set<string>()
  const stockBySku: Record<number, Record<string, number>> = {}
  const whLoc: Record<string, string> = {}
  let stockAsOf = ''
  ;(hqRaw ?? []).forEach((r: any) => {
    const key = `${r.sku_id}|${r.warehouse}`
    if (seen.has(key)) return               // 已按 as_of desc 排序，首见即最新
    seen.add(key)
    ;(stockBySku[r.sku_id] ??= {})[r.warehouse] = Number(r.stock_qty)
    whLoc[r.warehouse] = r.location
    const d = String(r.as_of_date)
    if (d > stockAsOf) stockAsOf = d
  })
  const warehouses = Object.keys(whLoc)
    .sort((a, b) => (whLoc[a] === 'domestic' ? 0 : 1) - (whLoc[b] === 'domestic' ? 0 : 1) || a.localeCompare(b, 'zh'))
    .map(name => ({ name, location: whLoc[name] }))

  const cnyToEur = await getCnyToEur()

  // 每国定价：活跃国家清单 + 各 SKU 已存的 RRP / FD buying price（RLS 自动按 can_access_country 过滤）
  const [{ data: countryRows }, { data: priceRows }] = await Promise.all([
    supabase.from('country').select('id, code, name_en, flag_emoji, currency').eq('is_active', true).order('sort_order'),
    supabase.from('sku_country_pricing').select('sku_id, country_id, rrp, fd_buying_price').range(0, 49999),
  ])
  const rrpBySku: Record<number, Record<number, number>> = {}
  const fdBySku: Record<number, Record<number, number>> = {}
  ;(priceRows ?? []).forEach((r: any) => {
    if (r.rrp != null) (rrpBySku[r.sku_id] ??= {})[r.country_id] = Number(r.rrp)
    if (r.fd_buying_price != null) (fdBySku[r.sku_id] ??= {})[r.country_id] = Number(r.fd_buying_price)
  })

  return (
    <SkuManagementView
      allSkus={allSkus ?? []}
      viewerName={me.displayName}
      canEdit={me.isAdmin}
      stockBySku={stockBySku}
      warehouses={warehouses}
      stockAsOf={stockAsOf}
      cnyToEur={cnyToEur}
      countries={countryRows ?? []}
      rrpBySku={rrpBySku}
      fdBySku={fdBySku}
    />
  )
}

export const metadata = {
  title: 'SKU Master Data · INIU ERP',
}
