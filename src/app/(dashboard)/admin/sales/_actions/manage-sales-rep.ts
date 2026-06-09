'use server'

/**
 * Sales rep master data actions.
 *
 * 数据层防御：
 *  - RLS: sales_rep_admin_all（admin 全权）+ enforce_super_admin_for_privileged_changes trigger 防止改 role/is_super_admin
 *  - email UNIQUE 约束
 *  - handle_new_user trigger 自动 link auth.users → sales_rep (按 email 匹配)
 *  - audit log trigger 自动写
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code?: string }

export type SalesRepInput = {
  display_name: string
  email: string
  role: 'admin' | 'sales'
  locale?: string
  hired_at?: string | null
  notes?: string | null
}

// ───────────────────────────────────────
// 1. Create
// ───────────────────────────────────────
export async function createSalesRep(input: SalesRepInput): Promise<ActionResult> {
  const display_name = input.display_name?.trim()
  const email = input.email?.trim().toLowerCase()
  if (!display_name) return { ok: false, error: 'Display name required' }
  if (!email) return { ok: false, error: 'Email required' }
  if (!/^[^\s@]+@iniushop\.com$/i.test(email)) {
    return { ok: false, error: 'Must be an @iniushop.com email' }
  }
  if (!['admin', 'sales'].includes(input.role)) {
    return { ok: false, error: 'Invalid role' }
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { data, error } = await supabase
    .from('sales_rep')
    .insert({
      display_name,
      email,
      role: input.role,
      locale: input.locale || 'en-US',
      hired_at: input.hired_at || null,
      notes: input.notes?.trim() || null,
      is_active: true,
      created_by: user.id,
      updated_by: user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Email "${email}" already exists`, code: 'DUPLICATE' }
    }
    if (error.code === '42501') {
      return { ok: false, error: 'Permission denied (role change requires super_admin)', code: 'NOT_SUPER_ADMIN' }
    }
    return { ok: false, error: error.message, code: error.code }
  }

  revalidatePath('/admin/sales')
  return { ok: true, data }
}

// ───────────────────────────────────────
// 2. Update basic info（不含 role / is_super_admin —— 那俩走单独 action）
// ───────────────────────────────────────
export async function updateSalesRep(id: number, input: Partial<Omit<SalesRepInput, 'role'>>): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const patch: any = { updated_by: user.id, updated_at: new Date().toISOString() }
  if (input.display_name !== undefined) {
    const v = input.display_name.trim()
    if (!v) return { ok: false, error: 'Display name cannot be empty' }
    patch.display_name = v
  }
  if (input.email !== undefined) {
    const v = input.email.trim().toLowerCase()
    if (!v) return { ok: false, error: 'Email cannot be empty' }
    if (!/^[^\s@]+@iniushop\.com$/i.test(v)) return { ok: false, error: 'Must be an @iniushop.com email' }
    patch.email = v
  }
  if (input.locale !== undefined) patch.locale = input.locale
  if (input.hired_at !== undefined) patch.hired_at = input.hired_at || null
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null

  const { error } = await supabase.from('sales_rep').update(patch).eq('id', id)
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Email already in use', code: 'DUPLICATE' }
    return { ok: false, error: error.message, code: error.code }
  }
  revalidatePath('/admin/sales')
  return { ok: true }
}

// ───────────────────────────────────────
// 3. Change role (super_admin only — trigger 会拦截)
// ───────────────────────────────────────
export async function changeSalesRepRole(id: number, newRole: 'admin' | 'sales'): Promise<ActionResult> {
  const supabase = createClient()
  const { error } = await supabase
    .from('sales_rep')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    if (error.message?.includes('NOT_SUPER_ADMIN') || error.code === '42501') {
      return { ok: false, error: '需要超级 admin 权限才能修改角色', code: 'NOT_SUPER_ADMIN' }
    }
    return { ok: false, error: error.message, code: error.code }
  }
  revalidatePath('/admin/sales')
  return { ok: true }
}

// ───────────────────────────────────────
// 4. Assign country (走 RPC，保证原子)
// ───────────────────────────────────────
export async function assignRepCountry(
  repId: number,
  countryId: number,
  isPrimary = false,
): Promise<ActionResult> {
  const supabase = createClient()
  const { error } = await supabase.rpc('assign_rep_country', {
    p_rep_id: repId,
    p_country_id: countryId,
    p_is_primary: isPrimary,
  })
  if (error) {
    if (error.message?.includes('DUPLICATE_ASSIGNMENT')) {
      return { ok: false, error: 'Already assigned to this country', code: 'DUPLICATE_ASSIGNMENT' }
    }
    return { ok: false, error: error.message, code: error.code }
  }
  revalidatePath('/admin/sales')
  revalidatePath('/forecast')
  return { ok: true }
}

// ───────────────────────────────────────
// 5. Unassign country (RPC: 设 valid_to=today，不删)
// ───────────────────────────────────────
export async function unassignRepCountry(repId: number, countryId: number): Promise<ActionResult> {
  const supabase = createClient()
  const { error } = await supabase.rpc('unassign_rep_country', {
    p_rep_id: repId,
    p_country_id: countryId,
  })
  if (error) {
    if (error.message?.includes('NO_ACTIVE_ASSIGNMENT')) {
      return { ok: false, error: 'No active assignment to remove', code: 'NO_ACTIVE_ASSIGNMENT' }
    }
    return { ok: false, error: error.message, code: error.code }
  }
  revalidatePath('/admin/sales')
  revalidatePath('/forecast')
  return { ok: true }
}

// ───────────────────────────────────────
// 6. Mark as left (RPC: 原子设 left_at + is_active=false + 所有国家 valid_to)
// ───────────────────────────────────────
export async function markRepLeft(repId: number, leaveDate?: string): Promise<ActionResult> {
  const supabase = createClient()
  const { error } = await supabase.rpc('mark_rep_left', {
    p_rep_id: repId,
    p_leave_date: leaveDate || new Date().toISOString().slice(0, 10),
  })
  if (error) return { ok: false, error: error.message, code: error.code }
  revalidatePath('/admin/sales')
  revalidatePath('/forecast')
  return { ok: true }
}

// ───────────────────────────────────────
// 7. Reactivate (回归 — 仅清 left_at + is_active=true，不自动恢复国家关联)
// ───────────────────────────────────────
export async function reactivateSalesRep(id: number): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase
    .from('sales_rep')
    .update({
      is_active: true,
      left_at: null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message, code: error.code }
  revalidatePath('/admin/sales')
  return { ok: true }
}
