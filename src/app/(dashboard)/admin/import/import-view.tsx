'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { fmtNum } from '@/lib/utils'

type Sku = { id: number; code: string; name: string }
type Ka = { id: number; name: string; country_id: number; parent_distributor: string | null }
type Country = { id: number; code: string; name_en: string; name_zh: string }

// 目标字段定义（数据库列）
const TARGET_FIELDS = [
  { key: 'effective_date', label: 'Effective Date', required: true,  hint: 'YYYY-MM-DD or Excel date' },
  { key: 'sku_code',       label: 'SKU code',       required: true,  hint: 'Match SKU.code' },
  { key: 'country_code',   label: 'Country code',   required: true,  hint: 'FR / PL / ES / NL / DE / SE / GB' },
  { key: 'ka_name',        label: 'KA / Account',   required: false, hint: 'Account name (matches ka.name)' },
  { key: 'qty',            label: 'Qty',            required: true,  hint: 'Integer' },
  { key: 'po_number',      label: 'PO number',      required: false, hint: 'Used in dedup key' },
  { key: 'out_order_number', label: 'Out order #',  required: false, hint: 'WMS出库单号' },
  { key: 'tracking_number',  label: 'Tracking #',   required: false, hint: '快递单号' },
  { key: 'ship_date',      label: 'Ship date',      required: false, hint: 'Planned shipping date' },
  { key: 'plan_date',      label: 'Plan date',      required: false, hint: 'Plan date' },
  { key: 'delivery_date',  label: 'Delivery date',  required: false, hint: 'Arrival date' },
  { key: 'logistics_carrier', label: 'Carrier',     required: false, hint: '物流商' },
  { key: 'logistics_channel', label: 'Channel',     required: false, hint: '运输方式 (sea/air/land)' },
  { key: 'source_type',    label: 'Source type',    required: false, hint: 'channel | internal_replenish (default channel)' },
  { key: 'internal_customer_name', label: 'Internal customer', required: false, hint: 'For internal restock only' },
  { key: 'status',         label: 'Status',         required: false, hint: 'shipped | planned | delivered (default shipped)' },
  { key: 'notes',          label: 'Notes',          required: false, hint: 'Free text' },
] as const

type TargetKey = typeof TARGET_FIELDS[number]['key']
type Mapping = Partial<Record<TargetKey, string>>  // target → excel column header

type ParsedRow = Record<string, any>
type RowStatus = 'ok' | 'warn' | 'error' | 'skipped'   // skipped = 预期跳过（美国/美规等）
type NormalizedRow = {
  source_row: number
  raw: ParsedRow
  effective_date?: string
  ship_date?: string | null
  plan_date?: string | null
  delivery_date?: string | null
  sku_id?: number
  sku_code_raw?: string
  sku_resolved_from?: string       // 实际解析到的 SKU.code（剥后缀后）
  ka_id?: number | null
  ka_name_raw?: string | null
  country_id?: number
  country_code_raw?: string
  country_resolved_from?: string   // 怎么推断出来的（如 "by KA Bigben"）
  qty?: number
  po_number?: string | null
  out_order_number?: string | null
  tracking_number?: string | null
  logistics_carrier?: string | null
  logistics_channel?: string | null
  source_type?: string
  internal_customer_name?: string | null
  status?: string
  notes?: string | null
  errors: string[]
  warnings: string[]
  skipReason?: string             // 非 null → 这行被预期跳过
}

// 已知"非业务"后缀（合并到不带后缀的 SKU code）
const STRIPPABLE_SUFFIXES = ['-欧规', '-2P-欧规', '-2P', '-非外挂线', '-EU', '-eu']
// 标记为"非业务地区"的后缀（行直接 skip）
const US_SUFFIXES = ['-美规', '-US', '-us']

const STORAGE_KEY = 'iniu-erp-import-mapping-shipment'

