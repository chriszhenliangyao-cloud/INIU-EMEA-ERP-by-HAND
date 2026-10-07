/**
 * PO PDF 规则解析(无 AI)：按 KA 模板抽取 PO 抬头 + 明细行，并做自校验 / 货号映射。
 *
 * 为什么不用 AI：各 KA 的 PO 都是固定模板，规则解析零成本、可复现、无地区/配额限制(7 月 Gemini 版因免费层 429 撤回)。
 * 新增一家 KA = 在 TEMPLATES 里加一个 {test, parse}，用该 KA 的真实 PDF 跑通自校验即可。
 *
 * 已支持：Bigben(FR) · ICP(ES) · Esprinet(ES) · Komsa(PL)。
 * 口径(Chris 定的，别自创)：单价/净额不含 Ecotaxe 与 TVA；货号映射不许猜 —— 只有 EAN / sku_alias / 货号精确才算「确定」，
 * 靠「型号+颜色」推出的只算「建议」，须人工确认；匹配不上须人工选。
 */

export type RawLine = { page: number; y: number; items: { x: number; w: number; text: string }[]; text: string }

export type ParsedLine = {
  raw_code: string; raw_desc: string; ean?: string
  qty: number; price: number; net: number
  delivery: string | null                      // PO 上的要求交期(ISO)，目前不入库
  extra: Record<string, unknown>
}
export type Check = { ok: boolean; label: string; detail: string }
export type ParsedPo =
  | { template: null; raw: string }
  | {
      template: string; template_label: string; ka_hint: string; country: string
      po: string | null; date: string | null; currency: string | null; delivery?: string | null
      lines: ParsedLine[]
      totals: { net?: number; pieces?: number; ecotax?: number; ecotax_lines?: number }
      checks: Check[]; ok: boolean
    }

// ───────── 工具 ─────────
/** 欧式数字：'4 245,54' '32.205,00€' '1.500' '29,1900' → Number */
export function num(s: unknown): number {
  if (s == null) return NaN
  let t = String(s).replace(/[€ \s]|EUR|PLN|zł/gi, '').trim()
  if (!t) return NaN
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  return Number(t)
}
const iso = (y: number, m: string | number, d: string | number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
/** 07/09/2026 · 3/09/2026 · 25/09/26 → ISO */
export function dmy(s: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || '').trim())
  if (!m) return null
  let y = +m[3]; if (y < 100) y += 2000
  return iso(y, m[2], m[1])
}
const r2 = (n: number) => Math.round(n * 100) / 100

// ───────── 1) PDF → 行(带 x 坐标) ─────────
/** pdfjsLib: pdfjs-dist 3.x；data: PDF 字节(会被 worker 接管，调用方传副本) */
export async function extractLines(pdfjsLib: any, data: Uint8Array): Promise<RawLine[]> {
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise
  const lines: RawLine[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const items = (tc.items as any[]).filter((i) => i.str && i.str.trim() !== '')
      .map((i) => ({ x: i.transform[4] as number, y: i.transform[5] as number, w: i.width as number, text: i.str as string }))
    const rows: { y: number; items: typeof items }[] = []
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    for (const it of items) {
      const r = rows.find((r) => Math.abs(r.y - it.y) <= 2.5)
      r ? r.items.push(it) : rows.push({ y: it.y, items: [it] })
    }
    rows.sort((a, b) => b.y - a.y)
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x)
      let text = '', prevEnd: number | null = null
      for (const it of r.items) {
        if (prevEnd != null && it.x - prevEnd > 0.05) text += ' '   // 相邻文本块一律加空格(Komsa 的 EAN 与货号间距为 0)
        text += it.text; prevEnd = it.x + it.w
      }
      text = text.replace(/\s+/g, ' ').trim()
      if (text) lines.push({ page: p, y: r.y, items: r.items, text })
    }
  }
  return lines
}

// ───────── 2) 各 KA 模板 ─────────
type Raw = { po: string | null; date: string | null; currency: string | null; delivery?: string | null; lines: ParsedLine[]; totals: NonNullable<Extract<ParsedPo, { checks: Check[] }>['totals']> }

