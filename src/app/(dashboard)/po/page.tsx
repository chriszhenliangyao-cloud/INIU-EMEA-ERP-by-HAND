import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { PoView } from './po-view'

// Value 模式把 PLN 营业额统一折算成 EUR 所用的实时汇率。
// 服务端拉取、Next.js fetch 缓存 7 天自动续期（每周一次）；ECB(frankfurter) 主、open.er-api 兜底、0.23 最终兜底。
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
    } catch { /* 网络/解析失败 → 试下一个源 */ }
  }
  return 0.23 // 兜底：两源都不可用时
}

export default async function PoPage() {
  // PO 对所有人开放；国家隔离由 channel_po 的 RLS（read=can_access_country）自动处理，
  // 销售只能查到自己被分配国家的订单行。
  const me = await getCurrentUser()
  const supabase = createClient()
  const plnToEur = await getPlnToEur()
  const { data: pos, error } = await supabase
    .from('channel_po')
    .select(`
      id, po_number, po_date, qty_ordered, ship_date, delivery_date, notes, fd_buying_price, turnover, currency,
      sku:sku_id ( id, code, name, category ),
      country:country_id ( id, code, name_en, flag_emoji, region ),
      ka:ka_id ( id, name )
    `)
    .order('po_date', { ascending: false })

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load: {error.message}
        </div>
      </div>
    )
  }

  type FlatRow = {
    id: number; po_date: string; qty: number; po_number: string | null; ship_date: string | null; delivery_date: string | null; notes: string | null
    fd_buying_price: number | null; turnover: number | null; currency: string | null
    sku_id: number; sku_code: string; sku_name: string; sku_category: string | null
    country_id: number; country_code: string; country_name: string; country_flag: string; country_region: string
    ka_id: number | null; ka_name: string | null
  }

  const rows: FlatRow[] = (pos ?? []).map((r: any) => ({
    id: r.id,
    po_date: r.po_date,
    qty: r.qty_ordered,
    po_number: r.po_number,
    ship_date: r.ship_date,
    delivery_date: r.delivery_date,
    notes: r.notes,
    fd_buying_price: r.fd_buying_price,
    turnover: r.turnover,
    currency: r.currency,
    sku_id: r.sku?.id,
    sku_code: r.sku?.code,
    sku_name: r.sku?.name,
    sku_category: r.sku?.category,
    country_id: r.country?.id,
    country_code: r.country?.code,
    country_name: r.country?.name_en,
    country_flag: r.country?.flag_emoji,
    country_region: r.country?.region,
    ka_id: r.ka?.id ?? null,
    ka_name: r.ka?.name ?? null,
  }))

  return (
    <PoView
      rows={rows}
      viewerIsAdmin={me.isAdmin}
      viewerName={me.displayName}
      marketCount={me.countryIds.length}
      plnToEur={plnToEur}
    />
  )
}

export const metadata = { title: 'PO · INIU ERP' }
