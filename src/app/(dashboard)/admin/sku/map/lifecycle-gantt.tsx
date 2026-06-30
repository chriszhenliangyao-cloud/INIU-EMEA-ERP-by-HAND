'use client'

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const DAY = 864e5
// 复用 DB 既有列：合并后的「在售」用 active_start/active_end；pre/launch 列废弃留空。
const PHASE_DEF = [
  { key: 'plan', name: '1 · 规划立项 Planning', color: '#aeaeb2' },
  { key: 'dev', name: '2 · 研发 Development', color: '#5e5ce6' },
  { key: 'active', name: '3 · 在售 On Sale', color: '#0071e3' },
  { key: 'eol', name: '4 · 退市清库 EOL', color: '#c77800' },
] as const
const TYPES: Record<string, { icon: string; color: string; label: string }> = {
  win: { icon: '🏆', color: '#1d7a3d', label: '商务/中标' },
  price: { icon: '💰', color: '#c77800', label: '价格调整' },
  delay: { icon: '⏳', color: '#e35d6a', label: '研发延期 Delay' },
}
const PRICE_PHASES = ['active', 'eol']

// 分渠道价签轨道（实时从 PO 算，不存库）
type PoRow = { date: string; price: number | null; currency: string; channel: string; color: string | null }
type PSeg = { start: string; end: string; price: number; currency: string }
// 顺序排得相邻最大色差，按渠道序号分配 → 同一 model 内不撞色
const CH_PALETTE = ['#0071e3', '#1d7a3d', '#c77800', '#e3326a', '#9333ea', '#0d9488', '#b45309', '#5e5ce6', '#db2777', '#0a84c9']
const CCY_SYM: Record<string, string> = { EUR: '€', PLN: 'zł' }
// 每渠道一条轨道：按时间合并价格段（变动 <5% 视作同段，币种变/≥5% 切新段；近 0 促销价剔除）
function buildChannelTracks(pos: PoRow[]): { channel: string; color: string; segs: PSeg[] }[] {
  const byCh: Record<string, PoRow[]> = {}
  pos.forEach(r => { if (r.price == null || r.price < 1) return; (byCh[r.channel] ??= []).push(r) })
  return Object.keys(byCh)
    .sort((a, b) => byCh[b].length - byCh[a].length)
    .map((ch, idx) => {
      const rows = byCh[ch].slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      const segs: PSeg[] = []
      rows.forEach(r => {
        const last = segs[segs.length - 1]
        const changed = !last || last.currency !== r.currency || Math.abs((r.price as number) / last.price - 1) >= 0.05
        if (changed) { if (last) last.end = r.date; segs.push({ start: r.date, end: r.date, price: r.price as number, currency: r.currency }) }
        else last.end = r.date
      })
      return { channel: ch, color: CH_PALETTE[idx % CH_PALETTE.length], segs }
    })
}

type Phase = { key: string; name: string; color: string; start: string | null; end: string | null }
type Kf = { id: number; type: string; date: string; title: string; note: string; price: number | null; phase: string }
type Pop =
  | { kind: 'phase'; key: string; x: number; y: number }
  | { kind: 'kf'; id: number; x: number; y: number }
  | { kind: 'kfnew'; phase: string; date: string; x: number; y: number }
  | null

const addDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * DAY).toISOString().slice(0, 10)
const fmtM = (d: string) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') }
const todayISO = () => new Date().toISOString().slice(0, 10)

