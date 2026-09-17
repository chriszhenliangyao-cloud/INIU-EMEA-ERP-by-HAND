import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { FulfillmentView } from './fulfillment-view'
import type { FPo } from './fulfillment-view'

export const dynamic = 'force-dynamic'

/**
 * /admin/fulfillment — 履约看板(admin only)
 *
 * 把三个成熟模块整合到 ERP,与真实生产库贯通:
 *   ① 发货履约 · 单据视图   —— 每张 PO = 一份采购单,直接在单里发/未发
 *   ② SKU 交期看板          —— 只看未发,底部渠道统计
 *   ③ 开票 · 财务           —— 开票单位 = 已发货批次(po_shipment)
 *
 * 数据源与 /admin/po-shipment 完全一致(批次是唯一事实来源,父行由 DB 触发器派生):
 *   channel_po(行) · po_shipment(发货批次) · po_leadtime(交期/延期 overlay) · po_invoice(开票)
 * 国家隔离由 RLS 兜底(admin 可见全部)。写操作在客户端组件里直接走 browser client。
 */
export default async function FulfillmentPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) redirect('/po')

  const supabase = createClient()
  const [{ data: pos, error }, { data: shipList }, { data: leadList }, { data: invList }] = await Promise.all([
    supabase.from('channel_po').select(`
      id, po_number, po_date, qty_ordered, fd_buying_price, currency, po_status,
      sku:sku_id ( code, name ),
      country:country_id ( code, flag_emoji ),
      ka:ka_id ( name )
    `).order('po_date', { ascending: false }),
    supabase.from('po_shipment').select('id, po_id, qty, ship_date, delivery_date')
      .order('ship_date', { ascending: true, nullsFirst: true }).order('id'),
    supabase.from('po_leadtime').select('po_line_id, slot, value').in('slot', ['b0_eta', 'b0_delay', 'b0_cancel']),
    supabase.from('po_invoice').select('shipment_id'),
  ])

  if (error) {
    return <div className="p-6"><div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">Failed to load: {error.message}</div></div>
  }

  // 批次按 po_id 归集
  const batchByLine = new Map<number, { id: number; qty: number; ship: string | null; deliv: string | null }[]>()
  ;(shipList ?? []).forEach((b: any) => {
    const arr = batchByLine.get(b.po_id) ?? []
    arr.push({ id: b.id, qty: Number(b.qty), ship: b.ship_date, deliv: b.delivery_date })
    batchByLine.set(b.po_id, arr)
  })
  // po_leadtime overlay:交期(b0_eta) / 延期(b0_delay=JSON {active,list})
  const etaByLine = new Map<number, string>()
  const delayByLine = new Map<number, { active: boolean; list: any[] }>()
  const cancelByLine = new Map<number, string>()
  ;(leadList ?? []).forEach((r: any) => {
    if (r.slot === 'b0_eta' && r.value) etaByLine.set(r.po_line_id, r.value)
    else if (r.slot === 'b0_delay' && r.value) { try { delayByLine.set(r.po_line_id, JSON.parse(r.value)) } catch {} }
    else if (r.slot === 'b0_cancel' && r.value) cancelByLine.set(r.po_line_id, r.value)
  })
  const invoicedIds = (invList ?? []).map((r: any) => Number(r.shipment_id))

  // channel_po 行 → 按 po_number 分组为 demo 结构(一张 PO)
  const byPo = new Map<string, FPo>()
  ;(pos ?? []).forEach((r: any) => {
    const key = r.po_number ?? `#${r.id}`
    let po = byPo.get(key)
    if (!po) {
      po = {
        po: key, po_date: r.po_date,
        country: r.country?.code ?? '', flag: r.country?.flag_emoji ?? '',
        ka: r.ka?.name ?? '—', currency: r.currency ?? 'EUR', lines: [],
      }
      byPo.set(key, po)
    }
    const dl = delayByLine.get(r.id)
    po.lines.push({
      id: r.id,
      sku: r.sku?.code ?? '—',
      product: r.sku?.name ?? '',
      qty: Number(r.qty_ordered),
      price: r.fd_buying_price != null ? Number(r.fd_buying_price) : 0,
      po_status: r.po_status,
      eta: etaByLine.get(r.id) ?? null,
      delays: dl?.list ?? [],
      delayActive: !!dl?.active,
      cancel_reason: cancelByLine.get(r.id) ?? null,
      batches: batchByLine.get(r.id) ?? [],
    })
  })
  // 有发货批次或较新的 PO 排前;整体按 po_date 倒序(与 Shipment Workflow 一致)
  const list = [...byPo.values()]

  return <FulfillmentView pos={list} invoicedIds={invoicedIds} today={new Date().toISOString().slice(0, 10)} />
}

export const metadata = { title: '履约看板 · INIU ERP' }
