import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import type { OpsRow, Batch } from '../../po/_ops'
import { PoShipmentView, type SkuOpt, type CountryOpt, type KaOpt } from './po-shipment-view'

export const dynamic = 'force-dynamic'

/**
 * /admin/po-shipment — PO & Shipment 履约流水线（admin only）
 *
 * 一条流水线管完整 PO 生命周期：
 *   🆕 New PO(po_status='new') → 📦 To Ship(null) → ✈️ Shipped(ship_date) → 📬 Delivered(delivery_date)
 *   旁支：◑ Partial(po_status='partial') · ✗ Cancelled(po_status='cancelled')
 * 每周导入的新 PO 因列默认值 'new' 自动落 New PO，供应链 Confirm 后才进 To Ship。
 * 公开 /po 页现为只读看板；所有发货操作都在这里。国家隔离仍由 channel_po 的 RLS 兜底（admin 可见全部）。
 */

async function getPlnToEur(): Promise<number> {
  const WEEK = 60 * 60 * 24 * 7
  const sources: Array<{ url: string; pick: (j: any) => unknown }> = [
    { url: 'https://api.frankfurter.dev/v1/latest?base=PLN&symbols=EUR', pick: (j) => j?.rates?.EUR },
    { url: 'https://open.er-api.com/v6/latest/PLN', pick: (j) => j?.rates?.EUR },
  ]
  for (const s of sources) {
    try {
      const res = await fetch(s.url, { next: { revalidate: WEEK } })
      if (!res.ok) continue
      const r = s.pick(await res.json())
      if (typeof r === 'number' && r > 0 && r < 1) return r
    } catch { /* 试下一个源 */ }
  }
  return 0.23
}

export default async function AdminPoShipmentPage() {
  const me = await getCurrentUser()
  if (!me.isAdmin) redirect('/shipments')

  const supabase = createClient()
  const plnToEur = await getPlnToEur()

  const [{ data: pos, error }, { data: shipList }, { data: docList }, { data: skuList }, { data: countryList }, { data: kaList }] = await Promise.all([
    supabase.from('channel_po').select(`
      id, po_number, po_date, qty_ordered, ship_date, delivery_date, notes, fd_buying_price, turnover, currency, po_status, delivered_qty,
      sku:sku_id ( code, name ),
      country:country_id ( code, name_en, flag_emoji ),
      ka:ka_id ( name )
    `).order('po_date', { ascending: false }),
    // 发货批次（唯一事实来源）；父行的日期/已发量由 DB 触发器从这里派生
    supabase.from('po_shipment').select('id, po_id, qty, ship_date, delivery_date, notes')
      .order('ship_date', { ascending: true, nullsFirst: true }).order('id'),
    // 每个 PO 的文档数（供 📎 角标）；文件本体在 Storage，此处只数元数据行
    supabase.from('po_document').select('po_number'),
    supabase.from('sku').select('id, code, name').eq('is_active', true).order('code'),
    supabase.from('country').select('id, code, name_en, flag_emoji').eq('is_active', true).order('sort_order'),
    supabase.from('ka').select('id, name, country_id').eq('is_active', true).order('name'),
  ])

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">Failed to load: {error.message}</div>
      </div>
    )
  }

  const rows: OpsRow[] = (pos ?? []).map((r: any) => ({
    id: r.id,
    po_date: r.po_date,
    po_number: r.po_number,
    notes: r.notes,
    ship_date: r.ship_date,
    delivery_date: r.delivery_date,
    po_status: r.po_status,
    qty: r.qty_ordered,
    delivered_qty: r.delivered_qty,
    fd_buying_price: r.fd_buying_price,
    turnover: r.turnover,
    currency: r.currency,
    sku_code: r.sku?.code ?? '',
    sku_name: r.sku?.name ?? '',
    country_code: r.country?.code ?? '',
    country_flag: r.country?.flag_emoji ?? '',
    ka_name: r.ka?.name ?? null,
  }))

  const batches: Batch[] = (shipList ?? []).map((b: any) => ({
    id: b.id, po_id: b.po_id, qty: Number(b.qty),
    ship_date: b.ship_date, delivery_date: b.delivery_date, notes: b.notes,
  }))

  // po_number → 文档数
  const docCounts: Record<string, number> = {}
  ;(docList ?? []).forEach((d: any) => { if (d.po_number) docCounts[d.po_number] = (docCounts[d.po_number] ?? 0) + 1 })

  const skus: SkuOpt[] = (skuList ?? []).map((s: any) => ({ id: s.id, code: s.code, name: s.name }))
  const countries: CountryOpt[] = (countryList ?? []).map((c: any) => ({ id: c.id, code: c.code, name: c.name_en, flag: c.flag_emoji }))
  const kas: KaOpt[] = (kaList ?? []).map((k: any) => ({ id: k.id, name: k.name, country_id: k.country_id }))

  return <PoShipmentView rows={rows} batches={batches} docCounts={docCounts} plnToEur={plnToEur} skus={skus} countries={countries} kas={kas} />
}

export const metadata = { title: 'Shipment Workflow · INIU ERP' }
