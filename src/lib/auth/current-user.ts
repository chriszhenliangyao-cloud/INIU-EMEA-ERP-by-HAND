import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * 当前登录用户的完整身份信息。
 *
 * 用法（Server Component / Route Handler）：
 *   const me = await getCurrentUser()
 *   if (me.isAdmin) { ... }  // HQ 全员
 *   if (me.canAccessCountry(1)) { ... }
 *
 * 重要原则：
 * - 数据查询完全靠 RLS 自动过滤，不要在前端写国家过滤代码
 * - isAdmin / canAccessCountry 仅用于"是否显示某个 UI 元素"的判断
 *   （如显示"主数据管理"菜单、显示"全部国家"按钮等）
 * - 永远不要把 isAdmin 当作"允许调用某 API"的保险——后端 RLS 才是保险
 */
export type CurrentUser = {
  userId: string
  email: string
  displayName: string
  role: 'admin' | 'sales'
  isAdmin: boolean
  isSuperAdmin: boolean   // 只有超级 admin 能改别人的 role / super_admin 标识
  isActive: boolean
  // 该用户能访问的国家 ID 列表（admin 总是返回所有国家）
  countryIds: number[]
  // 便捷判断
  canAccessCountry: (countryId: number) => boolean
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // 拉 sales_rep + 通过 sales_rep_country 关联国家
  const { data: rep, error: repErr } = await supabase
    .from('sales_rep')
    .select('id, display_name, email, role, is_active, is_super_admin')
    .eq('user_id', user.id)
    .maybeSingle()

  if (repErr) {
    console.error('[getCurrentUser] sales_rep query error:', repErr)
  }

  // 默认值（处理新用户尚未配置的情况）
  const role = (rep?.role ?? 'sales') as 'admin' | 'sales'
  const isAdmin = role === 'admin'
  const isSuperAdmin = Boolean(rep?.is_super_admin)
  const isActive = rep?.is_active ?? true

  // 取该用户能访问的国家
  let countryIds: number[] = []
  if (isAdmin) {
    // admin → 所有国家
    const { data: allCountries } = await supabase
      .from('country')
      .select('id')
      .eq('is_active', true)
    countryIds = (allCountries ?? []).map((c: any) => c.id)
  } else if (rep) {
    // sales → 通过 sales_rep_country 关联表
    const { data: links } = await supabase
      .from('sales_rep_country')
      .select('country_id')
      .eq('sales_rep_id', rep.id)
      .is('valid_to', null)  // 仅当前生效的关系
    countryIds = (links ?? []).map((l: any) => l.country_id)
  }

  return {
    userId: user.id,
    email: rep?.email ?? user.email ?? '',
    displayName: rep?.display_name ?? user.email?.split('@')[0] ?? 'Unknown',
    role,
    isAdmin,
    isSuperAdmin,
    isActive,
    countryIds,
    canAccessCountry: (id: number) => isAdmin || countryIds.includes(id),
  }
}