function parseBigben(lines: RawLine[]): Raw {
  const o: Raw = { po: null, date: null, currency: null, lines: [], totals: {} }
  let cur: ParsedLine | null = null, codeX: number | null = null, eco = 0
  for (const L of lines) {
    const t = L.text
    if (/Code Produit/i.test(t)) { cur = null; continue }
    let m: RegExpExecArray | null
    if ((m = /COMMANDE\s*N\S*\s+(\d+)/i.exec(t))) { o.po = m[1]; const d = /(\d{2}\/\d{2}\/\d{4})/.exec(t); if (d) o.date = dmy(d[1]); continue }
    if (/Nombre total de pi/i.test(t)) { m = /:\s*([\d ]+)\s*$/.exec(t); if (m) o.totals.pieces = num(m[1]); cur = null; continue }
    if ((m = /Total HT\s+([\d ]+,\d{2})/i.exec(t))) { o.totals.net = num(m[1]); cur = null; continue }
    if ((m = /Total Eco Tax\s+([\d ]+,\d{2})/i.exec(t))) { o.totals.ecotax = num(m[1]); continue }
    if ((m = /Devise[^:]*:\s*([A-Z]{3})/.exec(t))) { o.currency = m[1]; continue }
    if (/^ECOTAXE/i.test(t)) { m = /MT\s*:\s*([\d.,]+)/.exec(t); if (m) eco += num(m[1]); continue }   // 生态税：不计入单价/净额
    // 明细行：每个单元格是独立文本块 → [货号][描述][数量][单价][海关编码][金额][日期][运输]
    const it = L.items.map((i) => i.text.trim())
    const hs = it.findIndex((x) => /^\d{10}$/.test(x))
    if (hs >= 4) {
      codeX = L.items[0].x
      cur = {
        raw_code: it[0], raw_desc: it.slice(1, hs - 2).join(' '),
        qty: num(it[hs - 2]), price: num(it[hs - 1]), net: num(it[hs + 1]),
        delivery: dmy(it[hs + 2]), extra: { hs_code: it[hs], transport: it[hs + 3] || null },
      }
      o.lines.push(cur); continue
    }
    if (cur && codeX != null && L.items[0].x > codeX + 20 && !/^(Commentaire|\*|Fax|Mode de)/i.test(t)) cur.raw_desc += ' ' + t   // 描述折行(如 "USB C Bk")
  }
  o.totals.ecotax_lines = r2(eco)
  return o
}

function parseICP(lines: RawLine[]): Raw {
  const o: Raw = { po: null, date: null, currency: 'EUR', lines: [], totals: {} }
  for (const L of lines) {
    const t = L.text; let m: RegExpExecArray | null
    if ((m = /Fecha:\s*(\d{2}\/\d{2}\/\d{4})/.exec(t))) o.date = dmy(m[1])
    if ((m = /N[º°o]\s*Pedido:?\s*(\S+)/.exec(t))) o.po = m[1]
    const tk = t.split(' ')
    if (/^\d{12,14}$/.test(tk[1] || '')) {                            // 明细行：第 2 列是 EAN
      const k = tk.filter((x) => x !== '€'), n = k.length
      o.lines.push({
        raw_code: k[3], raw_desc: k.slice(4, n - 3).join(' '), ean: k[1],
        qty: num(k[0]), price: num(k[n - 3]), net: num(k[n - 1]), delivery: null,
        extra: { icp_ref: k[2], promo: k[n - 2] },
      })
    } else if (o.lines.length && tk.length === 1 && /^[\d.]+,\d{2}€$/.test(tk[0])) o.totals.net = num(tk[0])
  }
  return o
}

function parseEsprinet(lines: RawLine[]): Raw {
  const o: Raw = { po: null, date: null, currency: null, lines: [], totals: {} }
  let cur: ParsedLine | null = null
  for (const L of lines) {
    const t = L.text; let m: RegExpExecArray | null
    if ((m = /PO NUMBER:\s*(\S+)/.exec(t))) o.po = m[1]
    if ((m = /PO DATE:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(t))) o.date = dmy(m[1])
    if ((m = /TOTAL ORDER\s+([\d.]+,\d{2})/.exec(t))) { o.totals.net = num(m[1]); cur = null; continue }
    const tk = t.split(' ')
    const d = tk.findIndex((x) => /^\d{1,2}\/\d{2}\/\d{4}$/.test(x))
    const c = d < 0 ? -1 : tk.findIndex((x, i) => i > d && /^[A-Z]{3}$/.test(x))
    if (d >= 4 && c > d) {
      const hasDisc = c - 1 - (d + 1) >= 2
      o.currency = tk[c]
      cur = {
        raw_code: tk[0], raw_desc: tk.slice(1, d - 3).join(' '), qty: num(tk[d - 1]),
        price: num(tk[c - 1]), net: num(tk[c + 1]), delivery: dmy(tk[d]),
        extra: { gross_price: num(tk[d + 1]), disc_pct: hasDisc ? num(tk[d + 2]) : 0, brand: tk[d - 3], um: tk[d - 2] },
      }
      o.lines.push(cur); continue
    }
    if (cur) { if (tk.length === 1 && tk[0] === cur.raw_code) continue; if (!/^(By accepting|Page|Campus)/i.test(t)) cur.raw_desc += ' ' + t }
  }
  return o
}

