import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { SkuManagementView } from './sku-management-view'

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
      rrp_eur, rrp_usd, cost_usd, lifecycle, launch_date, region_scope,
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

  return (
    <SkuManagementView
      allSkus={allSkus ?? []}
      viewerName={me.displayName}
      canEdit={me.isAdmin}
      stockBySku={stockBySku}
      warehouses={warehouses}
      stockAsOf={stockAsOf}
    />
  )
}

export const metadata = {
  title: 'SKU Master Data · INIU ERP',
}