const EASE = 'cubic-bezier(.22,.61,.36,1)'
const GANTT_CSS = `
.lcg .lc-bar{cursor:grab;transition:left .22s ${EASE},width .22s ${EASE},box-shadow .2s ease,transform .2s ${EASE};will-change:left,width}
.lcg .lc-bar:hover{filter:brightness(1.06)}
.lcg .lc-bar.lift{cursor:grabbing;transition:none;transform:scale(1.025);box-shadow:0 9px 24px rgba(0,0,0,.24);z-index:8}
.lcg .lc-bar:active{cursor:grabbing}
.lcg .lc-h{opacity:0;transition:opacity .15s ease}
.lcg .lc-bar:hover .lc-h{opacity:1}
.lcg .lc-track{transition:background .15s ease}
.lcg .lc-track:hover{background:rgba(0,0,0,.018)}
.lcg .lc-empty{transition:border-color .15s ease,color .15s ease,background .15s ease}
.lcg .lc-track:hover .lc-empty{border-color:#bcbcc2;color:#8e8e93;background:rgba(0,0,0,.012)}
.lcg .lc-px{transition:left .22s ${EASE},width .22s ${EASE}}
.lcg .lc-kf{transform:translateX(-50%);cursor:grab;transition:left .22s ${EASE},transform .15s ease,box-shadow .15s ease}
.lcg .lc-kf:hover{transform:translateX(-50%) scale(1.22);box-shadow:0 3px 10px rgba(0,0,0,.34);z-index:9}
.lcg .lc-kf.lift{cursor:grabbing;transition:none;transform:translateX(-50%) scale(1.26);z-index:10;box-shadow:0 7px 16px rgba(0,0,0,.3)}
.lc-bubble{position:fixed;pointer-events:none;background:rgba(28,28,30,.9);color:#fff;font-size:11px;font-weight:600;letter-spacing:.2px;padding:4px 9px;border-radius:8px;transform:translate(-50%,-160%);white-space:nowrap;z-index:90;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 6px 18px rgba(0,0,0,.28)}
@keyframes lcPop{from{opacity:0;transform:scale(.95) translateY(6px)}to{opacity:1;transform:none}}
.lc-pop{animation:lcPop .2s ${EASE};transform-origin:top center}
`