export function ImportView({
  skus, kas, countries, adminName,
}: {
  skus: Sku[]
  kas: Ka[]
  countries: Country[]
  adminName: string
}) {
  const router = useRouter()
  const supabase = useRef(createClient()).current
  const fileInputRef = useRef<HTMLInputElement>(null)

  // —— Step 1: 文件上传 + 解析 ——
  const [fileName, setFileName] = useState<string>('')
  const [sheetInfo, setSheetInfo] = useState<{ name: string; rowCount: number; isHidden: boolean }[]>([])
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [rawData, setRawData] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string>('')
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)

  // —— Step 2: 列名映射 ——
  const [mapping, setMapping] = useState<Mapping>(() => {
    // 从 localStorage 加载上次的映射
    if (typeof window === 'undefined') return {}
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })

  const saveMapping = useCallback((m: Mapping) => {
    setMapping(m)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)) } catch {}
  }, [])

  // 自动猜测映射（启发式匹配）
  const autoGuessMapping = useCallback((headers: string[]) => {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_\-\/]+/g, '')
    const findCol = (...keywords: string[]) => {
      for (const kw of keywords) {
        const hit = headers.find(h => norm(h).includes(norm(kw)))
        if (hit) return hit
      }
      return undefined
    }
    const guess: Mapping = {
      effective_date:   findCol('生效', '生效日', 'effective', 'date', '日期'),
      sku_code:         findCol('sku', '型号', 'model', '产品代码', 'code'),
      country_code:     findCol('国家', 'country'),
      ka_name:          findCol('客户', 'ka', 'account', '渠道'),
      qty:              findCol('数量', 'qty', 'quantity', '发货数量'),
      po_number:        findCol('po', 'order'),
      out_order_number: findCol('出库单', 'outorder', 'wms'),
      tracking_number:  findCol('tracking', '快递单号', '运单'),
      ship_date:        findCol('发货日', 'ship'),
      plan_date:        findCol('计划日', 'plan'),
      delivery_date:    findCol('到货', 'delivery', 'arrival'),
      logistics_carrier: findCol('物流商', 'carrier'),
      logistics_channel: findCol('运输方式', 'channel', '物流渠道'),
      source_type:      findCol('source', '来源'),
      internal_customer_name: findCol('内部客户', 'internal'),
      status:           findCol('状态', 'status'),
      notes:            findCol('备注', 'note', 'remark'),
    }
    // 删掉 undefined
    Object.keys(guess).forEach(k => { if (!guess[k as TargetKey]) delete guess[k as TargetKey] })
    return guess
  }, [])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')
    setRawData([])
    setRawHeaders([])

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true, bookVBA: true })
        setWorkbook(wb)
        // 计算每个 sheet 的行数 + 是否隐藏（Hidden=1 隐藏；Hidden=2 极度隐藏）
        const hiddenByName: Record<string, boolean> = {}
        ;(wb.Workbook?.Sheets ?? []).forEach((s: any) => {
          if (s.name) hiddenByName[s.name] = (s.Hidden ?? 0) > 0
        })
        const info = wb.SheetNames.map(name => {
          const ws = wb.Sheets[name]
          // 用 sheet_to_json header:1 拿原始行数（包含表头那一行）
          const rows = ws ? XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) : []
          // 数据行 = 总行数 - 1（表头）
          const dataRowCount = Math.max(0, rows.length - 1)
          return { name, rowCount: dataRowCount, isHidden: hiddenByName[name] ?? false }
        })
        setSheetInfo(info)
        // 选第一个非隐藏且有数据的 sheet；都没有就选第一个
        const firstVisibleWithData = info.find(s => !s.isHidden && s.rowCount > 0)
        const pick = firstVisibleWithData?.name ?? wb.SheetNames[0]
        if (pick) loadSheet(wb, pick)
      } catch (err: any) {
        setParseError(`Failed to parse Excel: ${err.message}`)
      }
    }
    reader.onerror = () => setParseError('Failed to read file')
    reader.readAsArrayBuffer(file)
  }

  const loadSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    setActiveSheet(sheetName)
    const ws = wb.Sheets[sheetName]
    if (!ws) return
    // 用 header: 1 拿表头，再用对象模式拿数据
    const headerRows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
    if (headerRows.length === 0) {
      setRawHeaders([])
      setRawData([])
      return
    }
    const headers = (headerRows[0] as any[]).map(h => String(h ?? '').trim()).filter(Boolean)
    const rows = XLSX.utils.sheet_to_json<ParsedRow>(ws, { defval: '', raw: false })
    setRawHeaders(headers)
    setRawData(rows)

    // 自动猜测映射
    const existing = Object.keys(mapping).length > 0 ? mapping : {}
    const stillValid: Mapping = {}
    Object.entries(existing).forEach(([k, v]) => {
      if (v && headers.includes(v)) stillValid[k as TargetKey] = v
    })
    const guess = autoGuessMapping(headers)
    saveMapping({ ...guess, ...stillValid })  // 已存在的映射优先
  }

  // —— Step 3: 规范化 + 校验 ——
  const skuByCode = useMemo(() => {
    const m: Record<string, Sku> = {}
    skus.forEach(s => { m[s.code.toUpperCase()] = s })
    return m
  }, [skus])

  // Country lookup：支持 code（FR） / name_en（France） / name_zh（法国）
  const countryByAny = useMemo(() => {
    const m: Record<string, Country> = {}
    countries.forEach(c => {
      m[c.code.toUpperCase()] = c
      m[c.name_en.toLowerCase()] = c
      m[c.name_zh] = c   // 中文不要 lower-case
    })
    return m
  }, [countries])

  const kaByName = useMemo(() => {
    const m: Record<string, Ka> = {}
    kas.forEach(k => { m[k.name.toLowerCase()] = k })
    return m
  }, [kas])

  // 智能 SKU 匹配：精确 → 去欧规后缀 → 美规则 skip → 失败
  // 返回 { sku: Sku | null, resolvedFrom: string | null, shouldSkip: boolean }
  const resolveSku = (raw: string): { sku: Sku | null; resolvedFrom: string | null; shouldSkip: boolean } => {
    const upper = raw.toUpperCase()
    // 1. 精确匹配
    if (skuByCode[upper]) return { sku: skuByCode[upper], resolvedFrom: null, shouldSkip: false }
    // 2. 美规 → skip
    if (US_SUFFIXES.some(suf => raw.endsWith(suf) || raw.toUpperCase().endsWith(suf.toUpperCase()))) {
      return { sku: null, resolvedFrom: null, shouldSkip: true }
    }
    // 3. 剥欧规等后缀
    for (const suf of STRIPPABLE_SUFFIXES) {
      if (raw.endsWith(suf) || raw.toUpperCase().endsWith(suf.toUpperCase())) {
        const stripped = raw.slice(0, raw.length - suf.length).toUpperCase()
        if (skuByCode[stripped]) {
          return { sku: skuByCode[stripped], resolvedFrom: `${raw} → ${stripped}`, shouldSkip: false }
        }
      }
    }
    return { sku: null, resolvedFrom: null, shouldSkip: false }
  }

  // 智能 Country 匹配：直接 / 通过 KA 反推 / 美国 skip / 欧洲 fallback to KA
  const resolveCountry = (raw: string, ka: Ka | null): { country: Country | null; resolvedFrom: string | null; shouldSkip: boolean } => {
    const trimmed = raw.trim()
    // 1. 美国 / US → skip
    if (/^美国$|^US$|^USA$|^united\s*states$/i.test(trimmed)) {
      return { country: null, resolvedFrom: null, shouldSkip: true }
    }
    // 2. 直接匹配（FR / France / 法国）
    const direct = countryByAny[trimmed.toUpperCase()] ?? countryByAny[trimmed.toLowerCase()] ?? countryByAny[trimmed]
    if (direct) return { country: direct, resolvedFrom: null, shouldSkip: false }
    // 3. "欧洲" 笼统 → 通过 KA 反推
    if (/^欧洲$|^EU$|^europe$/i.test(trimmed) && ka) {
      const inferred = countries.find(c => c.id === ka.country_id) ?? null
      if (inferred) return { country: inferred, resolvedFrom: `via KA "${ka.name}"`, shouldSkip: false }
    }
    return { country: null, resolvedFrom: null, shouldSkip: false }
  }

  const parseDate = (v: any): string | null => {
    if (v === null || v === undefined || v === '') return null
    if (v instanceof Date) {
      const y = v.getFullYear(), mo = v.getMonth() + 1, d = v.getDate()
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    }
    const s = String(v).trim()
    // YYYY-MM-DD or YYYY/MM/DD
    const m = s.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/)
    if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`
    return null
  }

  const normalizedRows: NormalizedRow[] = useMemo(() => {
    if (rawData.length === 0) return []
    const get = (row: ParsedRow, key: TargetKey): any => {
      const col = mapping[key]
      if (!col) return undefined
      return row[col]
    }
    const out: NormalizedRow[] = []
    // 用于按 natural key 聚合
    const aggMap = new Map<string, NormalizedRow>()

    rawData.forEach((row, idx) => {
      const errors: string[] = []
      const warnings: string[] = []
      let skipReason: string | undefined

      const effDate = parseDate(get(row, 'effective_date'))
      const skuCodeRaw = String(get(row, 'sku_code') ?? '').trim()
      const countryCodeRaw = String(get(row, 'country_code') ?? '').trim()
      const kaNameRaw = String(get(row, 'ka_name') ?? '').trim()

      // —— KA 匹配（先做，因为 country 推断要用到）——
      const ka = kaNameRaw ? kaByName[kaNameRaw.toLowerCase()] : null

      // —— SKU 智能匹配 ——
      let sku: Sku | null = null
      let skuResolvedFrom: string | null = null
      if (skuCodeRaw) {
        const r = resolveSku(skuCodeRaw)
        if (r.shouldSkip) {
          skipReason = `US-spec SKU (${skuCodeRaw})`
        } else if (r.sku) {
          sku = r.sku
          skuResolvedFrom = r.resolvedFrom
        }
      }

      // —— Country 智能匹配 ——
      let country: Country | null = null
      let countryResolvedFrom: string | null = null
      if (countryCodeRaw && !skipReason) {
        const r = resolveCountry(countryCodeRaw, ka ?? null)
        if (r.shouldSkip) {
          skipReason = `Non-EMEA country (${countryCodeRaw})`
        } else if (r.country) {
          country = r.country
          countryResolvedFrom = r.resolvedFrom
        }
      }

      // 真错误（仅在没有 skip 时才报错）
      if (!skipReason) {
        if (!effDate) errors.push('Effective date missing/invalid')
        if (!skuCodeRaw) errors.push('SKU code missing')
        else if (!sku) errors.push(`SKU "${skuCodeRaw}" not found in master data`)
        if (!countryCodeRaw) errors.push('Country code missing')
        else if (!country) errors.push(`Country "${countryCodeRaw}" cannot be resolved`)

        if (ka && country && ka.country_id !== country.id) {
          warnings.push(`KA "${kaNameRaw}" belongs to a different country than "${countryCodeRaw}"`)
        }
        if (kaNameRaw && !ka) {
          warnings.push(`KA "${kaNameRaw}" not in master — will save with NULL ka_id`)
        }
      }

      const qtyRaw = get(row, 'qty')
      const qty = qtyRaw === '' || qtyRaw === null || qtyRaw === undefined ? NaN : Number(qtyRaw)
      if (!skipReason) {
        if (isNaN(qty)) errors.push('Qty invalid')
        else if (qty < 0) errors.push('Qty cannot be negative')
        else if (qty === 0) warnings.push('Qty is zero')
      }

      const nr: NormalizedRow = {
        source_row: idx + 2,
        raw: row,
        effective_date: effDate ?? undefined,
        ship_date: parseDate(get(row, 'ship_date')),
        plan_date: parseDate(get(row, 'plan_date')),
        delivery_date: parseDate(get(row, 'delivery_date')),
        sku_id: sku?.id,
        sku_code_raw: skuCodeRaw,
        sku_resolved_from: skuResolvedFrom ?? undefined,
        ka_id: ka?.id ?? null,
        ka_name_raw: kaNameRaw || null,
        country_id: country?.id,
        country_code_raw: countryCodeRaw,
        country_resolved_from: countryResolvedFrom ?? undefined,
        qty: isNaN(qty) ? undefined : Math.round(qty),
        po_number: String(get(row, 'po_number') ?? '').trim() || null,
        out_order_number: String(get(row, 'out_order_number') ?? '').trim() || null,
        tracking_number: String(get(row, 'tracking_number') ?? '').trim() || null,
        logistics_carrier: String(get(row, 'logistics_carrier') ?? '').trim() || null,
        logistics_channel: String(get(row, 'logistics_channel') ?? '').trim() || null,
        source_type: String(get(row, 'source_type') ?? 'channel').trim() || 'channel',
        internal_customer_name: String(get(row, 'internal_customer_name') ?? '').trim() || null,
        status: String(get(row, 'status') ?? 'shipped').trim() || 'shipped',
        notes: String(get(row, 'notes') ?? '').trim() || null,
        errors,
        warnings,
        skipReason,
      }

      // 只有 ok / warn 行参与聚合上传；error / skipped 不参与
      if (!skipReason && errors.length === 0 && effDate && sku && country) {
        const key = `${effDate}|${sku.id}|${nr.ka_id ?? 0}|${nr.po_number ?? ''}|${nr.source_type}`
        const existing = aggMap.get(key)
        if (existing) {
          existing.qty = (existing.qty ?? 0) + (nr.qty ?? 0)
          if (nr.notes) existing.notes = [existing.notes, nr.notes].filter(Boolean).join(' | ')
          existing.warnings.push(`merged with row ${nr.source_row}`)
        } else {
          aggMap.set(key, nr)
        }
      }
      out.push(nr)
    })

    return out
  }, [rawData, mapping, skuByCode, countryByAny, kaByName, skus, countries, kas])

  // 准备写库的行（聚合后 + 无错误 + 非 skipped）
  const rowsToUpsert = useMemo(() => {
    const aggMap = new Map<string, NormalizedRow>()
    normalizedRows.forEach(r => {
      if (r.skipReason || r.errors.length > 0) return
      const key = `${r.effective_date}|${r.sku_id}|${r.ka_id ?? 0}|${r.po_number ?? ''}|${r.source_type}`
      const existing = aggMap.get(key)
      if (existing) {
        existing.qty = (existing.qty ?? 0) + (r.qty ?? 0)
        if (r.notes) existing.notes = [existing.notes, r.notes].filter(Boolean).join(' | ')
      } else {
        aggMap.set(key, { ...r })
      }
    })
    return Array.from(aggMap.values())
  }, [normalizedRows])

  const skippedCount = normalizedRows.filter(r => r.skipReason).length
  const errorCount = normalizedRows.filter(r => !r.skipReason && r.errors.length > 0).length
  const warningCount = normalizedRows.filter(r => !r.skipReason && r.errors.length === 0 && r.warnings.length > 0).length

  // —— Step 4: 写库 ——
  const [importing, setImporting] = useState(false)
  type Toast = { kind: 'success' | 'error' | 'info'; msg: string } | null
  const [toast, setToast] = useState<Toast>(null)

  const handleImport = async () => {
    if (rowsToUpsert.length === 0) { setToast({ kind: 'error', msg: 'No valid rows to import' }); return }
    if (!window.confirm(`Import ${rowsToUpsert.length} rows from "${fileName}"?\nRows with errors will be skipped.`)) return
    setImporting(true)
    const payload = rowsToUpsert.map(r => ({
      effective_date: r.effective_date,
      ship_date: r.ship_date,
      plan_date: r.plan_date,
      delivery_date: r.delivery_date,
      sku_id: r.sku_id,
      country_id: r.country_id,
      ka_id: r.ka_id,
      qty: r.qty,
      po_number: r.po_number,
      out_order_number: r.out_order_number,
      tracking_number: r.tracking_number,
      logistics_carrier: r.logistics_carrier,
      logistics_channel: r.logistics_channel,
      source_type: r.source_type,
      internal_customer_name: r.internal_customer_name,
      status: r.status,
      notes: r.notes,
      source_row: r.source_row,
    }))
    const { data, error } = await supabase.rpc('bulk_upsert_shipments', {
      p_file_name: fileName,
      p_rows: payload,
    })
    setImporting(false)
    if (error) {
      setToast({ kind: 'error', msg: `Import failed: ${error.message}` })
      return
    }
    const r = data as any
    setToast({ kind: 'success', msg: `✓ Imported: ${r.new} new, ${r.updated} updated, ${r.errors} errors (batch #${r.batch_id})` })
    // 重置
    setFileName(''); setRawData([]); setRawHeaders([]); setWorkbook(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    router.refresh()
  }

  const resetMapping = () => {
    saveMapping({})
    if (rawHeaders.length > 0) saveMapping(autoGuessMapping(rawHeaders))
  }

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className={`pointer-events-auto px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium border ${
            toast.kind === 'success' ? 'bg-green-50 text-green-700 border-green-300' :
            toast.kind === 'error'   ? 'bg-red-50 text-red-700 border-red-300' :
                                       'bg-blue-50 text-blue-700 border-blue-300'
          }`}>
            {toast.msg}
            <button onClick={() => setToast(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      )}

      <h1 className="text-2xl font-bold text-gray-900 mb-1">📥 Import shipment data</h1>
      <p className="text-sm text-gray-500 mb-5">
        Upload weekly shipment Excel from supply chain · 全量 upsert by <code className="bg-gray-100 px-1 rounded">(date, sku, ka, po, source)</code> ·
        Signed in as <span className="text-purple-600 font-medium">{adminName}</span>
      </p>

      {/* Step 1: 上传 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">Step 1 · Upload Excel</div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xls,.xlsx,.csv"
            onChange={handleFile}
            className="text-sm"
          />
          {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
        </div>

        {/* Sheet selector: 多 sheet 文件常见，始终显示让用户确认选的是对的 */}
        {sheetInfo.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-gray-600 mb-2">
              Pick the sheet with shipment data
              {sheetInfo.length > 1 && <span className="text-gray-400"> · {sheetInfo.length} sheets found</span>}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {sheetInfo.map(s => {
                const isActive = s.name === activeSheet
                return (
                  <button
                    key={s.name}
                    onClick={() => workbook && loadSheet(workbook, s.name)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                      isActive
                        ? 'bg-blue-600 text-white border-blue-600 shadow'
                        : s.rowCount === 0
                          ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                    }`}
                    disabled={s.rowCount === 0 && !isActive}
                    title={s.isHidden ? 'This sheet is hidden in Excel' : ''}
                  >
                    {s.isHidden && <span title="hidden" className="opacity-50">👁️‍🗨️</span>}
                    <span>{s.name}</span>
                    <span className={`tabular-nums ${isActive ? 'text-blue-200' : 'text-gray-400'}`}>
                      ({fmtNum(s.rowCount)} {s.rowCount === 1 ? 'row' : 'rows'})
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {parseError && <div className="mt-2 text-sm text-red-600">{parseError}</div>}
      </div>

      {/* Step 2: 列映射 */}
      {rawHeaders.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm font-semibold text-gray-700">Step 2 · Map columns</div>
            <button onClick={resetMapping} className="text-xs text-gray-500 underline hover:text-gray-700">
              Reset to auto-guess
            </button>
          </div>
          <div className="text-xs text-gray-500 mb-3">
            For each database field below, pick the matching column from your Excel. Your choices are saved for next time.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {TARGET_FIELDS.map(f => {
              const mapped = mapping[f.key]
              const isError = f.required && !mapped
              return (
                <div key={f.key} className={`flex items-center gap-2 p-2 rounded border ${isError ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-700">
                      {f.label}
                      {f.required && <span className="text-red-500 ml-1">*</span>}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">{f.hint}</div>
                  </div>
                  <select
                    value={mapped ?? ''}
                    onChange={(e) => saveMapping({ ...mapping, [f.key]: e.target.value || undefined })}
                    className="text-xs border border-gray-300 rounded px-1.5 py-1 max-w-[180px]"
                  >
                    <option value="">— skip —</option>
                    {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Step 3: 预览 + 校验 */}
      {normalizedRows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm font-semibold text-gray-700">Step 3 · Preview & validate</div>
            <div className="flex gap-3 text-xs flex-wrap">
              <span>📊 Total: <strong>{fmtNum(normalizedRows.length)}</strong></span>
              <span className="text-green-600">✓ Ready: <strong>{fmtNum(rowsToUpsert.length)}</strong></span>
              {warningCount > 0 && <span className="text-amber-600">⚠ Warnings: <strong>{fmtNum(warningCount)}</strong></span>}
              {skippedCount > 0 && <span className="text-gray-500">⏭ Skipped (non-EMEA): <strong>{fmtNum(skippedCount)}</strong></span>}
              {errorCount > 0 && <span className="text-red-600">⛔ Errors: <strong>{fmtNum(errorCount)}</strong></span>}
            </div>
          </div>
          <div className="overflow-auto max-h-[400px] border border-gray-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Row</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Date</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600">SKU</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Country</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600">KA</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Qty</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600">PO</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {normalizedRows.slice(0, 200).map((r, i) => {
                  const status: RowStatus =
                    r.skipReason ? 'skipped'
                    : r.errors.length > 0 ? 'error'
                    : r.warnings.length > 0 ? 'warn'
                    : 'ok'
                  const bgClass =
                    status === 'error' ? 'bg-red-50'
                    : status === 'warn' ? 'bg-amber-50'
                    : status === 'skipped' ? 'bg-gray-50 opacity-60'
                    : ''
                  const tooltip = [...(r.skipReason ? [r.skipReason] : []), ...r.errors, ...r.warnings].join('\n')
                  return (
                    <tr key={i} className={bgClass} title={tooltip}>
                      <td className="px-2 py-1 font-mono text-gray-400">#{r.source_row}</td>
                      <td className="px-2 py-1">{r.effective_date ?? <span className="text-red-500">—</span>}</td>
                      <td className="px-2 py-1 font-mono">
                        {r.sku_code_raw}
                        {r.sku_id && (r.sku_resolved_from
                          ? <span className="text-blue-600 ml-0.5" title={r.sku_resolved_from}>↪</span>
                          : <span className="text-green-600 ml-0.5">✓</span>
                        )}
                        {!r.sku_id && !r.skipReason && <span className="text-red-500 ml-0.5">✗</span>}
                      </td>
                      <td className="px-2 py-1">
                        {r.country_code_raw}
                        {r.country_id && (r.country_resolved_from
                          ? <span className="text-blue-600 ml-0.5" title={r.country_resolved_from}>↪</span>
                          : <span className="text-green-600 ml-0.5">✓</span>
                        )}
                        {!r.country_id && !r.skipReason && <span className="text-red-500 ml-0.5">✗</span>}
                      </td>
                      <td className="px-2 py-1">{r.ka_name_raw || <span className="text-gray-400">—</span>}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.qty ?? <span className="text-red-500">?</span>}</td>
                      <td className="px-2 py-1 text-gray-500">{r.po_number || '—'}</td>
                      <td className="px-2 py-1">
                        {status === 'skipped' && <span className="text-gray-500">⏭ {r.skipReason}</span>}
                        {status === 'error' && <span className="text-red-700">⛔ {r.errors[0]}</span>}
                        {status === 'warn' && <span className="text-amber-700">⚠ {r.warnings[0]}</span>}
                        {status === 'ok' && <span className="text-green-700">✓</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {normalizedRows.length > 200 && (
            <div className="mt-2 text-xs text-gray-500">Showing first 200 rows · all {normalizedRows.length} will be processed on import</div>
          )}
        </div>
      )}

      {/* Step 4: 写库 */}
      {rowsToUpsert.length > 0 && (
        <div className="bg-white border-2 border-blue-300 rounded-xl p-5 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Step 4 · Import to database</div>
            <div className="text-xs text-gray-500 mt-1">
              Will upsert <strong className="text-blue-600">{fmtNum(rowsToUpsert.length)}</strong> aggregated rows.
              Existing rows (same {`{date, sku, ka, po, source}`}) will be <strong>updated</strong>;
              new combinations will be <strong>inserted</strong>.
              {errorCount > 0 && <> {errorCount} error rows will be skipped.</>}
            </div>
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className="px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? 'Importing...' : `💾 Import ${fmtNum(rowsToUpsert.length)} rows`}
          </button>
        </div>
      )}

      <div className="mt-6 text-xs text-gray-400">
        💡 Tip: After import, check "🕒 Import History" in the sidebar to view all batches or roll back the last one.
      </div>
    </div>
  )
}
