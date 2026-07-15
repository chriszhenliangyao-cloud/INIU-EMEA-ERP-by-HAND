// PO 共享辅助（金额/发货判定/调色板/阶段判定）。公开 PO 看板与 admin「PO & Shipment」流水线共用。
// 操作 UI（履约流水线）在 admin/po-shipment/po-shipment-view.tsx。

// 发货判定：有 ship_date 或 delivery_date 任一即视为已发（物流偶尔漏填 ship_date，用送达日兜底）
export const isShipped = (r: { ship_date: string | null; delivery_date: string | null }) => !!(r.ship_date || r.delivery_date)

// 金额按原币种展示（不折算、不取整，保留真实 2 位小数）：EUR→€ · PLN→zł
export const CCY_SYM: Record<string, string> = { EUR: '€', PLN: 'zł ' }

// Value 模式把营业额统一折算成 EUR（明细列仍存原币，不受影响）。汇率经 page.tsx 注入。
export const toEUR = (turnover: number | null, currency: string | null, rate: number) =>
  turnover == null ? 0 : (currency === 'PLN' ? turnover * rate : turnover)

export const fmtMoney = (v: number | null | undefined, ccy: string | null) => {
  if (v == null) return '–'
  return (ccy ? (CCY_SYM[ccy] ?? ccy + ' ') : '') +
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 低饱和度调色板（PO 色卡，shipment 也复用）
export const PALETTE = ['#5b8def', '#52b788', '#9b8cce', '#e0a458', '#d98594', '#6cc3d5', '#c9a227', '#7aa095', '#b58db6', '#8a9bb0']

// 履约流水线一行 PO 的最小字段集
export type OpsRow = {
  id: number; po_date: string; po_number: string | null; notes: string | null
  ship_date: string | null; delivery_date: string | null; po_status: string | null
  sku_code: string; sku_name: string; ean: string | null
  country_code: string; country_flag: string; ka_name: string | null
  qty: number; delivered_qty: number | null
  fd_buying_price: number | null; turnover: number | null; currency: string | null
}

// 一次发货批次（po_shipment）。同一 PO 行可分多批发运，各批独立日期/备注。
export type Batch = {
  id: number; po_id: number; qty: number
  ship_date: string | null; delivery_date: string | null; notes: string | null
}

// 单张 PO 落在哪个履约阶段（互斥）。
// ⚠️ 判定顺序关键：日期判定必须排在 'new' 之前 —— 每周导入的行 96% 自带 ship/delivery date，
// 且 po_status 列默认 'new'。若 'new' 抢先，这些既成事实的已发/已达单会涌进 New PO 待确认。
export type Stage = 'new' | 'toship' | 'shipped' | 'delivered' | 'partial' | 'cancelled'
export function stageOf(r: OpsRow): Stage {
  if (r.po_status === 'cancelled') return 'cancelled'
  if (r.po_status === 'partial') return 'partial'   // 尾单未结 → 即使首批已送达也留在 Partial
  if (r.delivery_date) return 'delivered'
  if (r.ship_date) return 'shipped'
  if (r.po_status === 'new') return 'new'           // 只剩「无发货日的新单」才需要 Confirm
  return 'toship'
}
