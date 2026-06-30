'use client'

/**
 * Forecast Activity — 销售填报监控（admin only）
 *
 * 日志节点 = 一次 Save（同一人同一事务时间戳的格子级变更聚为一个批次）
 *  - 批次行：时间 · 人 · 国家 · run · +新增 ~修改 -删除 统计
 *  - 展开：格子级明细（KA / SKU / 月份 / 旧值 → 新值）
 *  - 监控卡：每个销售的负责国家 / 当前 run 进度 / 最近活动 / 今日·本周次数
 *  - 默认隐藏系统动作（rollover 预填等 changed_by 为空的批次）
 */

import { useMemo, useState } from 'react'

type LogRow = {
  id: number
  changed_at: string
  changed_by: string | null
  op: string            // I / U / D
  run_id: number
  sku_id: number
  ka_id: number
  month: string
  old_qty: number | null
  new_qty: number | null
}

type Rep = { id: number; user_id: string | null; display_name: string; role: string; is_active: boolean }
type Ka = { id: number; name: string; country_id: number }
type Sku = { id: number; code: string }
type Run = { id: number; code: string; period_start: string; status: string }
type Country = { id: number; code: string; flag_emoji: string }

type Props = {
  logs: LogRow[]
  reps: Rep[]
  repCountries: { sales_rep_id: number; country_id: number }[]
  kas: Ka[]
  skus: Sku[]
  runs: Run[]
  countries: Country[]
  latestRunId: number | null
  progressByCountry: Record<number, { confirmed: number; pending: number }>
  viewerName: string
}

// 相对时间（hover 显示精确时间）
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}
const fmtTs = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Paris' }) + ' (CET)'

