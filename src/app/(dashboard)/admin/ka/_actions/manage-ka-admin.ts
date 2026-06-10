'use server'

/**
 * Admin-only KA hierarchy management actions.
 *
 * 与 forecast/_actions/manage-ka.ts（销售自助，本国 CRUD）的区别：
 *  - 这里是 admin 全局视角：可改任何国家 KA 的 parent / type / active / notes
 *  - 层级合法性由 DB trigger validate_ka_parent 把关：
 *      同国家 / parent 须 distributor|group / 防循环 / 最深 3 层（FD→group→retailer）
 *  - RLS：admin 写权限 bypass；所有变更自动进 ka_audit_log
 */

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { revalidatePath } from 'next/cache'

type ActionResult =
  | { ok: true }
  | { ok: false; error: string }

// ───────────────────────────────────────
// Create（admin 可建任何国家的 KA）
// ───────────────────────────────────────
export async function adminCreateKa(input: {
  country_id: number
  name: string
  ka_type: 'retailer' | 'distributor' | 'group'
  parent_ka_id?: number | null
  notes?: string | null
}): Promise<ActionResult> {
  const me = await getCurrentUser()
  if (!me.isAdmin) return { ok: false, error: 'Admin permission required' }

  const name = input.name?.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  if (name.length > 100) return { ok: false, error: 'Name too long (max 100 chars)' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase.from('ka').insert({
    country_id: input.country_id,
    name,
    ka_type: input.ka_type,
    parent_ka_id: input.parent_ka_id ?? null,
    notes: input.notes?.trim() || null,
    sort_order: 999,
    is_active: true,
    created_by: user.id,
    updated_by: user.id,
  })

  if (error) {
    if (error.code === '23505') return { ok: false, error: `Channel "${name}" already exists in this country` }
    return { ok: false, error: error.message }
  }

  revalidatePath('/admin/ka')
  revalidatePath('/forecast')
  revalidatePath('/psi')
  return { ok: true }
}

// ───────────────────────────────────────
// Delete（硬删）— 仅无业务引用时允许：
//  - DB trigger prevent_ka_delete_if_referenced 拦截带 forecast/shipment/PSI 数据的删除
//  - 有下游 children 时 parent_ka_id 外键 (ON DELETE RESTRICT) 也会拦截
// ───────────────────────────────────────
export async function adminDeleteKa(id: number): Promise<ActionResult> {
  const me = await getCurrentUser()
  if (!me.isAdmin) return { ok: false, error: 'Admin permission required' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase.from('ka').delete().eq('id', id)

  if (error) {
    if (error.message?.includes('KA_HAS_HISTORY')) {
      return { ok: false, error: '该渠道有历史业务数据（forecast / shipment / PSI），无法硬删。请改用停用（取消 Active）。' }
    }
    if (error.code === '23503') {
      return { ok: false, error: '该渠道有下游 KA 挂在它名下，先把下游的 parent 改走再删。' }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/admin/ka')
  revalidatePath('/forecast')
  revalidatePath('/psi')
  return { ok: true }
}

// ───────────────────────────────────────
// 引用计数（删除前 UI 提示用）
// ───────────────────────────────────────
export async function adminGetKaRefs(id: number): Promise<{
  forecast_cells: number
  shipments: number
  psi_rows: number
  children: number
}> {
  const supabase = createClient()
  const [{ count: fc }, { count: sc }, { count: pc }, { count: ch }] = await Promise.all([
    supabase.from('forecast_cell').select('*', { count: 'exact', head: true }).eq('ka_id', id),
    supabase.from('shipment').select('*', { count: 'exact', head: true }).eq('ka_id', id),
    supabase.from('weekly_psi_v2').select('*', { count: 'exact', head: true }).eq('ka_id', id),
    supabase.from('ka').select('*', { count: 'exact', head: true }).eq('parent_ka_id', id),
  ])
  return {
    forecast_cells: fc ?? 0,
    shipments: sc ?? 0,
    psi_rows: pc ?? 0,
    children: ch ?? 0,
  }
}

export async function adminUpdateKa(input: {
  id: number
  name?: string
  ka_type?: 'retailer' | 'distributor' | 'group'
  parent_ka_id?: number | null
  is_active?: boolean
  notes?: string | null
  sort_order?: number
}): Promise<ActionResult> {
  const me = await getCurrentUser()
  if (!me.isAdmin) return { ok: false, error: 'Admin permission required' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const patch: any = { updated_by: user.id, updated_at: new Date().toISOString() }
  if (input.name !== undefined) {
    const n = input.name.trim()
    if (!n) return { ok: false, error: 'Name cannot be empty' }
    patch.name = n
  }
  if (input.ka_type !== undefined) patch.ka_type = input.ka_type
  if (input.parent_ka_id !== undefined) patch.parent_ka_id = input.parent_ka_id
  if (input.is_active !== undefined) patch.is_active = input.is_active
  if (input.notes !== undefined) patch.notes = input.notes || null
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order

  const { error } = await supabase.from('ka').update(patch).eq('id', input.id)

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Another channel with this name already exists in this country' }
    // DB trigger 抛出的层级校验异常直接透传（中文信息）
    return { ok: false, error: error.message }
  }

  revalidatePath('/admin/ka')
  revalidatePath('/forecast')
  revalidatePath('/psi')
  return { ok: true }
}
