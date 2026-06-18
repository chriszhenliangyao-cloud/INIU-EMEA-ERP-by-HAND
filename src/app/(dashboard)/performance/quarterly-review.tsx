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
  channels, reviews, year, quarter, countryCode,
}: {
  channels: Channel[]
  reviews: Record<number, Review>
  year: number
  quarter: number
  countryCode: string
}) {
  const supabase = useRef(createClient()).current
  const [flipped, setFlipped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<number>>(new Set())
  const [data, setData] = useState<Record<number, Review>>(() => {
    const m: Record<number, Review> = {}
    channels.forEach(c => { m[c.id] = { ...(reviews[c.id] ?? {}), ka_id: c.id } })
    return m
  })

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
    if (error) { setSavedAt(`⚠️ Save failed: ${error.message}`); return }
    setDirty(new Set())
    setSavedAt(`Saved ${rows.length} channel${rows.length === 1 ? '' : 's'} · ${new Date().toLocaleTimeString()}`)
  }

  // 一个面（正/背）共用渲染：传不同列集
  const Face = ({ which }: { which: 'front' | 'back' }) => {
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
            </tr>
          </thead>
          <tbody>
            {channels.map(ch => (
              <tr key={ch.id} className="align-top">
                <td className="sticky left-0 bg-white px-3 py-2 text-sm font-medium text-gray-800 border-b border-r border-gray-100" style={{ minWidth: 120 }}>{ch.name}</td>
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
              </tr>
            ))}
            {!channels.length && <tr><td colSpan={c.length + 1} className="py-12 text-center text-gray-400">No channels for this country</td></tr>}
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
          {savedAt && <span className="text-xs text-gray-500">{savedAt}</span>}
          <button onClick={save} disabled={saving || !dirty.size}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${dirty.size ? 'bg-green-600 text-white hover:bg-green-700 shadow' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            {saving ? 'Saving…' : dirty.size ? `💾 Save (${dirty.size})` : 'Saved'}
          </button>
        </div>
      </div>

      {/* 翻转卡片（翻黑板效果）*/}
      <div style={{ perspective: '2500px' }}>
        <div className="relative" style={{ transformStyle: 'preserve-3d', transition: 'transform 0.7s', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)', height: '64vh', minHeight: 420 }}>
          <Face which="front" />
          <Face which="back" />
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-400">Edit then click Save (RLS: you can only edit your own country). Yellow = editing in progress.</p>
    </div>
  )
}
