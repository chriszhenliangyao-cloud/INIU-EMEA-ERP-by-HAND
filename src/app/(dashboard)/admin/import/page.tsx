import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { redirect } from 'next/navigation'
import { ImportView } from './import-view'

export default async function ImportPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) redirect('/shipments')   // 双层防御：UI 上也只 admin 才能开

  const supabase = createClient()
  const [
    { data: skus },
    { data: kas },
    { data: countries },
  ] = await Promise.all([
    supabase.from('sku')
      .select('id, code, name')
      .eq('is_active', true)
      .order('code'),
    supabase.from('ka')
      .select('id, name, country_id, parent_distributor')
      .eq('is_active', true)
      .order('name'),
    supabase.from('country')
      .select('id, code, name_en, name_zh')
      .eq('is_active', true)
      .order('code'),
  ])

  return (
    <ImportView
      skus={skus ?? []}
      kas={kas ?? []}
      countries={countries ?? []}
      adminName={me.displayName}
    />
  )
}
