import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { generateShippingDocsZip } from '@/lib/shipping-docs/generate'
import type { DocLine } from '@/lib/shipping-docs/config'

// 需要 Node 运行时（exceljs/docx/jszip 依赖 Node），非 edge
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const { poNumber, kaId, meta, lines } = body ?? {}
  if (!kaId || !Array.isArray(lines) || !lines.length) return NextResponse.json({ error: 'missing kaId / lines' }, { status: 400 })

  const supabase = createClient()
  // RLS(admin) + can_access_country 由 DB 兜底；这里显式取该 KA 的抬头配置
  const { data: cfg, error } = await supabase.from('ka_shipping_config')
    .select('customer_name, ship_to_address, customer_contact, supplier_name, delivery_mode, doc_code')
    .eq('ka_id', kaId).single()
  if (error || !cfg) return NextResponse.json({ error: `no shipping config for KA ${kaId}` }, { status: 400 })

  const cleanLines: DocLine[] = lines.map((l: any) => ({
    po: String(l.po ?? poNumber ?? ''),
    description: String(l.description ?? ''),
    ean: String(l.ean ?? ''),
    model: String(l.model ?? ''),
    supplierSku: String(l.supplierSku ?? l.model ?? ''),
    customerRef: String(l.customerRef ?? ''),
    qtyOrdered: Number(l.qtyOrdered ?? 0),
    qtySent: Number(l.qtySent ?? 0),
    unitsPerCarton: l.unitsPerCarton != null && l.unitsPerCarton !== '' ? Number(l.unitsPerCarton) : null,
    cartonGrossKg: l.cartonGrossKg != null && l.cartonGrossKg !== '' ? Number(l.cartonGrossKg) : null,
    palletNo: String(l.palletNo ?? ''),
  }))

  try {
    const zip = await generateShippingDocsZip({
      poNumber: String(poNumber ?? ''), kaId: Number(kaId), config: cfg as any,
      meta: {
        date: String(meta?.date ?? new Date().toISOString().slice(0, 10)),
        deliveryNoteNumber: String(meta?.deliveryNoteNumber ?? ''),
        pallets: String(meta?.pallets ?? ''),
        parcels: String(meta?.parcels ?? ''),
      },
      lines: cleanLines,
    })
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const fname = `ShippingDocs_${String(poNumber ?? 'PO').replace(/[^a-zA-Z0-9._-]+/g, '_')}_${stamp}.zip`
    return new NextResponse(new Uint8Array(zip), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fname}"` },
    })
  } catch (e: any) {
    return NextResponse.json({ error: `generation failed: ${e?.message ?? e}` }, { status: 500 })
  }
}
