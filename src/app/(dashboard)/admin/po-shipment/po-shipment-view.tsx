'use client'

import { useMemo } from 'react'
import { isShipped, UnshippedTable, ActionedTable, type UnRow } from '../../po/_ops'

// OpsRow = UnRow（三张表要用的列）+ 过滤所需的 ship/delivery/status。
// UnRow 是其结构子集，故 OpsRow[] 可直接传给 Unshipped/Actioned 表。
export type OpsRow = UnRow & {
  ship_date: string | null
  delivery_date: string | null
  po_status: string | null
}

export function PoShipmentView({ rows, plnToEur }: { rows: OpsRow[]; plnToEur: number }) {
  const byDateDesc = (a: OpsRow, b: OpsRow) => (b.po_date ?? '').localeCompare(a.po_date ?? '')

  // 待发：未发货（无 ship_date 且无 delivery_date）且未被手动标记（partial/cancelled 已在各自表）
  const unshipped = useMemo(() => rows.filter(r => !isShipped(r) && !r.po_status).sort(byDateDesc), [rows])
  const partialRows = useMemo(() => rows.filter(r => r.po_status === 'partial').sort(byDateDesc), [rows])
  const cancelledRows = useMemo(() => rows.filter(r => r.po_status === 'cancelled').sort(byDateDesc), [rows])

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-1">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">🚚 PO &amp; Shipment</h1>
        <p className="text-sm text-gray-500 mt-1">
          Operate PO fulfilment here — mark shipped / partial / cancelled and record notes.
          The public <span className="font-medium text-gray-700">PO</span> page is now a read-only data dashboard;
          every change made here flows straight back into it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">🚚 Unshipped · <strong className="tabular-nums">{unshipped.length}</strong></span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">◑ Partially delivered · <strong className="tabular-nums">{partialRows.length}</strong></span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">✗ Cancelled · <strong className="tabular-nums">{cancelledRows.length}</strong></span>
        </div>
      </div>

      <UnshippedTable rows={unshipped} plnToEur={plnToEur} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActionedTable rows={partialRows} mode="partial" plnToEur={plnToEur} viewerIsAdmin={true} />
        <ActionedTable rows={cancelledRows} mode="cancelled" plnToEur={plnToEur} viewerIsAdmin={true} />
      </div>
    </div>
  )
}