export function LifecycleGantt({ modelCode, modelName, subtitle, currentLifecycle, skuVariants }: {
  modelCode: string; modelName: string; subtitle: string; currentLifecycle: string; skuVariants: { id: number; color: string | null }[]
}) {
  const skuIds = skuVariants.map(v => v.id)
  const skuKey = skuIds.join(',')
  const colorById: Record<number, string | null> = Object.fromEntries(skuVariants.map(v => [v.id, v.color]))
  const supabase = useRef(createClient()).current
  const ganttRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [phases, setPhases] = useState<Phase[]>(PHASE_DEF.map(d => ({ ...d, start: null, end: null })))
  const [initialPrice, setInitialPrice] = useState<number | null>(null)
  const [kfs, setKfs] = useState<Kf[]>([])
  const [poRows, setPoRows] = useState<PoRow[]>([])
  const [colorFilter, setColorFilter] = useState<string | null>(null)
  // 价格轨道:按所选颜色过滤后,实时算（切颜色不重新拉数据）
  const tracks = useMemo(
    () => buildChannelTracks(colorFilter ? poRows.filter(r => r.color === colorFilter) : poRows),
    [poRows, colorFilter],
  )
  // 只列出真正有 PO 数据的颜色
  const colorOptions = useMemo(() => Array.from(new Set(poRows.map(r => r.color).filter(Boolean))) as string[], [poRows])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cascade, setCascade] = useState(false)
  const [pop, setPop] = useState<Pop>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const tmpId = useRef(-1)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data: pl }, { data: kf }, { data: po }] = await Promise.all([
        supabase.from('product_lifecycle').select('*').eq('model_code', modelCode).maybeSingle(),
        supabase.from('product_keyframe').select('*').eq('model_code', modelCode).order('kf_date'),
        skuIds.length
          ? supabase.from('channel_po').select('po_date, fd_buying_price, currency, sku_id, ka:ka_id(name)').in('sku_id', skuIds).order('po_date')
          : Promise.resolve({ data: [] as any[] }),
      ])
      if (!alive) return
      setPhases(PHASE_DEF.map(d => ({ ...d, start: (pl as any)?.[d.key + '_start'] ?? null, end: (pl as any)?.[d.key + '_end'] ?? null })))
      setInitialPrice((pl as any)?.initial_price ?? null)
      setKfs((kf ?? []).map((k: any) => ({ id: k.id, type: k.kf_type, date: k.kf_date, title: k.title ?? '', note: k.note ?? '', price: k.price, phase: k.phase })))
      setPoRows((po ?? []).map((r: any) => {
        const ka = Array.isArray(r.ka) ? r.ka[0] : r.ka
        return { date: r.po_date, price: r.fd_buying_price == null ? null : Number(r.fd_buying_price), currency: r.currency, channel: ka?.name ?? '—', color: colorById[r.sku_id] ?? null }
      }))
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [modelCode, supabase, skuKey])

  // ---- time window ----
  const dates = [...phases.flatMap(p => [p.start, p.end]).filter(Boolean) as string[], ...kfs.map(k => k.date), ...tracks.flatMap(t => t.segs.flatMap(s => [s.start, s.end]))]
  let T0 = new Date(), T1 = new Date()
  if (dates.length) {
    const ds = dates.map(d => +new Date(d))
    T0 = new Date(Math.min(...ds)); T1 = new Date(Math.max(...ds))
    T0 = new Date(T0.getFullYear(), T0.getMonth() - 1, 1)
    T1 = new Date(T1.getFullYear(), T1.getMonth() + 2, 1)
  } else {
    T0 = new Date(); T0 = new Date(T0.getFullYear(), T0.getMonth() - 4, 1)
    T1 = new Date(); T1 = new Date(T1.getFullYear(), T1.getMonth() + 14, 1)
  }
  const span = +T1 - +T0
  const pct = (d: string | Date) => ((+new Date(d) - +T0) / span * 100)
  const isoAt = (p: number) => new Date(+T0 + span * p / 100).toISOString().slice(0, 10)
  const trackW = () => ganttRef.current?.querySelector('.lc-track')?.getBoundingClientRect().width ?? 600
  const dayPx = () => trackW() / (span / DAY)            // 一天 = 多少像素（用于吸附到整天）
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  const fmtD = (d: string) => d                          // ISO YYYY-MM-DD（气泡用）

  // 跟手日期气泡（Apple Calendar 风格）
  const bubbleRef = useRef<HTMLDivElement>(null)
  const showBubble = (text: string, x: number, y: number) => {
    const b = bubbleRef.current; if (!b) return
    b.textContent = text; b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.display = 'block'
  }
  const hideBubble = () => { if (bubbleRef.current) bubbleRef.current.style.display = 'none' }

  const touch = () => setDirty(true)

  // ---- price segments ----
  const priceSegs = () => {
    const active = phases.find(p => p.key === 'active'), eol = phases.find(p => p.key === 'eol')
    const start = active?.start; if (!start) return []          // 在售起点 = 价格时间轴起点
    const end = eol?.end || active?.end; if (!end) return []
    const pts = [{ date: start, price: initialPrice ?? 0 }]
    kfs.filter(k => k.type === 'price' && k.price != null).forEach(k => { if (k.date > start && k.date < end) pts.push({ date: k.date, price: +(k.price as number) }) })
    pts.sort((a, b) => +new Date(a.date) - +new Date(b.date))
    return pts.map((p, i) => ({ start: p.date, end: i + 1 < pts.length ? pts[i + 1].date : end, price: p.price }))
  }

  // ---- drag bars (rAF + 直接改 DOM，松手才 commit；60fps 不卡) ----
  const startBarDrag = (e: React.PointerEvent, key: string, mode: 'move' | 'l' | 'r') => {
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const idx = phases.findIndex(p => p.key === key)
    const s0 = phases[idx].start!, e0 = phases[idx].end!
    const ax = e.clientX, dpx = dayPx()
    let moved = false, dd = 0, raf = 0, cx = ax, cy = e.clientY
    const calc = () => {
      let ns = s0, ne = e0
      if (mode === 'move') { ns = addDays(s0, dd); ne = addDays(e0, dd) }
      else if (mode === 'r') { ne = addDays(e0, dd); if (new Date(ne) <= new Date(s0)) ne = addDays(s0, 1) }
      else { ns = addDays(s0, dd); if (new Date(ns) >= new Date(e0)) ns = addDays(e0, -1) }
      return { ns, ne }
    }
    const paint = () => {
      raf = 0; const { ns, ne } = calc()
      el.style.left = pct(ns) + '%'; el.style.width = (pct(ne) - pct(ns)) + '%'
      showBubble(mode === 'move' ? `${fmtD(ns)} → ${fmtD(ne)}` : mode === 'r' ? fmtD(ne) : fmtD(ns), cx, cy)
    }
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - ax; if (!moved && Math.abs(dx) < 4) return
      if (!moved) { moved = true; el.classList.add('lift') }
      dd = Math.round(dx / dpx); cx = ev.clientX; cy = ev.clientY
      if (!raf) raf = requestAnimationFrame(paint)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up)
      if (raf) cancelAnimationFrame(raf); hideBubble(); el.classList.remove('lift')
      if (!moved) { setPop({ kind: 'phase', key, x: ev.clientX, y: ev.clientY }); return }   // 单击 → 日期弹窗
      const { ns, ne } = calc()
      setPhases(prev => prev.map((p, j) => {
        if (j === idx) return { ...p, start: ns, end: ne }
        if (cascade && (mode === 'move' || mode === 'r') && j > idx && p.start) return { ...p, start: addDays(p.start, dd), end: addDays(p.end!, dd) }
        return p
      }))
      touch()
    }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }

  // ---- track empty: unscheduled -> draw, else new keyframe ----
  const onTrackDown = (e: React.PointerEvent, key: string) => {
    const t = e.target as HTMLElement
    if (t.closest('.lc-bar') || t.closest('.lc-kf')) return
    const tr = e.currentTarget as HTMLElement, rect = tr.getBoundingClientRect(), ax = e.clientX
    const startP = clamp((ax - rect.left) / rect.width * 100)
    const p = phases.find(x => x.key === key)!
    if (!p.start) {
      const s = isoAt(startP); let moved = false, raf = 0, ne = addDays(s, 1), cx = ax, cy = e.clientY
      setPhases(prev => prev.map(x => x.key === key ? { ...x, start: s, end: addDays(s, 1) } : x))
      const paint = () => { raf = 0; setPhases(prev => prev.map(x => x.key === key ? { ...x, end: ne } : x)); showBubble(`${fmtD(s)} → ${fmtD(ne)}`, cx, cy) }
      const mv = (ev: PointerEvent) => {
        const dx = ev.clientX - ax; if (!moved && Math.abs(dx) < 4) return; moved = true
        const pp = clamp((ev.clientX - rect.left) / rect.width * 100); ne = isoAt(pp); if (new Date(ne) <= new Date(s)) ne = addDays(s, 1)
        cx = ev.clientX; cy = ev.clientY; if (!raf) raf = requestAnimationFrame(paint)
      }
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (raf) cancelAnimationFrame(raf); hideBubble(); touch()
        if (!moved) { setPhases(prev => prev.map(x => x.key === key ? { ...x, end: addDays(s, 30) } : x)); setPop({ kind: 'phase', key, x: ev.clientX, y: ev.clientY }) }
      }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
    } else {
      const up = (ev: PointerEvent) => { window.removeEventListener('pointerup', up); if (Math.abs(ev.clientX - ax) < 4) setPop({ kind: 'kfnew', phase: key, date: isoAt(startP), x: ev.clientX, y: ev.clientY }) }
      window.addEventListener('pointerup', up)
    }
  }

  const startKfDrag = (e: React.PointerEvent, id: number) => {
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const tr = el.closest('.lc-track') as HTMLElement, rect = tr.getBoundingClientRect(), ax = e.clientX
    let moved = false, raf = 0, date = '', cx = ax, cy = e.clientY
    const paint = () => { raf = 0; el.style.left = pct(date) + '%'; showBubble(fmtD(date), cx, cy) }
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - ax; if (!moved && Math.abs(dx) < 4) return
      if (!moved) { moved = true; el.classList.add('lift') }
      date = isoAt(clamp((ev.clientX - rect.left) / rect.width * 100)); cx = ev.clientX; cy = ev.clientY
      if (!raf) raf = requestAnimationFrame(paint)
    }
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (raf) cancelAnimationFrame(raf); hideBubble(); el.classList.remove('lift')
      if (moved) { setKfs(prev => prev.map(k => k.id === id ? { ...k, date } : k)); touch() }
      else { const r = el.getBoundingClientRect(); setPop({ kind: 'kf', id, x: r.left, y: r.bottom }) }
    }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }

  // ---- save ----
  const save = async () => {
    setSaving(true)
    const row: any = { model_code: modelCode, initial_price: initialPrice, updated_at: new Date().toISOString() }
    for (const p of phases) { row[p.key + '_start'] = p.start; row[p.key + '_end'] = p.end }
    const { error: e1 } = await supabase.from('product_lifecycle').upsert(row, { onConflict: 'model_code' })
    await supabase.from('product_keyframe').delete().eq('model_code', modelCode)
    let e2: any = null
    if (kfs.length) {
      const ins = kfs.map(k => ({ model_code: modelCode, phase: k.phase, kf_type: k.type, kf_date: k.date, title: k.title || null, note: k.note || null, price: k.price ?? null }))
      e2 = (await supabase.from('product_keyframe').insert(ins)).error
    }
    setSaving(false)
    if (e1 || e2) { setMsg('⚠️ 保存失败：' + (e1?.message || e2?.message)); return }
    setDirty(false); setMsg('已保存 ✓'); setTimeout(() => setMsg(null), 2000)
  }

  if (!loaded) return <div className="mt-2 ml-4 p-4 text-xs text-gray-400">加载生命周期…</div>

  const tx = pct(todayISO())
  const PSEGS = priceSegs()
  // axis quarter ticks
  const ticks: { x: number; label: string }[] = []
  let d = new Date(T0)
  while (d <= T1) { if (d.getMonth() % 3 === 0) ticks.push({ x: pct(d), label: `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}` }); d = new Date(d.getFullYear(), d.getMonth() + 1, 1) }

  return (
    <div className="lcg mt-2 border border-indigo-200 rounded-lg bg-white p-3" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: GANTT_CSS }} />
      <div ref={bubbleRef} className="lc-bubble" style={{ display: 'none', left: 0, top: 0 }} />
      {/* toolbar */}
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <span className="text-xs font-semibold text-gray-800">📅 {modelCode} · {modelName}</span>
        <span className="text-[10px] text-gray-400">{subtitle} · 当前 {currentLifecycle}</span>
        <label className="flex items-center gap-1 text-[11px] text-gray-600 cursor-pointer ml-2">
          <input type="checkbox" checked={cascade} onChange={e => setCascade(e.target.checked)} /> 🔗 联动后续
        </label>
        <span className="text-[10px] text-gray-400">空行拖拽=画阶段 · 进度条单击=选日期 · 行内空白单击=加关键帧</span>
        <div className="ml-auto flex items-center gap-3">
          {Object.values(TYPES).map(t => <span key={t.label} className="text-[10px] text-gray-500">{t.icon} {t.label}</span>)}
          {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
          <button onClick={save} disabled={saving || !dirty}
            className={`px-3 py-1 text-xs font-medium rounded-md ${dirty ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-400'}`}>
            {saving ? '保存中…' : dirty ? '💾 保存' : '已保存'}
          </button>
        </div>
      </div>

      {/* gantt */}
      <div ref={ganttRef} className="border border-gray-200 rounded-lg overflow-hidden text-[11px]">
        {/* axis */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          <div className="flex-none border-r border-gray-200" style={{ width: 180, padding: '7px 12px', fontSize: 11, fontWeight: 600, color: '#86868b' }}>阶段 ＼ 时间</div>
          <div className="relative flex-1" style={{ height: 30 }}>
            {ticks.map((t, i) => <div key={i} style={{ position: 'absolute', left: t.x + '%', top: 0, bottom: 0, fontSize: 9, fontWeight: 600, color: '#a8a8ad', padding: '4px 0 0 4px', whiteSpace: 'nowrap', borderLeft: '1px solid #e9e9ec' }}>{t.label}</div>)}
            <div style={{ position: 'absolute', left: tx + '%', top: 0, bottom: 0, width: 2, background: '#f0617c' }}>
              <div style={{ position: 'absolute', top: -19, left: -20, background: '#f0617c', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap' }}>今日</div>
            </div>
          </div>
        </div>

        {/* rows */}
        {phases.map(p => {
          const hasPx = PRICE_PHASES.includes(p.key) && p.start && initialPrice != null
          const rowKfs = kfs.filter(k => k.phase === p.key)
          return (
            <Fragment key={p.key}>
            <div className="flex border-b border-gray-100" style={{ minHeight: hasPx ? 54 : 44 }}>
              <div className="flex-none border-r border-gray-200 flex items-center gap-2" style={{ width: 180, padding: '6px 12px', fontSize: 11.5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color, flex: '0 0 auto' }} /><span>{p.name}</span>
              </div>
              <div className="lc-track relative flex-1" style={{ height: hasPx ? 54 : 44, cursor: 'copy', touchAction: 'none' }} onPointerDown={e => onTrackDown(e, p.key)}>
                {/* bar / emptyhint */}
                {p.start && p.end ? (
                  <div className="lc-bar" onPointerDown={e => startBarDrag(e, p.key, (e.target as HTMLElement).dataset.h as any || 'move')}
                    style={{ position: 'absolute', top: 16, left: pct(p.start) + '%', width: (pct(p.end) - pct(p.start)) + '%', height: 16, borderRadius: 7, background: p.color, color: '#fff', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap', touchAction: 'none' }}>
                    <span className="lc-h" data-h="l" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 11, cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i style={{ width: 3, height: 8, borderRadius: 2, background: 'rgba(255,255,255,.75)', pointerEvents: 'none' }} />
                    </span>
                    {fmtM(p.start)} → {fmtM(p.end)}
                    <span className="lc-h" data-h="r" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 11, cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i style={{ width: 3, height: 8, borderRadius: 2, background: 'rgba(255,255,255,.75)', pointerEvents: 'none' }} />
                    </span>
                  </div>
                ) : (
                  <div className="lc-empty" style={{ position: 'absolute', left: 8, right: 8, top: 16, height: 16, border: '1px dashed #e2e2e6', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#cdcdd2', pointerEvents: 'none' }}>＋ 拖拽创建 / 单击设日期</div>
                )}
                {/* price inline */}
                {hasPx && PSEGS.map((sg, i) => {
                  const s = sg.start > p.start! ? sg.start : p.start!, e = sg.end < p.end! ? sg.end : p.end!
                  if (new Date(s) >= new Date(e)) return null
                  return <div key={i} className="lc-px" style={{ position: 'absolute', top: 36, left: pct(s) + '%', width: (pct(e) - pct(s)) + '%', height: 11, borderRadius: 4, background: '#eef5ef', border: '1px solid #cfe3d4', color: '#3f8a5c', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>€{sg.price}</div>
                })}
                {/* keyframes */}
                {rowKfs.map(k => {
                  const t = TYPES[k.type] ?? TYPES.win
                  return <div key={k.id} className="lc-kf" title={`${t.icon} ${k.title}`} onPointerDown={e => startKfDrag(e, k.id)}
                    style={{ position: 'absolute', top: 1, left: pct(k.date) + '%', width: 16, height: 16, borderRadius: '50%', background: t.color, color: '#fff', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, zIndex: 6, touchAction: 'none' }}>{t.icon}</div>
                })}
                <div style={{ position: 'absolute', left: tx + '%', top: 0, bottom: 0, width: 2, background: '#f0617c', zIndex: 5 }} />
              </div>
            </div>

            {/* 渠道价格轨道：作为「在售」相位的子段（来自 PO，实时） */}
            {p.key === 'active' && tracks.length > 0 && (
              <>
                <div className="flex items-center border-b border-gray-100" style={{ background: '#fafafb' }}>
                  <div className="flex-none border-r border-gray-200" style={{ width: 180, padding: '5px 12px 5px 26px', fontSize: 10, fontWeight: 600, color: '#86868b' }}>↳ 渠道价格 · 来自 PO</div>
                  <div className="flex-1 flex items-center gap-1.5 flex-wrap" style={{ padding: '4px 10px' }}>
                    {colorOptions.length >= 2 && (<>
                      <span style={{ fontSize: 10, color: '#a8a8ad' }}>按颜色</span>
                      {[null, ...colorOptions].map(c => {
                        const on = colorFilter === c
                        return (
                          <button key={c ?? 'all'} onClick={() => setColorFilter(c)}
                            style={{ fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
                              border: on ? '1px solid #1c1c1e' : '1px solid #e2e2e6',
                              background: on ? '#1c1c1e' : '#fff', color: on ? '#fff' : '#6b6b70' }}>
                            {c ?? '全部'}
                          </button>
                        )
                      })}
                    </>)}
                  </div>
                </div>
                {tracks.map(t => (
                  <div key={t.channel} className="flex border-b border-gray-100" style={{ minHeight: 28 }}>
                    <div className="flex-none border-r border-gray-200 flex items-center gap-1.5" style={{ width: 180, padding: '4px 12px 4px 26px', fontSize: 10.5, color: '#3f3f46', boxShadow: 'inset 3px 0 0 ' + t.color }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color, flex: '0 0 auto' }} /><span className="truncate" style={{ fontWeight: 500 }}>{t.channel}</span>
                    </div>
                    <div className="relative flex-1" style={{ height: 28 }}>
                      {t.segs.map((sg, i) => {
                        const left = clamp(pct(sg.start)), w = Math.max(clamp(pct(sg.end)) - left, 0)
                        return (
                          <div key={i} title={`${t.channel} · ${sg.start}${sg.end !== sg.start ? ' → ' + sg.end : ''} · ${(CCY_SYM[sg.currency] || sg.currency + ' ')}${sg.price}`}
                            style={{ position: 'absolute', top: 6, left: left + '%', width: w + '%', minWidth: 36, height: 15, borderRadius: 4, background: t.color + '33', border: '1.5px solid ' + t.color, color: t.color, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', padding: '0 3px', overflow: 'hidden' }}>
                            {(CCY_SYM[sg.currency] || sg.currency + ' ') + sg.price}
                          </div>
                        )
                      })}
                      {t.segs.map((sg, i) => {
                        if (i === 0) return null
                        const prev = t.segs[i - 1]
                        const sym = (c: string) => CCY_SYM[c] || c + ' '
                        return (
                          <div key={'kf' + i} title={`💰 调价 ${sg.start} · ${sym(prev.currency)}${prev.price} → ${sym(sg.currency)}${sg.price}`}
                            style={{ position: 'absolute', top: 7, left: clamp(pct(sg.start)) + '%', transform: 'translateX(-50%)', width: 14, height: 14, borderRadius: '50%', background: t.color, color: '#fff', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, zIndex: 4 }}>💰</div>
                        )
                      })}
                      <div style={{ position: 'absolute', left: tx + '%', top: 0, bottom: 0, width: 2, background: '#f0617c', opacity: 0.45 }} />
                    </div>
                  </div>
                ))}
              </>
            )}
            </Fragment>
          )
        })}
      </div>

      {/* popups */}
      {pop?.kind === 'phase' && (
        <PhasePopup p={phases.find(x => x.key === pop.key)!} x={pop.x} y={pop.y} cascade={cascade}
          onClose={() => setPop(null)}
          onSave={(s, e, casc) => {
            setPhases(prev => {
              const idx = prev.findIndex(x => x.key === pop.key); const oldEnd = prev[idx].end
              const dd = casc && oldEnd ? Math.round((+new Date(e) - +new Date(oldEnd)) / DAY) : 0
              return prev.map((x, j) => j === idx ? { ...x, start: s, end: e } : (dd && j > idx && x.start ? { ...x, start: addDays(x.start, dd), end: addDays(x.end!, dd) } : x))
            }); touch(); setPop(null)
          }} />
      )}
      {pop?.kind === 'kf' && (() => { const k = kfs.find(x => x.id === (pop as any).id); if (!k) return null
        return <KfPopup k={k} x={pop.x} y={pop.y} initialPrice={initialPrice}
          onClose={() => setPop(null)}
          onDelete={() => { setKfs(prev => prev.filter(x => x.id !== k.id)); touch(); setPop(null) }}
          onSave={(nk) => { setKfs(prev => prev.map(x => x.id === k.id ? { ...x, ...nk } : x)); touch(); setPop(null) }}
          onSetInitial={(v) => { setInitialPrice(v); touch() }} /> })()}
      {pop?.kind === 'kfnew' && (
        <KfPopup k={{ id: 0, type: 'win', date: (pop as any).date, title: '', note: '', price: null, phase: (pop as any).phase }} x={pop.x} y={pop.y} isNew initialPrice={initialPrice}
          onClose={() => setPop(null)}
          onDelete={() => setPop(null)}
          onSave={(nk) => { setKfs(prev => [...prev, { id: tmpId.current--, phase: (pop as any).phase, type: nk.type!, date: nk.date!, title: nk.title || TYPES[nk.type!].label, note: nk.note || '', price: nk.price ?? null }]); touch(); setPop(null) }}
          onSetInitial={(v) => { setInitialPrice(v); touch() }} />
      )}
    </div>
  )
}

// ---- popups ----
function useEsc(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
}
const POP_W = 272
// 弹窗：先用临时位置渲染，挂载后测量真实高度再夹到视口内（低位翻上方 / 过高则限高滚动）
function usePopupPos(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number }>(() => ({
    left: Math.min((typeof window !== 'undefined' ? window.innerWidth : 1200) - POP_W - 10, Math.max(10, x - POP_W / 2)),
    top: y + 12, maxH: 9999,
  }))
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const place = () => {
      const vw = window.innerWidth, vh = window.innerHeight, m = 12
      const maxH = vh - m * 2
      const h = Math.min(el.getBoundingClientRect().height, maxH)
      const left = Math.min(vw - POP_W - m, Math.max(m, x - POP_W / 2))
      let top = y + m
      if (top + h > vh - m) top = y - m - h                 // 翻到锚点上方
      top = Math.max(m, Math.min(top, vh - m - h))
      setPos({ left, top, maxH })
    }
    place()
    const ro = new ResizeObserver(place); ro.observe(el)   // 内容变高（如切到价格调整）时重新夹位
    window.addEventListener('resize', place)
    return () => { ro.disconnect(); window.removeEventListener('resize', place) }
  }, [x, y])
  return { ref, pos }
}
function popStyle(pos: { left: number; top: number; maxH: number }): React.CSSProperties {
  return { position: 'fixed', left: pos.left, top: pos.top, width: POP_W, maxHeight: pos.maxH, overflowY: 'auto', zIndex: 60, background: '#fff', border: '1px solid #ececef', borderRadius: 14, boxShadow: '0 14px 44px rgba(0,0,0,.22)', padding: 14, fontSize: 12 }
}
const lbl = 'block text-[10px] text-gray-500 mt-2 mb-0.5'
const inp = 'w-full border border-gray-300 rounded-md px-2 py-1 text-xs'

function PhasePopup({ p, x, y, cascade, onSave, onClose }: { p: Phase; x: number; y: number; cascade: boolean; onSave: (s: string, e: string, casc: boolean) => void; onClose: () => void }) {
  const [s, setS] = useState(p.start ?? ''); const [e, setE] = useState(p.end ?? ''); const [c, setC] = useState(cascade)
  useEsc(onClose); const { ref, pos } = usePopupPos(x, y)
  return (
    <>
      <div className="fixed inset-0 z-50" onMouseDown={onClose} />
      <div ref={ref} className="lc-pop" style={popStyle(pos)}>
        <h4 className="text-[13px] font-semibold mb-1">📐 {p.name}</h4>
        <label className={lbl}>开始日期</label><input type="date" className={inp} value={s} onChange={ev => setS(ev.target.value)} />
        <label className={lbl}>结束日期</label><input type="date" className={inp} value={e} onChange={ev => setE(ev.target.value)} />
        <label className="flex items-center gap-1.5 text-[11px] text-gray-600 mt-2 cursor-pointer"><input type="checkbox" checked={c} onChange={ev => setC(ev.target.checked)} /> 🔗 联动后续阶段(按结束日顺延)</label>
        <div className="flex justify-end gap-2 mt-3">
          <button className="px-2.5 py-1 text-xs border border-gray-300 rounded-md" onClick={onClose}>关</button>
          <button className="px-3 py-1 text-xs bg-blue-600 text-white rounded-md" onClick={() => { if (!s || !e || new Date(e) <= new Date(s)) { alert('结束需晚于开始'); return } onSave(s, e, c) }}>保存</button>
        </div>
      </div>
    </>
  )
}

function KfPopup({ k, x, y, isNew, initialPrice, onSave, onDelete, onClose, onSetInitial }: {
  k: Kf; x: number; y: number; isNew?: boolean; initialPrice: number | null
  onSave: (nk: Partial<Kf>) => void; onDelete: () => void; onClose: () => void; onSetInitial: (v: number | null) => void
}) {
  const [type, setType] = useState(k.type); const [title, setTitle] = useState(k.title); const [date, setDate] = useState(k.date)
  const [note, setNote] = useState(k.note); const [price, setPrice] = useState<string>(k.price != null ? String(k.price) : '')
  const [ip, setIp] = useState<string>(initialPrice != null ? String(initialPrice) : '')
  useEsc(onClose); const { ref, pos } = usePopupPos(x, y)
  return (
    <>
      <div className="fixed inset-0 z-50" onMouseDown={onClose} />
      <div ref={ref} className="lc-pop" style={popStyle(pos)}>
        <h4 className="text-[13px] font-semibold mb-1">{isNew ? '＋ 新建关键帧' : `${TYPES[type]?.icon} 关键帧`}</h4>
        <label className={lbl}>类型</label>
        <select className={inp} value={type} onChange={e => setType(e.target.value)}>
          {Object.entries(TYPES).map(([v, t]) => <option key={v} value={v}>{t.icon} {t.label}</option>)}
        </select>
        {type === 'price' && (<>
          <label className={lbl}>新价格 € (此帧之后生效)</label><input type="number" step="0.01" className={inp} placeholder="如 37.9" value={price} onChange={e => setPrice(e.target.value)} />
          <label className={lbl}>初始价 € (上市价,全型号一个)</label><input type="number" step="0.01" className={inp} placeholder="如 39.9" value={ip} onChange={e => { setIp(e.target.value); onSetInitial(e.target.value ? +e.target.value : null) }} />
        </>)}
        <label className={lbl}>标题</label><input className={inp} placeholder="如 中标 / 跟进降价 / 研发延期" value={title} onChange={e => setTitle(e.target.value)} />
        <label className={lbl}>日期</label><input type="date" className={inp} value={date} onChange={e => setDate(e.target.value)} />
        <label className={lbl}>备注</label><textarea rows={2} className={inp} value={note} onChange={e => setNote(e.target.value)} />
        <div className="flex justify-between mt-3">
          {!isNew ? <button className="px-2.5 py-1 text-xs text-red-600 border border-gray-300 rounded-md" onClick={onDelete}>删除</button> : <span />}
          <div className="flex gap-2">
            <button className="px-2.5 py-1 text-xs border border-gray-300 rounded-md" onClick={onClose}>{isNew ? '取消' : '关'}</button>
            <button className="px-3 py-1 text-xs bg-blue-600 text-white rounded-md" onClick={() => onSave({ type, title, date, note, price: type === 'price' && price ? +price : null })}>{isNew ? '添加' : '保存'}</button>
          </div>
        </div>
      </div>
    </>
  )
}