export function ForecastLogView({
  logs, reps, repCountries, kas, skus, runs, countries, latestRunId, progressByCountry, viewerName,
}: Props) {
  const [repFilter, setRepFilter] = useState<string>('ALL')
  const [countryFilter, setCountryFilter] = useState<string>('ALL')
  const [runFilter, setRunFilter] = useState<string>('ALL')
  const [days, setDays] = useState<number>(7)
  const [showSystem, setShowSystem] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(50)

  // ── lookup maps ──
  const repByUid = useMemo(() => {
    const m: Record<string, Rep> = {}
    reps.forEach(r => { if (r.user_id) m[r.user_id] = r })
    return m
  }, [reps])
  const kaById = useMemo(() => Object.fromEntries(kas.map(k => [k.id, k])), [kas])
  const skuById = useMemo(() => Object.fromEntries(skus.map(s => [s.id, s.code])), [skus])
  const runById = useMemo(() => Object.fromEntries(runs.map(r => [r.id, r.code])), [runs])
  const countryById = useMemo(() => Object.fromEntries(countries.map(c => [c.id, c])), [countries])

  // ── 批次分组：同一人 + 同一事务时间戳 = 一次 Save ──
  type Batch = {
    key: string
    changed_at: string
    changed_by: string | null
    actor: string
    run_id: number
    countryCodes: string[]
    rows: LogRow[]
    ins: number; upd: number; del: number
  }
  const batches = useMemo<Batch[]>(() => {
    const m = new Map<string, Batch>()
    logs.forEach(l => {
      const key = `${l.changed_by ?? 'system'}|${l.changed_at}`
      let b = m.get(key)
      if (!b) {
        b = {
          key, changed_at: l.changed_at, changed_by: l.changed_by,
          actor: l.changed_by ? (repByUid[l.changed_by]?.display_name ?? 'Unknown user') : 'System',
          run_id: l.run_id, countryCodes: [], rows: [], ins: 0, upd: 0, del: 0,
        }
        m.set(key, b)
      }
      b.rows.push(l)
      if (l.op === 'I') b.ins++
      else if (l.op === 'D') b.del++
      else b.upd++
      const cid = kaById[l.ka_id]?.country_id
      const code = cid != null ? countryById[cid]?.code : undefined
      if (code && !b.countryCodes.includes(code)) b.countryCodes.push(code)
    })
    return Array.from(m.values()).sort((a, b) => b.changed_at.localeCompare(a.changed_at))
  }, [logs, repByUid, kaById, countryById])

  // ── 筛选 ──
  const filtered = useMemo(() => {
    const cutoff = Date.now() - days * 86400000
    return batches.filter(b => {
      if (!showSystem && b.changed_by === null) return false
      if (repFilter !== 'ALL' && b.changed_by !== repFilter) return false
      if (runFilter !== 'ALL' && String(b.run_id) !== runFilter) return false
      if (countryFilter !== 'ALL' && !b.countryCodes.includes(countryFilter)) return false
      if (new Date(b.changed_at).getTime() < cutoff) return false
      return true
    })
  }, [batches, repFilter, countryFilter, runFilter, days, showSystem])

  // ── 监控卡数据（按 sales rep）──
  const cards = useMemo(() => {
    const now = Date.now()
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    return reps
      .filter(r => r.role === 'sales' && r.is_active)
      .map(r => {
        const myCountryIds = repCountries.filter(rc => rc.sales_rep_id === r.id).map(rc => rc.country_id)
        const myBatches = batches.filter(b => b.changed_by !== null && b.changed_by === r.user_id)
        const last = myBatches[0]?.changed_at ?? null
        const todayN = myBatches.filter(b => new Date(b.changed_at) >= dayStart).length
        const weekN = myBatches.filter(b => now - new Date(b.changed_at).getTime() < 7 * 86400000).length
        let confirmed = 0, pending = 0
        myCountryIds.forEach(cid => {
          confirmed += progressByCountry[cid]?.confirmed ?? 0
          pending += progressByCountry[cid]?.pending ?? 0
        })
        return { rep: r, countryIds: myCountryIds, last, todayN, weekN, confirmed, pending }
      })
  }, [reps, repCountries, batches, progressByCountry])

  const toggle = (key: string) => setExpanded(prev => {
    const s = new Set(prev)
    s.has(key) ? s.delete(key) : s.add(key)
    return s
  })

  const OP_STYLE: Record<string, string> = { I: 'text-green-700', U: 'text-blue-700', D: 'text-red-700' }

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">📋 Forecast Activity</h1>
        <span className="text-xs text-gray-500">Signed in as {viewerName} · 1 row = 1 save batch</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        销售填报监控 · 日志来自 forecast_cell_audit_log（trigger 自动记录，不可篡改）
      </p>

      {/* 监控卡 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {cards.map(({ rep, countryIds, last, todayN, weekN, confirmed, pending }) => (
          <div key={rep.id} className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">
                {rep.display_name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{rep.display_name}</div>
                <div className="text-[10px] text-gray-400">
                  {countryIds.map(cid => countryById[cid]?.flag_emoji ?? '').join(' ') || '无国家'}
                </div>
              </div>
            </div>
            <div className="text-xs space-y-0.5">
              <div className="flex justify-between">
                <span className="text-gray-500">最近填写</span>
                {last
                  ? <span className="text-gray-800" title={fmtTs(last)}>{relTime(last)}</span>
                  : <span className="text-red-500 font-medium">尚未开始</span>}
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">今日 / 本周</span>
                <span className="text-gray-800 tabular-nums">{todayN} / {weekN} 次</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">当前周期</span>
                <span className="tabular-nums" title="人工 = 销售亲手填/改过的格子；预填 = 上期带入后未动过">
                  <span className="text-gray-900 font-medium">{confirmed}</span>
                  <span className="text-gray-400"> 人工 · </span>
                  <span className="text-gray-400">{pending} 预填</span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-2 flex-wrap mb-3 text-sm">
        <select value={repFilter} onChange={e => setRepFilter(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded bg-white text-sm">
          <option value="ALL">All people</option>
          {reps.filter(r => r.user_id).map(r => (
            <option key={r.id} value={r.user_id!}>{r.display_name}</option>
          ))}
        </select>
        <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded bg-white text-sm">
          <option value="ALL">All countries</option>
          {countries.map(c => <option key={c.id} value={c.code}>{c.flag_emoji} {c.code}</option>)}
        </select>
        <select value={runFilter} onChange={e => setRunFilter(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded bg-white text-sm">
          <option value="ALL">All cycles</option>
          {runs.map(r => <option key={r.id} value={String(r.id)}>{r.code}</option>)}
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="px-2 py-1 border border-gray-300 rounded bg-white text-sm">
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={365}>All loaded</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 ml-2 cursor-pointer">
          <input type="checkbox" checked={showSystem} onChange={e => setShowSystem(e.target.checked)} />
          显示系统动作（rollover 预填等）
        </label>
        <span className="ml-auto text-xs text-gray-400">{filtered.length} save batches</span>
      </div>

      {/* 批次日志 */}
      <div className="bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.05)] rounded-2xl divide-y">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-gray-400 text-sm">该筛选条件下没有填报记录</div>
        )}
        {filtered.slice(0, shown).map(b => (
          <div key={b.key}>
            <button
              onClick={() => toggle(b.key)}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 text-left"
            >
              <span className="text-gray-400 text-xs w-4">{expanded.has(b.key) ? '▼' : '▶'}</span>
              <span className="text-xs text-gray-500 w-20 flex-shrink-0" title={fmtTs(b.changed_at)}>
                {relTime(b.changed_at)}
              </span>
              <span className={`text-sm font-medium w-32 truncate flex-shrink-0 ${b.changed_by ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                {b.actor}
              </span>
              <span className="text-xs text-gray-500 w-20 flex-shrink-0">
                {b.countryCodes.map(c => countryById[countries.find(x => x.code === c)?.id ?? -1]?.flag_emoji ?? c).join(' ')}
                <span className="ml-1">{b.countryCodes.join('/')}</span>
              </span>
              <span className="text-xs text-gray-400 flex-shrink-0">{runById[b.run_id] ?? `run#${b.run_id}`}</span>
              <span className="ml-auto text-xs tabular-nums flex-shrink-0">
                <span className="text-gray-600 font-medium">{b.rows.length} cells</span>
                {b.ins > 0 && <span className="text-green-700 ml-2">+{b.ins}</span>}
                {b.upd > 0 && <span className="text-blue-700 ml-2">~{b.upd}</span>}
                {b.del > 0 && <span className="text-red-700 ml-2">-{b.del}</span>}
              </span>
            </button>

            {expanded.has(b.key) && (
              <div className="px-11 pb-3">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="text-gray-400 text-left">
                      <th className="py-1 pr-4 font-medium">KA</th>
                      <th className="py-1 pr-4 font-medium">SKU</th>
                      <th className="py-1 pr-4 font-medium">Month</th>
                      <th className="py-1 font-medium text-right">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows
                      .slice()
                      .sort((x, y) => (kaById[x.ka_id]?.name ?? '').localeCompare(kaById[y.ka_id]?.name ?? '') || (skuById[x.sku_id] ?? '').localeCompare(skuById[y.sku_id] ?? ''))
                      .map(l => (
                        <tr key={l.id} className="border-t border-gray-100">
                          <td className="py-1 pr-4 text-gray-700">{kaById[l.ka_id]?.name ?? `ka#${l.ka_id}`}</td>
                          <td className="py-1 pr-4 font-mono text-gray-700">{skuById[l.sku_id] ?? `sku#${l.sku_id}`}</td>
                          <td className="py-1 pr-4 text-gray-500">{l.month?.slice(0, 7)}</td>
                          <td className={`py-1 text-right tabular-nums font-medium ${OP_STYLE[l.op] ?? 'text-gray-700'}`}>
                            {l.op === 'I' && <>+ {l.new_qty}</>}
                            {l.op === 'U' && <>{l.old_qty} → {l.new_qty}</>}
                            {l.op === 'D' && <><s>{l.old_qty}</s> 删除</>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length > shown && (
        <button
          onClick={() => setShown(s => s + 50)}
          className="mt-3 w-full py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg border border-blue-200"
        >
          Load more ({filtered.length - shown} remaining)
        </button>
      )}
    </div>
  )
}
