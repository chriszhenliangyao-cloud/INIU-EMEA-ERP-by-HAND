import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { PoShipmentView, type OpsRow } from './po-shipment-view'

export const dynamic = 'force-dynamic'

/**
 * /admin/po-shipment — PO & Shipment（admin only）
 *
 * 所有 PO 发货操作集中在此：Unshipped（标记发货 / 部分 / 取消 + 备注）、
 * Partially Delivered、Cancelled。公开的 /po 页现在是纯数据看板。
 * 国家隔离仍由 channel_po 的 RLS 兜底（这里 admin 可见全部）。
 */

// Value 模式把 PLN 营业额折算成 EUR 的实时汇率（与 /po 同源）。
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
  const { data: pos, error } = await supabase
    .from('channel_po')
    .select(`
      id, po_number, po_date, qty_ordered, ship_date, delivery_date, notes, fd_buying_price, turnover, currency, po_status, delivered_qty,
      sku:sku_id ( code, name ),
      country:country_id ( code, name_en, flag_emoji ),
      ka:ka_id ( name )
    `)
    .order('po_date', { ascending: false })

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

  return <PoShipmentView rows={rows} plnToEur={plnToEur} />
}

export const metadata = { title: 'PO & Shipment · INIU ERP' }