function parseKomsa(lines: RawLine[]): Raw {
  const o: Raw = { po: null, date: null, currency: null, lines: [], totals: {}, delivery: null }
  const seen = new Set<string>()
  for (const L of lines) {
    const t = L.text; let m: RegExpExecArray | null
    // 号码被拆成字符块：'D / 000048 / 2026/ 09'
    if (!o.po && (m = /\bNo\s*\.\s*([A-Z]{1,3})\s*\/\s*(\d+)\s*\/\s*(\d{4})\s*\/\s*(\d{2})/.exec(t))) o.po = `${m[1]}/${m[2]}/${m[3]}/${m[4]}`
    if (!o.date && (m = /Document date:\s*(\d{4}-\d{2}-\d{2})/.exec(t))) o.date = m[1]
    if (!o.delivery && (m = /Delivery date:\s*(\d{4}-\d{2}-\d{2})/.exec(t))) o.delivery = m[1]
    if (o.totals.net == null && (m = /Purchase order net amount:\s*(\d[\d ]*,\d{2})\s*([A-Z]{3})/.exec(t))) { o.totals.net = num(m[1]); o.currency = m[2] }
    if (o.totals.pieces == null && (m = /Sum of quantity:\s*([\d ]+)/.exec(t))) o.totals.pieces = num(m[1])
    m = /^(\d+)\s+(\d{13})\s+(\S+)\s+(.*?)\s+(\d[\d ]*?)\s+szt\.?\s+(\d[\d ]*,\d{2})\s+(\d[\d ]*,\d{2})\s+([A-Z]{3})\s*$/i.exec(t)
    if (m) {
      const key = m[1] + '|' + m[2]; if (seen.has(key)) continue; seen.add(key)
      o.currency = o.currency || m[8]
      o.lines.push({ raw_code: m[3], raw_desc: m[4], ean: m[2], qty: num(m[5]), price: num(m[6]), net: num(m[7]), delivery: null, extra: { line_no: +m[1] } })
    }
  }
  return o
}

export const TEMPLATES: { id: string; label: string; ka: string; country: string; test: (t: string) => boolean; parse: (l: RawLine[]) => Raw }[] = [
  { id: 'bigben', label: 'Bigben Connected', ka: 'Bigben', country: 'FR', test: (t) => /COMMANDE\s*N/.test(t) && /Bigben/i.test(t), parse: parseBigben },
  { id: 'icp', label: 'ICP (Información Control y Planificación)', ka: 'ICP', country: 'ES', test: (t) => /INFORMACI.N CONTROL Y PLANIFICACI.N/i.test(t) && /Pedido/.test(t), parse: parseICP },
  { id: 'esprinet', label: 'Esprinet Ibérica', ka: 'Esprinet', country: 'ES', test: (t) => /Esprinet/i.test(t) && /PURCHASE ORDER/.test(t), parse: parseEsprinet },
  { id: 'komsa', label: 'Komsa Polska', ka: 'Komsa', country: 'PL', test: (t) => /KOMSA POLSKA/i.test(t) && /Purchase Order/i.test(t), parse: parseKomsa },
]

// ───────── 3) 自校验 ─────────
function runChecks(o: Raw): Check[] {
  const c: Check[] = []
  const add = (ok: boolean, label: string, detail: string) => c.push({ ok, label, detail })
  add(!!o.po, '识别到 PO 号', o.po || '未找到')
  add(!!o.date, '识别到 PO 日期', o.date || '未找到')
  add(o.lines.length > 0, '识别到明细行', o.lines.length + ' 行')
  const bad = o.lines.filter((l) => !(l.qty > 0) || isNaN(l.price) || isNaN(l.net) || Math.abs(l.qty * l.price - l.net) > 0.02 + l.net * 0.0001)
  add(bad.length === 0, '每行 数量×单价 = 行金额', bad.length ? bad.length + ' 行不一致：' + bad.map((l) => l.raw_code).join(', ') : '全部一致')
  const sum = r2(o.lines.reduce((s, l) => s + (l.net || 0), 0))
  if (o.totals.net != null) add(Math.abs(sum - o.totals.net) < 0.02, '明细合计 = PO 总额', `${sum.toFixed(2)} vs ${o.totals.net.toFixed(2)}`)
  else add(false, '明细合计 = PO 总额', '未找到 PO 总额')
  if (o.totals.pieces != null) { const q = o.lines.reduce((s, l) => s + l.qty, 0); add(q === o.totals.pieces, '数量合计 = PO 总件数', `${q} vs ${o.totals.pieces}`) }
  if (o.totals.ecotax != null) add(Math.abs(o.totals.ecotax - (o.totals.ecotax_lines || 0)) < 0.02, '生态税已剔除(不计入单价/净额)', `Ecotax ${o.totals.ecotax}`)
  return c
}

