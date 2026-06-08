import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { ShipmentsView } from './shipments-view'

export default async function ShipmentsPage() {
  // Step 1: get current user identity (with RBAC info)
  const me = await getCurrentUser()

  // Step 2: fetch data — no country filtering code, RLS handles it automatically
  const supabase = createClient()
  const { data: shipments, error } = await supabase
    .from('shipment')
    .select(`
      id, ship_date, plan_date, effective_date, delivery_date, qty, status,
      po_number, source_type, internal_customer_name,
      sku:sku_id ( id, code, name, category ),
      country:country_id ( id, code, name_en, flag_emoji, region ),
      ka:ka_id ( id, name )
    `)
    .order('effective_date', { ascending: false })

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load: {error.message}
        </div>
      </div>
    )
  }

  // Flatten structure for the client component
  type FlatRow = {
    id: number; effective_date: string; ship_date: string | null; plan_date: string | null
    delivery_date: string | null; qty: number; status: string; po_number: string | null
    source_type: string; internal_customer_name: string | null
    sku_id: number; sku_code: string; sku_name: string; sku_category: string | null
    country_id: number; country_code: string; country_name: string; country_flag: string; country_region: string
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
    country_name: r.country?.name_en,
    country_flag: r.country?.flag_emoji,
    country_region: r.country?.region,
    ka_id: r.ka?.id ?? null,
    ka_name: r.ka?.name ?? null,
  }))

  return <ShipmentsView rows={rows} viewerIsAdmin={me.isAdmin} viewerName={me.displayName} />
}
