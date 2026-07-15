import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { SalesRepManagementView } from './sales-rep-management-view'

/**
 * /admin/sales — Sales Rep Master Data 管理（admin only）
 * super_admin 见到 role 切换 / super_admin 提升按钮。
 */
export default async function AdminSalesPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) {
    redirect('/po')
  }

  const supabase = createClient()

  const [
    { data: allReps },
    { data: allCountries },
    { data: allAssignments },
  ] = await Promise.all([
    supabase.from('sales_rep')
      .select('id, user_id, display_name, email, role, is_active, is_super_admin, hired_at, left_at, locale, notes, last_login_at, created_at, updated_at')
      .order('is_active', { ascending: false })
      .order('id'),
    supabase.from('country')
      .select('id, code, name_en, flag_emoji, region, is_active')
      .eq('region', 'EU')
      .order('sort_order'),
    supabase.from('sales_rep_country')
      .select('sales_rep_id, country_id, is_primary, valid_from, valid_to'),
  ])

  return (
    <SalesRepManagementView
      allReps={allReps ?? []}
      allCountries={allCountries ?? []}
      allAssignments={allAssignments ?? []}
      viewerName={me.displayName}
      viewerIsSuperAdmin={me.isSuperAdmin}
    />
  )
}

export const metadata = {
  title: 'Sales Rep · INIU ERP',
}
