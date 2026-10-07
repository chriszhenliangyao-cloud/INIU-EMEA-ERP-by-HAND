'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import type { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils'
import { extractLines, parsePo, resolveSku, TEMPLATES, type ParsedPo, type SkuMatch } from '@/lib/po-parse'
import type { SkuOpt, CountryOpt, KaOpt } from './po-shipment-view'

/**
 * Add PO（上传 PO 的 PDF → 按 KA 模板规则解析 → 核对 → 写入 channel_po）。
 * 解析在浏览器里完成（pdf.js），PDF 不经过任何第三方服务；无 AI。解析/映射规则见 src/lib/po-parse.ts。
 * 写入口径与「Add PO manually」一致：一行 SKU 一条 channel_po，po_status 走列默认 'new' → 落 New PO 等 Confirm；
 * turnover = 行净额(Ecotaxe/TVA 不计入)；source_file = PDF 文件名；原件自动挂到 📎「PO 原件」。
 */

type Parsed = Extract<ParsedPo, { checks: unknown }>
export type SkuAlias = { alias_norm: string; sku_id: number }

const BUCKET = 'po-docs'
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
const CCY = (v: number, ccy: string | null) => (ccy === 'PLN' ? 'zł ' : '€') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PRICE = (v: number, ccy: string | null) => (ccy === 'PLN' ? 'zł ' : '€') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const r2 = (n: number) => Math.round(n * 100) / 100

async function loadPdfjs(): Promise<any> {
  const m: any = await import('pdfjs-dist')
  const lib = m.default?.getDocument ? m.default : m
  lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'   // public/ 下的同版本 worker(pdfjs-dist 3.11.174)
  return lib
}

