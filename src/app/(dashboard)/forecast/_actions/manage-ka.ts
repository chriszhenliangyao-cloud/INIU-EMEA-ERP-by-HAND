'use server'

/**
 * KA self-service management actions.
 * 销售可以管理自己负责国家的渠道（KA）：增 / 改 / 停用 / 重启 / 硬删（仅无引用时）。
 *
 * 数据层防御：
 *  - RLS 仅允许 can_access_country(country_id) 的用户写
 *  - UNIQUE INDEX(country_id, lower(trim(name))) 防同国家重名
 *  - BEFORE DELETE trigger 拦截带 forecast/shipment/PSI 引用的硬删
 *  - AFTER trigger 自动写 ka_audit_log
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type ActionResult =
  | { ok: true; data?: any }
  | { ok: false; error: string; code?: string }

// ───────────────────────────────────────
// 1. Create
// ───────────────────────────────────────
export async function createKA(input: {
  country_id: number
  name: string
  ka_type: 'retailer' | 'distributor' | 'group'
  parent_ka_id?: number | null
  sort_order?: number
  notes?: string | null
}): Promise<ActionResult> {
  const name = input.name?.trim()
  if (!name) return { ok: false, error: 'Channel name is required' }
  if (name.length > 100) return { ok: false, error: 'Name too long (max 100 chars)' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { data, error } = await supabase
    .from('ka')
    .insert({
      country_id: input.country_id,
      name,
      ka_type: input.ka_type,
      parent_ka_id: input.parent_ka_id ?? null,
      sort_order: input.sort_order ?? 999,
      notes: input.notes || null,
      is_active: true,
      created_by: user.id,
      updated_by: user.id,
    })
    .select()
    .single()

  if (error) {
    // UNIQUE INDEX 违反 → 友好提示
    if (error.code === '23505') {
      return { ok: false, error: `Channel "${name}" already exists in this country`, code: 'DUPLICATE' }
    }
    return { ok: false, error: error.message, code: error.code }
  }

  revalidatePath('/forecast')
  revalidatePath('/psi')
  return { ok: true, data }
}

// ───────────────────────────────────────
// 2. Update (name / type / parent_ka_id / sort_order / notes)
// ───────────────────────────────────────
export async function updateKA(input: {
  id: number
  name?: string
  ka_type?: 'retailer' | 'distributor' | 'group'
  parent_ka_id?: number | null
  sort_order?: number
  notes?: string | null
}): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const patch: any = { updated_by: user.id, updated_at: new Date().toISOString() }
  if (input.name !== undefined) {
    const n = input.name.trim()
    if (!n) return { ok: false, error: 'Name cannot be empty' }
    if (n.length > 100) return { ok: false, error: 'Name too long (max 100 chars)' }
    patch.name = n
  }
  if (input.ka_type !== undefined) patch.ka_type = input.ka_type
  if (input.parent_ka_id !== undefined) patch.parent_ka_id = input.parent_ka_id
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order
  if (input.notes !== undefined) patch.notes = input.notes || null

  const { data, error } = await supabase
    .from('ka')
    .update(patch)
    .eq('id', input.id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Another channel with this name already exists`, code: 'DUPLICATE' }
    }
    return { ok: false, error: error.message, code: error.code }
  }

  revalidatePath('/forecast')
  revalidatePath('/psi')
  return { ok: true, data }
}

// ───────────────────────────────────────
// 3. Deactivate (软删 — is_active=false)
// ───────────────────────────────────────
export async function deactivateKA(id: number, reason?: string): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase
    .from('ka')
    .update({
      is_active: false,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
      // reason 写到 notes 字段（拼接历史）— 仅做参考
      ...(reason ? { notes: `[Deactivated] ${reason}` } : {}),
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message, code: error.code }

  revalidatePath('/forecast')
  revalidatePath('/psi')
  return { ok: true }
}

// ───────────────────────────────────────
// 4. Reactivate
// ───────────────────────────────────────
export async function reactivateKA(id: number): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase
    .from('ka')
    .update({
      is_active: true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message, code: error.code }

  revalidatePath('/forecast')
  revalidatePath('/psi')
  return { ok: true }
}

// ───────────────────────────────────────
// 5. Delete permanently (硬删) — 仅无业务引用时允许
//    trigger prevent_ka_delete_if_referenced 会自动拦截带数据的删除
// ───────────────────────────────────────
export async function deleteKAPermanently(id: number): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase
    .from('ka')
    .delete()
    .eq('id', id)

  if (error) {
    // trigger 抛出的 KA_HAS_HISTORY 异常
    if (error.message?.includes('KA_HAS_HISTORY')) {
      return {
        ok: false,
        error: '该渠道有历史业务数据（forecast / shipment / PSI），无法硬删。请改用「停用 Deactivate」。',
        code: 'KA_HAS_HISTORY',
      }
    }
    return { ok: false, error: error.message, code: error.code }
  }

  revalidatePath('/forecast')
  revalidatePath('/psi')
  return { ok: true }
}

// ───────────────────────────────────────
// 6. Get reference count (UI 显示用：删之前告诉用户该 KA 有多少历史数据)
// ───────────────────────────────────────
export async function getKAReferenceCount(id: number): Promise<{
  forecast_cells: number
  shipments: number
  psi_rows: number
}> {
  const supabase = createClient()
  const [{ count: fc }, { count: sc }, { count: pc }] = await Promise.all([
    supabase.from('forecast_cell').select('*', { count: 'exact', head: true }).eq('ka_id', id),
    supabase.from('shipment').select('*', { count: 'exact', head: true }).eq('ka_id', id),
    supabase.from('weekly_psi_v2').select('*', { count: 'exact', head: true }).eq('ka_id', id),
  ])
  return {
    forecast_cells: fc ?? 0,
    shipments: sc ?? 0,
    psi_rows: pc ?? 0,
  }
}