export function parsePo(lines: RawLine[]): ParsedPo {
  const full = lines.map((l) => l.text).join('\n')
  const tpl = TEMPLATES.find((t) => t.test(full))
  if (!tpl) return { template: null, raw: full }
  const o = tpl.parse(lines)
  const checks = runChecks(o)
  return { ...o, template: tpl.id, template_label: tpl.label, ka_hint: tpl.ka, country: tpl.country, checks, ok: checks.every((x) => x.ok) }
}

// ───────── 4) 货号映射(不许猜)：确定 / 建议待确认 / 未匹配 ─────────
export type SkuDict = { skus: { code: string; name: string; ean?: string | null }[]; alias: Record<string, string> }   // alias: lower(trim(raw)) → sku code
export type SkuMatch = { sku: string | null; status: 'ok' | 'suggest' | 'none'; how: string; cands: string[] }

const normHyphen = (s: string) => String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '-')
const COLOR_RULES: [RegExp, string][] = [   // 顺序敏感：先具体后泛化
  [/light[\s-]*bl|\blb\b|bleu clair|azul claro/i, 'LB'],
  [/desert/i, 'DesertTitan'],
  [/titan/i, 'Titan'],
  [/\bblack\b|\bnoir\b|\bbk\b|\bnegro\b|czarn/i, 'Black'],
  [/\bblue\b|\bbleu\b|\bbu\b|\bazul\b/i, 'Blue'],
  [/\borange\b|naranja|pomara/i, 'Orange'],
  [/\bred\b|cherry|rouge|rojo/i, 'Red'],
  [/\bwhite\b|\bblanc\b|blanco/i, 'White'],
  [/\bsilver\b|\bargent\b|plata/i, 'Silver'],
]
const COLOR_SET = new Set(['black', 'blue', 'orange', 'lb', 'red', 'deserttitan', 'titan', 'white', 'silver', 'green', 'purple', 'pink'])
const colorOf = (txt: string): string | null => { for (const [re, c] of COLOR_RULES) if (re.test(txt)) return c; return null }

export function resolveSku(line: Pick<ParsedLine, 'raw_code' | 'raw_desc' | 'ean'>, dict: SkuDict): SkuMatch {
  const skus = dict.skus
  const byCode = new Map(skus.map((s) => [s.code.toLowerCase(), s]))
  const rawLT = String(line.raw_code || '').trim().toLowerCase()      // sku_alias.alias_norm = lower(trim(raw))
  const rawN = normHyphen(line.raw_code)
  // ① EAN 精确
  if (line.ean) { const hit = skus.filter((s) => s.ean && s.ean === line.ean); if (hit.length === 1) return { sku: hit[0].code, status: 'ok', how: 'EAN 精确匹配', cands: [hit[0].code] } }
  // ② sku_alias
  const al = dict.alias[rawLT] ?? dict.alias[rawN]
  if (al) return { sku: al, status: 'ok', how: 'sku_alias 别名', cands: [al] }
  // ③ 货号精确(忽略大小写 / 空格→连字符)
  const ex = byCode.get(rawN) ?? byCode.get(rawLT)
  if (ex) return { sku: ex.code, status: 'ok', how: '货号精确匹配', cands: [ex.code] }
  // ④ 变体：同型号下用 货号后缀 / 描述 里的明确颜色词挑变体 —— 只给「建议」，须人工确认
  const bases = new Map<string, string[]>()
  for (const s of skus) {
    const parts = s.code.split('-'); const last = parts[parts.length - 1].toLowerCase()
    const base = (parts.length > 1 && COLOR_SET.has(last)) ? parts.slice(0, -1).join('-').toLowerCase() : s.code.toLowerCase()
    const arr = bases.get(base) ?? []; arr.push(s.code); bases.set(base, arr)
  }
  let base: string | null = null
  for (const b of Array.from(bases.keys())) if ((rawN === b || rawN.startsWith(b + '-')) && (!base || b.length > base.length)) base = b
  if (base) {
    const cands = bases.get(base)!
    const rest = rawN.slice(base.length + 1).replace(/-/g, ' ')
    const fromCode = rest === 'o' ? 'Orange' : colorOf(rest)
    const color = fromCode || colorOf(line.raw_desc || '')
    const pick = color ? cands.find((c) => c.split('-').pop()!.toLowerCase() === color.toLowerCase()) : null
    if (pick) return { sku: pick, status: 'suggest', how: `型号 ${base.toUpperCase()} + 颜色「${color}」(来自${fromCode ? '货号' : '描述'})`, cands }
    if (cands.length === 1) return { sku: cands[0], status: 'suggest', how: `型号 ${base.toUpperCase()} 仅 1 个变体，未写颜色`, cands }
    return { sku: null, status: 'none', how: `型号 ${base.toUpperCase()} 有 ${cands.length} 个颜色变体，PO 未写明颜色`, cands }
  }
  return { sku: null, status: 'none', how: '字典里找不到该货号', cands: [] }
}