export function ImportPoModal({ today, skus, skuAlias, countries, kas, supabase, onClose, onDone }: {
  today: string; skus: SkuOpt[]; skuAlias: SkuAlias[]; countries: CountryOpt[]; kas: KaOpt[]
  supabase: ReturnType<typeof createClient>; onClose: () => void; onDone: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [unknownRaw, setUnknownRaw] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [match, setMatch] = useState<SkuMatch[]>([])
  const [pick, setPick] = useState<(number | null)[]>([])      // 每行选中的 sku_id
  const [conf, setConf] = useState<boolean[]>([])              // 每行是否已确认
  const [countryId, setCountryId] = useState<number | ''>('')
  const [kaId, setKaId] = useState<number | ''>('')
  const [poNumber, setPoNumber] = useState('')
  const [poDate, setPoDate] = useState(today)
  const [override, setOverride] = useState(false)
  const [saving, setSaving] = useState(false)

  const skuById = useMemo(() => new Map(skus.map(s => [s.id, s])), [skus])
  const skuByCode = useMemo(() => new Map(skus.map(s => [s.code.toLowerCase(), s])), [skus])
  const dict = useMemo(() => {
    const alias: Record<string, string> = {}
    skuAlias.forEach(a => { const s = skuById.get(a.sku_id); if (s) alias[a.alias_norm] = s.code })
    return { skus: skus.map(s => ({ code: s.code, name: s.name, ean: s.ean ?? null })), alias }
  }, [skus, skuAlias, skuById])

  const kaOptions = kas.filter(k => k.country_id === countryId)
  const currency = parsed?.currency ?? null
  const pending = parsed ? parsed.lines.reduce((n, _, i) => n + (pick[i] && conf[i] ? 0 : 1), 0) : 0

  const reset = () => { setFile(null); setParsed(null); setUnknownRaw(null); setErr(''); setMatch([]); setPick([]); setConf([]); setOverride(false); if (fileRef.current) fileRef.current.value = '' }

  const handleFile = async (f: File | undefined | null) => {
    if (!f) return
    if (!/\.pdf$/i.test(f.name)) { setErr('只支持 PDF 文件。'); return }
    reset(); setFile(f); setBusy(true)
    try {
      const lib = await loadPdfjs()
      const bytes = new Uint8Array(await f.arrayBuffer())
      const p = parsePo(await extractLines(lib, bytes.slice()))
      if (p.template === null) { setUnknownRaw(p.raw); return }
      const m = p.lines.map(l => resolveSku(l, dict))
      setParsed(p); setMatch(m)
      setPick(m.map(x => (x.sku ? skuByCode.get(x.sku.toLowerCase())?.id ?? null : null)))
      setConf(m.map(x => x.status === 'ok'))
      const c = countries.find(c => c.code === p.country)
      setCountryId(c?.id ?? '')
      setKaId(kas.find(k => k.country_id === c?.id && k.name.trim().toLowerCase() === p.ka_hint.toLowerCase())?.id ?? '')
      setPoNumber(p.po ?? ''); setPoDate(p.date ?? today)
    } catch (e: any) {
      console.error(e); setErr(`解析失败：${e?.message ?? e}`)
    } finally { setBusy(false) }
  }

  // 同 SKU + 同单价的多行(Bigben 常把同 SKU 拆多批交期)合并成一行，数量/净额相加 —— 沿用既定口径
  const mergedRows = () => {
    if (!parsed) return []
    const m = new Map<string, { sku_id: number; qty: number; price: number; net: number; n: number }>()
    parsed.lines.forEach((l, i) => {
      const k = `${pick[i]}|${l.price}`
      const cur = m.get(k)
      if (cur) { cur.qty += l.qty; cur.net += l.net; cur.n++ } else m.set(k, { sku_id: pick[i]!, qty: l.qty, price: l.price, net: l.net, n: 1 })
    })
    return Array.from(m.values())
  }
  const mergedCount = parsed ? parsed.lines.length - mergedRows().length : 0

  const submit = async () => {
    if (!parsed || !file) return
    if (!countryId || !kaId) { alert('请选择 Country 和 KA。'); return }
    if (!poNumber.trim() || !poDate) { alert('PO # 和 PO Date 不能为空。'); return }
    if (currency !== 'EUR' && currency !== 'PLN') { alert(`币种「${currency}」暂不支持（仅 EUR / PLN）。`); return }
    if (pending > 0) { alert(`还有 ${pending} 行货号未确认。`); return }
    if (!parsed.ok && !override) { alert('自校验未通过：请先核对原件，或勾选「已人工核对，仍要导入」。'); return }
    setSaving(true)
    // ① 查重：PO 号已存在则整单拒绝
    const { count, error: dupErr } = await supabase.from('channel_po').select('id', { count: 'exact', head: true }).eq('po_number', poNumber.trim())
    if (dupErr) { setSaving(false); alert(`查重失败：${dupErr.message}`); return }
    if ((count ?? 0) > 0) { setSaving(false); alert(`ERP 里已有 PO「${poNumber.trim()}」（${count} 行），不重复导入。`); return }
    // ② 写入（po_status 不写 → 默认 'new'）
    const rows = mergedRows().map(r => ({
      country_id: countryId, ka_id: kaId, sku_id: r.sku_id, po_number: poNumber.trim(), po_date: poDate,
      qty_ordered: Math.round(r.qty), currency, fd_buying_price: r.price, turnover: r2(r.net), source_file: file.name,
    }))
    const { error } = await supabase.from('channel_po').insert(rows)
    if (error) { setSaving(false); alert(`导入失败：${error.message}`); return }
    // ③ 原件挂到 📎「PO 原件」（失败不回滚 PO，只提示）
    let warn = ''
    const path = `${sanitize(poNumber.trim())}/po_original/${Date.now()}-${sanitize(file.name)}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/pdf' })
    if (up.error) warn = `原件上传失败：${up.error.message}`
    else {
      const { error: dbErr } = await supabase.from('po_document').insert({
        po_number: poNumber.trim(), doc_type: 'po_original', file_name: file.name, storage_path: path, mime: file.type || 'application/pdf', size_bytes: file.size,
      })
      if (dbErr) { await supabase.storage.from(BUCKET).remove([path]); warn = `原件记录保存失败：${dbErr.message}` }
    }
    setSaving(false)
    if (warn) alert(`PO 已导入（${rows.length} 行），但${warn}\n请在该 PO 的 📎 里手动上传原件。`)
    onDone()
  }

  const total = parsed ? parsed.lines.reduce((s, l) => s + l.net, 0) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1000px] p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-lg font-semibold text-gray-900">📄 Add PO · 上传 PDF 自动解析</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-400 mb-4">
          按 KA 模板规则解析（无 AI，PDF 只在浏览器里处理）。已支持：{TEMPLATES.map(t => t.label.split(' (')[0]).join(' · ')}。导入的 PO 落入 <span className="text-indigo-600 font-medium">New PO</span>，核对后 Confirm。
        </div>

        {/* 选择文件 */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
          className="border-2 border-dashed border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/40 rounded-xl px-4 py-5 text-center cursor-pointer transition">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
          <div className="text-sm font-medium text-gray-700">{file ? `📕 ${file.name}` : '把 PO 的 PDF 拖到这里，或点击选择'}</div>
          <div className="text-[11px] text-gray-400 mt-1">{busy ? '解析中…' : file ? '点击可更换文件' : '一次一份 PO'}</div>
        </div>
        {err && <div className="mt-3 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}

        {/* 未识别模板 */}
        {unknownRaw != null && (
          <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4">
            <div className="font-semibold text-amber-800">⚠️ 未识别的 PO 模板</div>
            <div className="text-sm text-amber-900 mt-1">这份 PDF 不属于已支持的模板。把它发给我，我按它的版式补一个解析器即可（Tech Linku / CoolBlue / x-kom / Euro 等还没接）。</div>
            <details className="mt-2"><summary className="cursor-pointer text-xs text-amber-700">查看已提取的文本</summary>
              <pre className="mt-2 text-[11px] bg-white border border-amber-100 rounded-lg p-2 max-h-52 overflow-auto whitespace-pre-wrap">{unknownRaw}</pre></details>
          </div>
        )}

        {/* 解析结果 */}
        {parsed && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2.5 py-1 rounded-full font-semibold ${parsed.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{parsed.ok ? '✓ 自校验通过' : '✗ 自校验未通过'}</span>
              <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-semibold">模板 · {parsed.template_label}</span>
              <span className="text-gray-400">{parsed.lines.length} 行 · {fmtNum(parsed.lines.reduce((s, l) => s + l.qty, 0))} 件 · {CCY(total, currency)}</span>
            </div>

            <div className="grid grid-cols-4 gap-3 mt-3">
              <Fld label="Country *"><select value={countryId} onChange={e => { setCountryId(Number(e.target.value) || ''); setKaId('') }} className="fld">
                <option value="">—</option>{countries.map(c => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}</select></Fld>
              <Fld label={`KA *（模板建议：${parsed.ka_hint}）`}><select value={kaId} onChange={e => setKaId(Number(e.target.value) || '')} disabled={!countryId} className="fld">
                <option value="">—</option>{kaOptions.map(k => <option key={k.id} value={k.id}>{k.name}{k.fd ? ` · ${k.fd}` : ''}</option>)}</select></Fld>
              <Fld label="PO # *"><input value={poNumber} onChange={e => setPoNumber(e.target.value)} className="fld" /></Fld>
              <Fld label="PO Date *"><input type="date" value={poDate} onChange={e => setPoDate(e.target.value)} className="fld" /></Fld>
            </div>

            <div className="mt-4 overflow-x-auto">
              <div className="grid gap-x-3 gap-y-1.5 items-start min-w-[860px]" style={{ gridTemplateColumns: '28px 1.1fr 1.5fr 70px 92px 104px' }}>
                {['#', 'PO 原货号 / 描述', '→ ERP SKU', 'Qty', 'Unit Price', 'Net'].map((h, i) =>
                  <span key={h} className={`text-[11px] font-medium text-gray-500 ${i >= 3 ? 'text-right' : ''}`}>{h}</span>)}
                {parsed.lines.map((l, i) => {
                  const m = match[i]; const ok = !!(pick[i] && conf[i])
                  const cands = new Set((m?.cands ?? []).map(c => c.toLowerCase()))
                  const g1 = skus.filter(s => cands.has(s.code.toLowerCase())), g2 = skus.filter(s => !cands.has(s.code.toLowerCase()))
                  const opt = (s: SkuOpt) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  return (
                    <Fragment key={i}>
                      <span className="text-[12px] text-gray-400 pt-1.5">{i + 1}</span>
                      <div className="min-w-0 pt-0.5">
                        <div className="font-mono text-[12px] font-semibold text-gray-800 break-words">{l.raw_code}</div>
                        <div className="text-[11px] text-gray-500 break-words">{l.raw_desc}</div>
                        {l.ean && <div className="text-[10px] text-gray-400 font-mono">EAN {l.ean}</div>}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${ok ? 'bg-emerald-50 text-emerald-700' : pick[i] ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                            {ok ? (m?.status === 'ok' ? '✓ 已匹配' : '✓ 已确认') : pick[i] ? '建议 · 待确认' : '未匹配'}</span>
                          <select value={pick[i] ?? ''} onChange={e => { const v = Number(e.target.value) || null; setPick(p => p.map((x, j) => j === i ? v : x)); setConf(c => c.map((x, j) => j === i ? !!v : x)) }}
                            className="fld !py-1 !text-[12px] max-w-[260px]">
                            <option value="">请选择 ERP SKU…</option>
                            {g1.length > 0 && <optgroup label="同型号变体">{g1.map(opt)}</optgroup>}
                            <optgroup label="全部 SKU">{g2.map(opt)}</optgroup>
                          </select>
                          {!ok && pick[i] && <button onClick={() => setConf(c => c.map((x, j) => j === i ? true : x))} className="btn b-indigo" style={{ padding: '3px 9px' }}>确认</button>}
                        </div>
                        <div className="text-[10.5px] text-gray-400 mt-0.5">{m?.how}</div>
                      </div>
                      <span className="text-right text-[13px] tabular-nums pt-1.5">{fmtNum(l.qty)}</span>
                      <span className="text-right text-[13px] tabular-nums pt-1.5">{PRICE(l.price, currency)}</span>
                      <span className="text-right text-[13px] tabular-nums pt-1.5">{CCY(l.net, currency)}</span>
                    </Fragment>
                  )
                })}
              </div>
            </div>
            {mergedCount > 0 && <div className="mt-2 text-xs text-indigo-600">其中 {mergedCount} 行与「同 SKU、同单价」的行合并（数量相加），共写入 {mergedRows().length} 行。</div>}

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
              {parsed.checks.map((c, i) => (
                <div key={i} className="text-xs flex gap-1.5"><span className={c.ok ? 'text-emerald-600' : 'text-rose-600 font-bold'}>{c.ok ? '✓' : '✗'}</span>
                  <span className={c.ok ? 'text-gray-600' : 'text-rose-700 font-medium'}>{c.label}</span><span className="text-gray-400">{c.detail}</span></div>
              ))}
            </div>
            {!parsed.ok && (
              <label className="mt-2 flex items-center gap-2 text-xs text-rose-700"><input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />自校验未通过；我已对照原件人工核对，仍要导入</label>
            )}
          </>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          {parsed && <span className="text-xs mr-auto text-gray-500">{pending > 0 ? <>还有 <b className="text-amber-600">{pending}</b> 行货号待确认</> : <span className="text-emerald-600">货号全部就绪</span>}</span>}
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
          <button onClick={submit} disabled={saving || !parsed || pending > 0 || (!parsed.ok && !override)} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Importing…' : parsed ? `Import PO · ${mergedRows().length} line${mergedRows().length > 1 ? 's' : ''}` : 'Import PO'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-[11px] font-medium text-gray-500">{label}</span>{children}</label>
}
