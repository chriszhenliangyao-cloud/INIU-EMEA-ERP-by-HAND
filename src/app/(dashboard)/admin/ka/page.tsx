import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { KaManagementView } from './ka-management-view'

/**
 * /admin/ka — KA Channel Map（admin only）
 *
 * 渠道层级映射图：国家 → FD(distributor) → 集团(group, 可选) → retailer
 * 数据：全量 KA（active + inactive）+ 每个 KA 的业务数据量（shipment/PSI 行数）
 */
export default async function AdminKaPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) {
    redirect('/shipments')
  }

  const supabase = createClient()

  const [
    { data: allKas, error: kaError },
    { data: countries },
    { data: shipKaIds },
    { data: psiKaIds },
  ] = await Promise.all([
    supabase.from('ka')
      .select('id, name, country_id, ka_type, parent_ka_id, sort_order, is_active, notes, vat, updated_at')
      .order('country_id').order('sort_order').order('name'),
    supabase.from('country')
      .select('id, code, name_en, flag_emoji, sort_order, is_active')
      .order('sort_order'),
    // 数据量统计：只拉 ka_id 列，server 端聚合（量级几百~几千行）
    supabase.from('shipment').select('ka_id').range(0, 49999),
    supabase.from('weekly_psi_v2').select('ka_id').range(0, 49999),
  ])

  if (kaError || !allKas || !countries) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">🗺️ KA Channel Map</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
          Failed to load KA data: {kaError?.message ?? 'unknown error'}
        </div>
      </div>
    )
  }

  // 聚合每个 KA 的数据量
  const shipCount: Record<number, number> = {}
  ;(shipKaIds ?? []).forEach((r: any) => { shipCount[r.ka_id] = (shipCount[r.ka_id] ?? 0) + 1 })
  const psiCount: Record<number, number> = {}
  ;(psiKaIds ?? []).forEach((r: any) => { psiCount[r.ka_id] = (psiCount[r.ka_id] ?? 0) + 1 })

  return (
    <KaManagementView
      allKas={allKas}
      countries={countries}
      shipCount={shipCount}
      psiCount={psiCount}
      viewerName={me.displayName}
    />
  )
}

export const metadata = {
  title: 'KA Channel Map · INIU ERP',
}
