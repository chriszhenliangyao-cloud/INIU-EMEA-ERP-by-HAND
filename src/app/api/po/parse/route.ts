import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'

/**
 * POST /api/po/parse
 * body: { pdf: <base64 string> }  — a single PO PDF
 *
 * 用 Google Gemini（免费层）把 PO PDF 解析成结构化字段，返回给前端预填「Add PO」表单。
 * Key 存在服务端环境变量 GEMINI_API_KEY，绝不下发到浏览器。
 * 解析结果仅用于预填，人工核对后才入库 —— 不直接写数据库。
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

const SCHEMA = {
  type: 'object',
  properties: {
    po_number:    { type: 'string', description: 'Purchase order number as printed' },
    po_date:      { type: 'string', description: 'Order date in YYYY-MM-DD' },
    currency:     { type: 'string', description: 'ISO code, e.g. EUR or PLN' },
    customer_name:{ type: 'string', description: 'The buyer / retailer / KA name on the PO' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          part_number: { type: 'string', description: 'Supplier part number / model / SKU code for this line' },
          ean:         { type: 'string', description: 'EAN / barcode if present' },
          description: { type: 'string' },
          qty:         { type: 'number', description: 'Ordered quantity' },
          unit_price:  { type: 'number', description: 'Unit price / buying price, number only' },
        },
        required: ['qty'],
      },
    },
  },
  required: ['lines'],
}

const PROMPT = `You are extracting structured data from a supplier Purchase Order (PO) PDF for INIU power-bank / charger products.
Return ONLY the fields in the schema.
- po_number: the PO / order number exactly as printed.
- po_date: the order date, formatted YYYY-MM-DD.
- currency: ISO code (EUR, PLN, ...). Infer from currency symbols if not explicit.
- customer_name: the buyer / retailer name (e.g. Komsa, Bigben, x-kom).
- lines: one entry per ordered product line. part_number = the model / supplier SKU (e.g. P75-P1-WT, PM61 BLUE, C11-P1). Include ean if a barcode column exists. qty = ordered quantity (integer). unit_price = the unit buying price as a plain number (strip currency symbols and thousand separators).
Ignore totals, taxes, shipping lines, and header/footer boilerplate.`

export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on the server.' }, { status: 500 })

  let pdf: string
  try {
    const body = await req.json()
    pdf = String(body?.pdf || '')
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!pdf) return NextResponse.json({ error: 'No PDF provided' }, { status: 400 })
  // 粗略大小上限（base64 ~ 1.37x）：约 15MB PDF
  if (pdf.length > 20_000_000) return NextResponse.json({ error: 'PDF too large (max ~15MB)' }, { status: 413 })

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`
  const payload = {
    contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: pdf } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  }

  let g: Response
  try {
    g = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  } catch (e: any) {
    return NextResponse.json({ error: `Gemini request failed: ${e?.message ?? e}` }, { status: 502 })
  }
  if (!g.ok) {
    const t = await g.text().catch(() => '')
    return NextResponse.json({ error: `Gemini ${g.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }
  const data = await g.json().catch(() => null)
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return NextResponse.json({ error: 'Empty response from Gemini' }, { status: 502 })

  let parsed: any
  try { parsed = JSON.parse(text) } catch {
    return NextResponse.json({ error: 'Could not parse Gemini JSON output' }, { status: 502 })
  }
  return NextResponse.json({ parsed })
}
