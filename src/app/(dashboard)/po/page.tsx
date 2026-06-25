import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { PoView } from './po-view'

// 临时限制：PO 页仅 Chris 可见（完善后再放开权限）
const PO_ALLOWED_EMAILS = ['chriszhenliang.yao@gmail.com']

export default async function PoPage() {
  // Step 1: current user identity (RBAC)
  const me = await getCurrentUser()

  // 访问门禁：非白名单用户直接挡掉
  if (!PO_ALLOWED_EMAILS.includes(me.email)) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-amber-800 max-w-md">
          <div className="text-lg font-semibold mb-1">🚧 PO module — not available yet</div>
          <p className="text-sm">This page is still under construction and restricted. It will be opened up once finalized.</p>
        </div>
      </div>
    )
  }

  // Step 2: fetch PO lines — RLS handles country scoping automatically
  const supabase = createClient()
  const { data: pos, error } = await supabase
    .from('channel_po')
    .select(`
      id, po_number, po_date, qty_ordered,
      sku:sku_id ( id, code, name, category ),
      country:country_id ( id, code, name_en, flag_emoji, region ),
      ka:ka_id ( id, name )
    `)
    .order('po_date', { ascending: false })

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load: {error.message}
        </div>
      </div>
    )
  }

  type FlatRow = {
    id: number; po_date: string; qty: number; po_number: string | null
    sku_id: number; sku_code: string; sku_name: string; sku_category: string | null
    country_id: number; country_code: string; country_name: string; country_flag: string; country_region: string
    ka_id: number | null; ka_name: string | null
  }

  const rows: FlatRow[] = (pos ?? []).map((r: any) => ({
    id: r.id,
    po_date: r.po_date,
    qty: r.qty_ordered,
    po_number: r.po_number,
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

  return (
    <PoView
      rows={rows}
      viewerIsAdmin={me.isAdmin}
      viewerName={me.displayName}
      marketCount={me.countryIds.length}
    />
  )
}

export const metadata = { title: 'PO · INIU ERP' }
