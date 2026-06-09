import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { SkuManagementView } from './sku-management-view'

/**
 * /admin/sku — SKU Master Data 管理面板（admin only）
 *
 * 进入此页面需 is_admin = true，非 admin 跳转回 /shipments。
 * 数据：全量 SKU（active + inactive，admin 都能看到）。
 */
export default async function AdminSkuPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) {
    redirect('/shipments')
  }

  const supabase = createClient()

  // 全量 SKU（含 inactive）
  const { data: allSkus, error } = await supabase
    .from('sku')
    .select(`
      id, code, name, name_zh, category, color, ean, box_qty, unit_weight_g,
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

  return (
    <SkuManagementView
      allSkus={allSkus ?? []}
      viewerName={me.displayName}
    />
  )
}

export const metadata = {
  title: 'SKU Master Data · INIU ERP',
}
