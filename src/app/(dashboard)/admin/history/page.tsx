import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { redirect } from 'next/navigation'
import { HistoryView } from './history-view'

export default async function ImportHistoryPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) redirect('/shipments')

  const supabase = createClient()
  // 拉所有 batch + 关联 imported_by 名字（admin 是 sales_rep 表里的用户）
  const { data: batches } = await supabase
    .from('import_batch')
    .select('id, file_name, imported_by, imported_at, source_type, total_rows, new_count, updated_count, skipped_count, error_count, notes, is_rolled_back')
    .order('imported_at', { ascending: false })

  // 取所有相关 user_id 的 displayname
  const userIds = Array.from(new Set((batches ?? []).map(b => b.imported_by).filter(Boolean)))
  const { data: reps } = userIds.length > 0
    ? await supabase.from('sales_rep').select('user_id, display_name').in('user_id', userIds)
    : { data: [] as any[] }
  const nameMap: Record<string, string> = {}
  ;(reps ?? []).forEach((r: any) => { nameMap[r.user_id] = r.display_name })

  return <HistoryView batches={batches ?? []} nameMap={nameMap} />
}
