import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { ShipmentsView } from './shipments-view'

export default async function ShipmentsPage() {
  // 第一步：拿当前用户身份（含 RBAC 信息）
  const me = await getCurrentUser()

  // 第二步：拉数据 —— 完全不写国家过滤代码，RLS 自动按用户身份过滤
  const supabase = createClient()
  const { data: shipments, error } = await supabase
    .from('shipment')
    .select(`
      id, ship_date, plan_date, effective_date, delivery_date, qty, status,
      po_number, source_type, internal_customer_name,
      sku:sku_id ( id, code, name, category ),
      country:country_id ( id, code, name_zh, flag_emoji, region ),
      ka:ka_id ( id, name )
    `)
    .order('effective_date', { ascending: false })

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          加载失败: {error.message}
        </div>
      </div>
    )
  }

  // 扁平化结构，方便前端 client component 处理
  type FlatRow = {
    id: number; effective_date: string; ship_date: string | null; plan_date: string | null
    delivery_date: string | null; qty: number; status: string; po_number: string | null
    source_type: string; internal_customer_name: string | null
    sku_id: number; sku_code: string; sku_name: string; sku_category: string | null
    country_id: number; country_code: string; country_name_zh: string; country_flag: string; country_region: string
    ka_id: number | null; ka_name: string | null
  }

  const rows: FlatRow[] = (shipments ?? []).map((r: any) => ({
    id: r.id,
    effective_date: r.effective_date,
    ship_date: r.ship_date,
    plan_date: r.plan_date,
    delivery_date: r.delivery_date,
    qty: r.qty,
    status: r.status,
    po_number: r.po_number,
    source_type: r.source_type,
    internal_customer_name: r.internal_customer_name,
    sku_id: r.sku?.id,
    sku_code: r.sku?.code,
    sku_name: r.sku?.name,
    sku_category: r.sku?.category,
    country_id: r.country?.id,
    country_code: r.country?.code,
    country_name_zh: r.country?.name_zh,
    country_flag: r.country?.flag_emoji,
    country_region: r.country?.region,
    ka_id: r.ka?.id ?? null,
    ka_name: r.ka?.name ?? null,
  }))

  return <ShipmentsView rows={rows} viewerIsAdmin={me.isAdmin} viewerName={me.displayName} />
}
