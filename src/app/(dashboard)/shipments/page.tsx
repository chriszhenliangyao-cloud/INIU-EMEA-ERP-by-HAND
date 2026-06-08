import { createClient } from '@/lib/supabase/server'
import { fmtNum, fmtDate } from '@/lib/utils'

export default async function ShipmentsPage() {
  const supabase = createClient()

  // RLS 自动按用户身份过滤——HQ admin 看全部，sales 只看自己的国家
  const { data: shipments, error } = await supabase
    .from('shipment')
    .select(`
      id, ship_date, effective_date, qty, status, po_number, source_type, internal_customer_name,
      sku:sku_id ( code, name, category ),
      country:country_id ( code, name_zh, flag_emoji ),
      ka:ka_id ( name )
    `)
    .order('effective_date', { ascending: false })
    .limit(500)

  if (error) {
    return <div className="p-6 text-red-600">加载失败: {error.message}</div>
  }

  // KPI 聚合
  const totalQty = shipments?.reduce((s, r) => s + (r.qty ?? 0), 0) ?? 0
  const channelRows = shipments?.filter(r => r.source_type === 'channel').length ?? 0
  const internalRows = shipments?.filter(r => r.source_type === 'internal_replenish').length ?? 0
  const uniqueCountries = new Set(shipments?.map(r => (r.country as any)?.code).filter(Boolean)).size

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* 页头 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">📊 发货记录</h1>
        <p className="text-sm text-gray-500 mt-1">
          展示你权限范围内的全部发货流水（最近 500 条）
        </p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="总发货量" value={fmtNum(totalQty)} hint="件 / 套" />
        <KpiCard label="渠道发货" value={fmtNum(channelRows)} hint="条记录" color="blue" />
        <KpiCard label="内部备货" value={fmtNum(internalRows)} hint="条记录" color="amber" />
        <KpiCard label="国家数" value={fmtNum(uniqueCountries)} hint="个市场" color="purple" />
      </div>

      {/* 明细表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">明细记录</h2>
          <p className="text-xs text-gray-500 mt-0.5">按发货日期倒序 · 共 {shipments?.length ?? 0} 条</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs font-semibold text-gray-600 uppercase">
                <th className="px-4 py-3">日期</th>
                <th className="px-4 py-3">国家</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">产品</th>
                <th className="px-4 py-3">客户</th>
                <th className="px-4 py-3 text-right">数量</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">PO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shipments?.map(row => {
                const sku = row.sku as any
                const country = row.country as any
                const ka = row.ka as any
                const isInternal = row.source_type === 'internal_replenish'
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{fmtDate(row.effective_date)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-base mr-1">{country?.flag_emoji}</span>
                      <span className="text-gray-600">{country?.code}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{sku?.code}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{sku?.name}</td>
                    <td className="px-4 py-3">
                      {isInternal ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                          {row.internal_customer_name}
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                          {ka?.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 tabular-nums">{fmtNum(row.qty)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[150px] truncate">{row.po_number ?? '-'}</td>
                  </tr>
                )
              })}
              {!shipments?.length && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    暂无你权限范围内的发货记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-600',
    amber: 'text-amber-600',
    purple: 'text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ? colorMap[color] : 'text-gray-900'}`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    delivered: { bg: 'bg-green-100 text-green-700', label: '✓ 已签收' },
    shipped: { bg: 'bg-blue-100 text-blue-700', label: '🚚 已发货' },
    planned: { bg: 'bg-amber-100 text-amber-700', label: '⏳ 计划中' },
    cancelled: { bg: 'bg-gray-100 text-gray-500', label: '✕ 已取消' },
  }
  const s = map[status] ?? { bg: 'bg-gray-100 text-gray-700', label: status }
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${s.bg}`}>{s.label}</span>
}
