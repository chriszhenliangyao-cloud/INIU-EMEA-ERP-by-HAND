'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const DAY = 864e5
const PHASE_DEF = [
  { key: 'plan', name: '1 · 规划立项 Planning', color: '#a8adb5' },
  { key: 'dev', name: '2 · 研发 Development', color: '#8a9bb0' },
  { key: 'pre', name: '3 · 量产备货·铺货 Pre-launch', color: '#6cc3d5' },
  { key: 'launch', name: '4 · 上市开售 Launch (NPI)', color: '#52b788' },
  { key: 'active', name: '5 · 稳定在售 Active', color: '#7aa095' },
  { key: 'eol', name: '6 · 退市清库 EOL', color: '#c9a227' },
  { key: 'disc', name: '7 · 停产退市 Discontinued', color: '#d98594' },
] as const
const TYPES: Record<string, { icon: string; color: string; label: string }> = {
  win: { icon: '🏆', color: '#52b788', label: '商务/中标' },
  price: { icon: '💰', color: '#e0a458', label: '价格调整' },
  delay: { icon: '⏳', color: '#d98594', label: '研发延期 Delay' },
}
const PRICE_PHASES = ['launch', 'active', 'eol']

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

export function LifecycleGantt({ modelCode, modelName, subtitle, currentLifecycle }: {
  modelCode: string; modelName: string; subtitle: string; currentLifecycle: string
}) {
  const supabase = useRef(createClient()).current
  const ganttRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [phases, setPhases] = useState<Phase[]>(PHASE_DEF.map(d => ({ ...d, start: null, end: null })))
  const [initialPrice, setInitialPrice] = useState<number | null>(null)
  const [kfs, setKfs] = useState<Kf[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cascade, setCascade] = useState(false)
  const [pop, setPop] = useState<Pop>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const tmpId = useRef(-1)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data: pl }, { data: kf }] = await Promise.all([
        supabase.from('product_lifecycle').select('*').eq('model_code', modelCode).maybeSingle(),
        supabase.from('product_keyframe').select('*').eq('model_code', modelCode).order('kf_date'),
      ])
      if (!alive) return
      setPhases(PHASE_DEF.map(d => ({ ...d, start: (pl as any)?.[d.key + '_start'] ?? null, end: (pl as any)?.[d.key + '_end'] ?? null })))
      setInitialPrice((pl as any)?.initial_price ?? null)
      setKfs((kf ?? []).map((k: any) => ({ id: k.id, type: k.kf_type, date: k.kf_date, title: k.title ?? '', note: k.note ?? '', price: k.price, phase: k.phase })))
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [modelCode, supabase])

  // ---- time window ----
  const dates = [...phases.flatMap(p => [p.start, p.end]).filter(Boolean) as string[], ...kfs.map(k => k.date)]
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
  const pxToDays = (dx: number, w: number) => Math.round(dx / w * (span / DAY))

  const touch = () => setDirty(true)

  // ---- price segments ----
  const priceSegs = () => {
    const launch = phases.find(p => p.key === 'launch'), active = phases.find(p => p.key === 'active'), eol = phases.find(p => p.key === 'eol')
    const start = launch?.start; if (!start) return []
    const end = eol?.end || active?.end || launch?.end; if (!end) return []
    const pts = [{ date: start, price: initialPrice ?? 0 }]
    kfs.filter(k => k.type === 'price' && k.price != null).forEach(k => { if (k.date > start && k.date < end) pts.push({ date: k.date, price: +(k.price as number) }) })
    pts.sort((a, b) => +new Date(a.date) - +new Date(b.date))
    return pts.map((p, i) => ({ start: p.date, end: i + 1 < pts.length ? pts[i + 1].date : end, price: p.price }))
  }

  // ---- drag bars ----
  const startBarDrag = (e: React.MouseEvent, key: string, mode: 'move' | 'l' | 'r') => {
    e.preventDefault(); e.stopPropagation()
    const idx = phases.findIndex(p => p.key === key)
    const snap = phases.map(p => ({ start: p.start, end: p.end }))
    const ax = e.clientX, w = trackW(); let moved = false
    const mv = (ev: MouseEvent) => {
      moved = true; const dd = pxToDays(ev.clientX - ax, w)
      setPhases(prev => prev.map((p, j) => {
        if (j === idx) {
          if (mode === 'move') return { ...p, start: addDays(snap[idx].start!, dd), end: addDays(snap[idx].end!, dd) }
          if (mode === 'r') { let ne = addDays(snap[idx].end!, dd); if (new Date(ne) <= new Date(p.start!)) ne = addDays(p.start!, 1); return { ...p, end: ne } }
          let ns = addDays(snap[idx].start!, dd); if (new Date(ns) >= new Date(p.end!)) ns = addDays(p.end!, -1); return { ...p, start: ns }
        }
        if (cascade && (mode === 'move' || mode === 'r') && j > idx && snap[j].start) return { ...p, start: addDays(snap[j].start!, dd), end: addDays(snap[j].end!, dd) }
        return p
      }))
    }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) touch() }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }

  // ---- track empty: unscheduled -> draw, else new keyframe ----
  const onTrackDown = (e: React.MouseEvent, key: string) => {
    const t = e.target as HTMLElement
    if (t.closest('.lc-bar') || t.closest('.lc-kf')) return
    const tr = e.currentTarget as HTMLElement, rect = tr.getBoundingClientRect(), ax = e.clientX
    const startP = Math.max(0, Math.min(100, (ax - rect.left) / rect.width * 100))
    const p = phases.find(x => x.key === key)!
    if (!p.start) {
      const s = isoAt(startP); let moved = false
      setPhases(prev => prev.map(x => x.key === key ? { ...x, start: s, end: addDays(s, 1) } : x))
      const mv = (ev: MouseEvent) => {
        moved = true; let pp = Math.max(0, Math.min(100, (ev.clientX - rect.left) / rect.width * 100)); let ne = isoAt(pp); if (new Date(ne) <= new Date(s)) ne = addDays(s, 1)
        setPhases(prev => prev.map(x => x.key === key ? { ...x, end: ne } : x))
      }
      const up = (ev: MouseEvent) => {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); touch()
        if (!moved) { setPhases(prev => prev.map(x => x.key === key ? { ...x, end: addDays(s, 30) } : x)); setPop({ kind: 'phase', key, x: ev.clientX, y: ev.clientY }) }
      }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
    } else {
      const up = (ev: MouseEvent) => { document.removeEventListener('mouseup', up); if (Math.abs(ev.clientX - ax) < 4) setPop({ kind: 'kfnew', phase: key, date: isoAt(startP), x: ev.clientX, y: ev.clientY }) }
      document.addEventListener('mouseup', up)
    }
  }

  const startKfDrag = (e: React.MouseEvent, id: number) => {
    e.preventDefault(); e.stopPropagation()
    const tr = (e.currentTarget as HTMLElement).closest('.lc-track') as HTMLElement, rect = tr.getBoundingClientRect(), ax = e.clientX; let moved = false
    const mv = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientX - ax) < 4) return; moved = true
      const pp = Math.max(0, Math.min(100, (ev.clientX - rect.left) / rect.width * 100))
      setKfs(prev => prev.map(k => k.id === id ? { ...k, date: isoAt(pp) } : k))
    }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) touch(); else { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPop({ kind: 'kf', id, x: r.left, y: r.bottom }) } }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
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
    <div className="mt-2 border border-indigo-200 rounded-lg bg-white p-3" style={{ fontFamily: 'Arial, sans-serif' }}>
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
          const hasPx = PRICE_PHASES.includes(p.key) && p.start
          const rowKfs = kfs.filter(k => k.phase === p.key)
          return (
            <div key={p.key} className="flex border-b border-gray-100" style={{ minHeight: hasPx ? 54 : 44 }}>
              <div className="flex-none border-r border-gray-200 flex items-center gap-2" style={{ width: 180, padding: '6px 12px', fontSize: 11.5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color, flex: '0 0 auto' }} /><span>{p.name}</span>
              </div>
              <div className="lc-track relative flex-1" style={{ height: hasPx ? 54 : 44, cursor: 'copy' }} onMouseDown={e => onTrackDown(e, p.key)}>
                {/* bar / emptyhint */}
                {p.start && p.end ? (
                  <div className="lc-bar" onMouseDown={e => startBarDrag(e, p.key, (e.target as HTMLElement).dataset.h as any || 'move')}
                    style={{ position: 'absolute', top: 16, left: pct(p.start) + '%', width: (pct(p.end) - pct(p.start)) + '%', height: 16, borderRadius: 6, background: p.color, color: '#fff', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'grab', whiteSpace: 'nowrap' }}>
                    <span data-h="l" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 9, cursor: 'ew-resize' }} />
                    {fmtM(p.start)} → {fmtM(p.end)}
                    <span data-h="r" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 9, cursor: 'ew-resize' }} />
                  </div>
                ) : (
                  <div style={{ position: 'absolute', left: 8, right: 8, top: 16, height: 16, border: '1px dashed #e2e2e6', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#bfbfc4', pointerEvents: 'none' }}>＋ 拖拽创建 / 单击设日期</div>
                )}
                {/* price inline */}
                {hasPx && PSEGS.map((sg, i) => {
                  const s = sg.start > p.start! ? sg.start : p.start!, e = sg.end < p.end! ? sg.end : p.end!
                  if (new Date(s) >= new Date(e)) return null
                  return <div key={i} style={{ position: 'absolute', top: 36, left: pct(s) + '%', width: (pct(e) - pct(s)) + '%', height: 11, borderRadius: 4, background: '#eef5ef', border: '1px solid #cfe3d4', color: '#3f8a5c', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>€{sg.price}</div>
                })}
                {/* keyframes */}
                {rowKfs.map(k => {
                  const t = TYPES[k.type] ?? TYPES.win
                  return <div key={k.id} className="lc-kf" title={`${t.icon} ${k.title}`} onMouseDown={e => startKfDrag(e, k.id)}
                    style={{ position: 'absolute', top: 1, left: pct(k.date) + '%', width: 16, height: 16, borderRadius: '50%', background: t.color, color: '#fff', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, transform: 'translateX(-50%)', cursor: 'grab', zIndex: 6 }}>{t.icon}</div>
                })}
                <div style={{ position: 'absolute', left: tx + '%', top: 0, bottom: 0, width: 2, background: '#f0617c', zIndex: 5 }} />
              </div>
            </div>
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
function panelStyle(x: number, y: number): React.CSSProperties {
  const w = 270, h = 250
  let left = Math.min(window.innerWidth - w - 10, Math.max(10, x - 100))
  let top = y + 10; if (top + h > window.innerHeight - 10) top = Math.max(10, y - h - 10)
  return { position: 'fixed', left, top, zIndex: 60, width: w, background: '#fff', border: '1px solid #ececef', borderRadius: 12, boxShadow: '0 10px 36px rgba(0,0,0,.2)', padding: 14, fontSize: 12 }
}
const lbl = 'block text-[10px] text-gray-500 mt-2 mb-0.5'
const inp = 'w-full border border-gray-300 rounded-md px-2 py-1 text-xs'

function PhasePopup({ p, x, y, cascade, onSave, onClose }: { p: Phase; x: number; y: number; cascade: boolean; onSave: (s: string, e: string, casc: boolean) => void; onClose: () => void }) {
  const [s, setS] = useState(p.start ?? ''); const [e, setE] = useState(p.end ?? ''); const [c, setC] = useState(cascade)
  return (
    <>
      <div className="fixed inset-0 z-50" onMouseDown={onClose} />
      <div style={panelStyle(x, y)}>
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
  return (
    <>
      <div className="fixed inset-0 z-50" onMouseDown={onClose} />
      <div style={panelStyle(x, y)}>
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
