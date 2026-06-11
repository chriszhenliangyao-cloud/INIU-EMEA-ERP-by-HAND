import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { SkuMapView } from './sku-map-view'

/**
 * /admin/sku/map — SKU Product Map（admin only）
 *
 * 产品层级映射图：Category → Family → 型号（颜色变体聚合成色块 chips）
 * 与 /admin/ka 的 KA Channel Map 同构：树状结构 + 数据量 + 行内编辑
 */
export default async function AdminSkuMapPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) {
    redirect('/shipments')
  }

  const supabase = createClient()

  const { data: allSkus, error: skuError } = await supabase.from('sku')
    .select('id, code, name, category, series, family, color, lifecycle, is_active, sort_order, notes, rrp_eur')
    .order('category').order('series').order('family').order('sort_order').order('code')

  if (skuError || !allSkus) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">🧬 SKU Product Map</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
          Failed to load SKU data: {skuError?.message ?? 'unknown error'}
        </div>
      </div>
    )
  }

  return (
    <SkuMapView
      allSkus={allSkus}
      viewerName={me.displayName}
    />
  )
}

export const metadata = {
  title: 'SKU Product Map · INIU ERP',
}
