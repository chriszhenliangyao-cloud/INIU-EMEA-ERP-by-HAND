'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Channel = { id: number; name: string; country_id: number; sort_order: number }
export type Review = {
  ka_id: number
  progress?: string | null; win?: string | null; loss?: string | null; competitor_reaction?: string | null
  next_move?: string | null; target?: string | null; supports_needed?: string | null
}
type Field = keyof Omit<Review, 'ka_id'>

const FRONT: [Field, string][] = [['progress', 'Progress'], ['win', 'Win'], ['loss', 'Loss'], ['competitor_reaction', 'Competitor reaction']]
const BACK: [Field, string][] = [['next_move', 'Next move'], ['target', 'Target'], ['supports_needed', 'Supports / resources needed']]

export function QuarterlyReview({
  channels, reviews, year, quarter, countryCode, countryId,
}: {
  channels: Channel[]
  reviews: Record<number, Review>
  year: number
  quarter: number
  countryCode: string
  countryId?: number
}) {
  const supabase = useRef(createClient()).current
  const [flipped, setFlipped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<number>>(new Set())
  const [channelList, setChannelList] = useState<Channel[]>(channels)
  const [data, setData] = useState<Record<number, Review>>(() => {
    const m: Record<number, Review> = {}
    channels.forEach(c => { m[c.id] = { ...(reviews[c.id] ?? {}), ka_id: c.id } })
    return m
  })
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirmDel, setConfirmDel] = useState<{ id: number; name: string } | null>(null)

  const nextQ = quarter === 4 ? 1 : quarter + 1
  const nextY = quarter === 4 ? year + 1 : year

  const set = (kaId: number, field: Field, v: string) => {
    setData(p => ({ ...p, [kaId]: { ...p[kaId], [field]: v } }))
    setDirty(p => new Set(p).add(kaId))
  }

  const save = async () => {
    if (!dirty.size) return
    setSaving(true)
    const rows = [...dirty].map(kaId => ({
      ka_id: kaId, year, quarter,
      progress: data[kaId].progress ?? null, win: data[kaId].win ?? null,
      loss: data[kaId].loss ?? null, competitor_reaction: data[kaId].competitor_reaction ?? null,
      next_move: data[kaId].next_move ?? null, target: data[kaId].target ?? null,
      supports_needed: data[kaId].supports_needed ?? null, updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('channel_quarterly_review').upsert(rows, { onConflict: 'ka_id,year,quarter' })
    setSaving(false)
    if (error) { setMsg(`⚠️ Save failed: ${error.message}`); return }
    setDirty(new Set()); setMsg(`Saved ${rows.length} channel${rows.length === 1 ? '' : 's'} · ${new Date().toLocaleTimeString()}`)
  }

  const addChannel = async () => {
    const name = newName.trim()
    if (!name || countryId == null) return
    setBusy(true)
    const { data: row, error } = await supabase.from('ka')
      .insert({ name, country_id: countryId, ka_type: 'retailer' })
      .select('id, name, country_id, sort_order').single()
    setBusy(false)
    if (error || !row) { setMsg(`⚠️ Add failed: ${error?.message}`); return }
    setChannelList(p => [...p, row as Channel])
    setData(d => ({ ...d, [row.id]: { ka_id: row.id } }))
    setNewName(''); setAdding(false); setMsg(`Channel "${name}" added`)
  }

  const doDelete = async () => {
    if (!confirmDel) return
    setBusy(true)
    const { error } = await supabase.from('ka').update({ is_active: false }).eq('id', confirmDel.id)
    setBusy(false)
    if (error) { setMsg(`⚠️ Remove failed: ${error.message}`); setConfirmDel(null); return }
    setChannelList(p => p.filter(c => c.id !== confirmDel.id))
    setMsg(`Channel "${confirmDel.name}" removed (deactivated)`); setConfirmDel(null)
  }

  // 渲染函数（不是组件！避免每次 setState 重挂导致 textarea 失焦）
  const renderFace = (which: 'front' | 'back') => {
    const c = which === 'front' ? FRONT : BACK
    return (
      <div className="absolute inset-0 overflow-auto rounded-xl border border-gray-200 bg-white"
           style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: which === 'back' ? 'rotateY(180deg)' : undefined }}>
        <div className={`sticky top-0 z-10 px-4 py-2.5 text-sm font-semibold border-b border-gray-200 ${which === 'front' ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'}`}>
          {which === 'front' ? `📝 Quarter Progress — ${countryCode} ${year} Q${quarter}` : `📋 Action Plan — ${countryCode} ${nextY} Q${nextQ}`}
        </div>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b border-r border-gray-200" style={{ minWidth: 120 }}>Channel</th>
              {c.map(([, label]) => <th key={label} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase border-b border-r border-gray-200">{label}</th>)}
              <th className="w-8 border-b border-gray-200" />
            </tr>
          </thead>
          <tbody>
            {channelList.map(ch => (
              <tr key={ch.id} className="group align-top hover:bg-gray-50/60">
                <td className="sticky left-0 bg-white group-hover:bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800 border-b border-r border-gray-100" style={{ minWidth: 120 }}>{ch.name}</td>
                {c.map(([f]) => (
                  <td key={f} className="border-b border-r border-gray-100 p-0">
                    <textarea
                      value={data[ch.id]?.[f] ?? ''}
                      onChange={e => set(ch.id, f, e.target.value)}
                      rows={3}
                      className="w-full h-full min-h-[64px] resize-y bg-transparent px-2 py-1.5 text-xs text-gray-800 outline-none focus:bg-yellow-50 focus:ring-1 focus:ring-blue-300"
                      placeholder="—"
                    />
                  </td>
                ))}
                {/* 行尾删除 × —— 悬停该行才出现 */}
                <td className="border-b border-gray-100 text-center align-middle">
                  <button onClick={() => setConfirmDel({ id: ch.id, name: ch.name })}
                    title={`Remove ${ch.name}`}
                    className="opacity-0 group-hover:opacity-100 transition text-gray-300 hover:text-red-600 text-lg leading-none px-1">×</button>
                </td>
              </tr>
            ))}
            {/* + Add channel 行（两面都有）*/}
            <tr>
              <td colSpan={c.length + 2} className="px-3 py-2 border-t border-gray-200 bg-gray-50/50">
                {adding ? (
                  <div className="flex items-center gap-2">
                    <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addChannel(); if (e.key === 'Escape') { setAdding(false); setNewName('') } }}
                      placeholder="New channel name" className="px-2 py-1 border border-gray-300 rounded text-sm" />
                    <button onClick={addChannel} disabled={busy || !newName.trim()} className="px-3 py-1 text-sm rounded bg-blue-600 text-white disabled:opacity-50">Add</button>
                    <button onClick={() => { setAdding(false); setNewName('') }} className="px-3 py-1 text-sm rounded border border-gray-300">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setAdding(true)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">＋ Add channel</button>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <button onClick={() => setFlipped(f => !f)}
          className="px-3 py-1.5 rounded-md text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 hover:border-blue-400 transition flex items-center gap-1.5">
          <span className="text-base">⟳</span> Flip to {flipped ? 'Progress' : 'Action Plan'}
        </button>
        <span className="text-xs text-gray-400">{flipped ? `背面：下季 (${nextY} Q${nextQ}) 行动计划` : `正面：本季 (${year} Q${quarter}) 复盘`}</span>
        <div className="ml-auto flex items-center gap-3">
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
          <button onClick={save} disabled={saving || !dirty.size}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${dirty.size ? 'bg-green-600 text-white hover:bg-green-700 shadow' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            {saving ? 'Saving…' : dirty.size ? `💾 Save (${dirty.size})` : 'Saved'}
          </button>
        </div>
      </div>

      {/* 翻转卡片（翻黑板效果）*/}
      <div style={{ perspective: '2500px' }}>
        <div className="relative" style={{ transformStyle: 'preserve-3d', transition: 'transform 0.7s', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)', height: '64vh', minHeight: 420 }}>
          {renderFace('front')}
          {renderFace('back')}
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-400">Edit then Save (RLS: only your own country). Hover a row's end to reveal ×. Removing a channel deactivates it (keeps history, hides from forecast/PSI).</p>

      {/* 二次确认卡片 */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-1">确认删除「{confirmDel.name}」这一行?</h3>
            <p className="text-sm text-gray-500 mb-5">该渠道将被停用(从预测 / PSI / 复盘中隐藏,历史数据保留,可由 admin 恢复)。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} disabled={busy} className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">取消</button>
              <button onClick={doDelete} disabled={busy} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">{busy ? '处理中…' : '确认删除'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
