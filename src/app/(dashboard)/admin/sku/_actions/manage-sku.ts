'use server'

/**
 * SKU master data management actions (admin only).
 *
 * 数据层防御：
 *  - RLS: sku_admin_write 仅 is_admin() 可写
 *  - UNIQUE INDEX(lower(trim(code))) 防 code 重复
 *  - BEFORE DELETE trigger 拦截带 shipment/forecast/PSI 引用的硬删
 *  - AFTER trigger 自动写 sku_audit_log
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code?: string }

export type SkuInput = {
  code: string
  name: string
  name_zh?: string | null
  category?: string | null
  series?: string | null
  family?: string | null
  color?: string | null
  ean?: string | null
  box_qty?: number | null
  unit_weight_g?: number | null
  rrp_eur?: number | null
  rrp_usd?: number | null
  cost_usd?: number | null
  lifecycle?: string | null   // active / eol / discontinued / 等
  launch_date?: string | null // YYYY-MM-DD
  region_scope?: string[] | null
  sort_order?: number | null
  notes?: string | null
}

// ───────────────────────────────────────
// 1. Create
// ───────────────────────────────────────
export async function createSKU(input: SkuInput): Promise<ActionResult> {
  const code = input.code?.trim()
  const name = input.name?.trim()
  if (!code) return { ok: false, error: 'SKU code is required' }
  if (!name) return { ok: false, error: 'Name is required' }
  if (code.length > 50) return { ok: false, error: 'Code too long (max 50)' }
  if (name.length > 200) return { ok: false, error: 'Name too long (max 200)' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const payload = {
    code,
    name,
    name_zh: input.name_zh?.trim() || null,
    category: input.category?.trim() || null,
    series: input.series?.trim() || null,
    family: input.family?.trim() || null,
    color: input.color?.trim() || null,
    ean: input.ean?.trim() || null,
    box_qty: input.box_qty ?? null,
    unit_weight_g: input.unit_weight_g ?? null,
    rrp_eur: input.rrp_eur ?? null,
    rrp_usd: input.rrp_usd ?? null,
    cost_usd: input.cost_usd ?? null,
    lifecycle: input.lifecycle?.trim() || 'active',
    launch_date: input.launch_date || null,
    region_scope: input.region_scope ?? null,
    sort_order: input.sort_order ?? 999,
    notes: input.notes?.trim() || null,
    is_active: true,
    created_by: user.id,
    updated_by: user.id,
  }

  const { data, error } = await supabase
    .from('sku')
    .insert(payload)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `SKU code "${code}" already exists`, code: 'DUPLICATE' }
    }
    if (error.code === '42501' || error.message?.includes('permission')) {
      return { ok: false, error: 'Admin permission required', code: 'NOT_ADMIN' }
    }
    return { ok: false, error: error.message, code: error.code }
  }

  revalidatePath('/admin/sku')
  revalidatePath('/forecast')
  revalidatePath('/psi')
  revalidatePath('/shipments')
  return { ok: true, data }
}

// ───────────────────────────────────────
// 2. Update
// ───────────────────────────────────────
export async function updateSKU(id: number, input: Partial<SkuInput>): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const patch: any = { updated_by: user.id, updated_at: new Date().toISOString() }

  // 字符串字段：trim，空字符串变 null
  const trimStrFields: (keyof SkuInput)[] = [
    'code', 'name', 'name_zh', 'category', 'series', 'family',
    'color', 'ean', 'lifecycle', 'notes', 'launch_date',
  ]
  for (const f of trimStrFields) {
    if (input[f] !== undefined) {
      const v = (input[f] as string)?.trim()
      patch[f] = v || null
    }
  }

  // 数字字段：直接赋值（含 null）
  const numFields: (keyof SkuInput)[] = [
    'box_qty', 'unit_weight_g', 'rrp_eur', 'rrp_usd', 'cost_usd', 'sort_order',
  ]
  for (const f of numFields) {
    if (input[f] !== undefined) patch[f] = input[f] ?? null
  }

  // 数组
  if (input.region_scope !== undefined) patch.region_scope = input.region_scope ?? null

  // 校验必填
  if (patch.code === null || patch.code === '') return { ok: false, error: 'Code cannot be empty' }
  if (patch.name === null || patch.name === '') return { ok: false, error: 'Name cannot be empty' }

  const { data, error } = await supabase
    .from('sku')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'Another SKU with this code already exists', code: 'DUPLICATE' }
    }
    if (error.code === '42501') return { ok: false, error: 'Admin permission required', code: 'NOT_ADMIN' }
    return { ok: false, error: error.message, code: error.code }
  }

  revalidatePath('/admin/sku')
  revalidatePath('/forecast')
  revalidatePath('/psi')
  revalidatePath('/shipments')
  return { ok: true, data }
}

// ───────────────────────────────────────
// 3. Deactivate (软删)
// ───────────────────────────────────────
export async function deactivateSKU(id: number, reason?: string): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase
    .from('sku')
    .update({
      is_active: false,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
      ...(reason ? { notes: `[Deactivated] ${reason}` } : {}),
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message, code: error.code }

  revalidatePath('/admin/sku')
  revalidatePath('/forecast')
  revalidatePath('/psi')
  revalidatePath('/shipments')
  return { ok: true }
}

// ───────────────────────────────────────
// 4. Reactivate
// ───────────────────────────────────────
export async function reactivateSKU(id: number): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase
    .from('sku')
    .update({
      is_active: true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message, code: error.code }

  revalidatePath('/admin/sku')
  revalidatePath('/forecast')
  revalidatePath('/psi')
  revalidatePath('/shipments')
  return { ok: true }
}

// ───────────────────────────────────────
// 5. Delete permanently — 仅无业务引用时允许（trigger 自动拦截）
// ───────────────────────────────────────
export async function deleteSKUPermanently(id: number): Promise<ActionResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { error } = await supabase
    .from('sku')
    .delete()
    .eq('id', id)

  if (error) {
    if (error.message?.includes('SKU_HAS_HISTORY')) {
      return {
        ok: false,
        error: '该 SKU 已有历史业务数据（shipment / forecast / PSI），无法硬删。请改用「停用 Deactivate」。',
        code: 'SKU_HAS_HISTORY',
      }
    }
    if (error.code === '42501') return { ok: false, error: 'Admin permission required', code: 'NOT_ADMIN' }
    return { ok: false, error: error.message, code: error.code }
  }

  revalidatePath('/admin/sku')
  return { ok: true }
}

// ───────────────────────────────────────
// 6. Get reference count
// ───────────────────────────────────────
export async function getSKUReferenceCount(id: number): Promise<{
  shipments: number
  forecast_cells: number
  psi_rows: number
}> {
  const supabase = createClient()
  const [{ count: sc }, { count: fc }, { count: pc }] = await Promise.all([
    supabase.from('shipment').select('*', { count: 'exact', head: true }).eq('sku_id', id),
    supabase.from('forecast_cell').select('*', { count: 'exact', head: true }).eq('sku_id', id),
    supabase.from('weekly_psi_v2').select('*', { count: 'exact', head: true }).eq('sku_id', id),
  ])
  return {
    shipments: sc ?? 0,
    forecast_cells: fc ?? 0,
    psi_rows: pc ?? 0,
  }
}
