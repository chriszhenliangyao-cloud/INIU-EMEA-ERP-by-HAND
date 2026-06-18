'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Channel = { id: number; name: string; country_id: number; sort_order: number }
const FIELDS = ['progress', 'win', 'loss', 'competitor_reaction', 'next_move', 'target', 'supports_needed'] as const
type Field = typeof FIELDS[number]
export type ReviewRow = { country_id: number; year: number; quarter: number; channel_name: string; ka_id: number | null }
  & Partial<Record<Field, string | null>>

const FRONT: [Field, string][] = [['progress', 'Progress'], ['win', 'Win'], ['loss', 'Loss'], ['competitor_reaction', 'Competitor reaction']]
const BACK: [Field, string][] = [['next_move', 'Next move'], ['target', 'Target'], ['supports_needed', 'Supports / resources needed']]

export function QuarterlyReview({
  channels, saved, year, quarter, countryCode, countryId,
}: {
  channels: Channel[]       // 来自 KA map 的渠道，仅作"首次"的起始行(只读引用)
  saved: ReviewRow[]        // 本 country×quarter 已保存的复盘行(销售自有列表)
  year: number
  quarter: number
  countryCode: string
  countryId?: number
}) {
  const supabase = useRef(createClient()).current
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  // 行列表：已保存过就用销售自有列表;否则首次从 KA map 带入起始行
  const [list, setList] = useState<{ name: string; ka_id: number | null }[]>(
    saved.length ? saved.map(r => ({ name: r.channel_name, ka_id: r.ka_id }))
                 : channels.map(c => ({ name: c.name, ka_id: c.id })),
  )
  const [data, setData] = useState<Record<string, Partial<Record<Field, string>>>>(() => {
    const m: Record<string, Partial<Record<Field, string>>> = {}
    saved.forEach(r => { m[r.channel_name] = Object.fromEntries(FIELDS.map(f => [f, r[f] ?? ''])) as any })
    return m
  })
  const savedNames = useRef(new Set(saved.map(r => r.channel_name)))

  const nextQ = quarter === 4 ? 1 : quarter + 1
  const nextY = quarter === 4 ? year + 1 : year

  const set = (name: string, field: Field, v: string) => {
    setData(p => ({ ...p, [name]: { ...p[name], [field]: v } })); setChanged(true)
  }
  const addChannel = () => {
    const name = newName.trim()
    if (!name) return
    if (list.some(r => r.name.toLowerCase() === name.toLowerCase())) { setMsg(`"${name}" already in the list`); return }
    setList(p => [...p, { name, ka_id: null }]); setChanged(true); setNewName(''); setAdding(false)
  }
  const removeRow = (name: string) => { setList(p => p.filter(r => r.name !== name)); setChanged(true); setConfirmDel(null) }

  const save = async () => {
    if (countryId == null) return
    setBusy(true)
    const rows = list.map(r => ({
      country_id: countryId, year, quarter, channel_name: r.name, ka_id: r.ka_id,
      ...Object.fromEntries(FIELDS.map(f => [f, (data[r.name]?.[f] ?? '') || null])),
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('channel_quarterly_review').upsert(rows, { onConflict: 'country_id,year,quarter,channel_name' })
    if (!error) {
      const removed = [...savedNames.current].filter(n => !list.some(r => r.name === n))
      if (removed.length) {
        await supabase.from('channel_quarterly_review').delete()
          .eq('country_id', countryId).eq('year', year).eq('quarter', quarter).in('channel_name', removed)
      }
      savedNames.current = new Set(list.map(r => r.name))
    }
    setBusy(false)
    if (error) { setMsg(`⚠️ Save failed: ${error.message}`); return }
    setChanged(false); setMsg(`Saved · ${new Date().toLocaleTimeString()}`)
  }

  // 渲染函数(非组件，避免重挂导致输入失焦)
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
            {list.map(row => (
              <tr key={row.name} className="group align-top hover:bg-gray-50/60">
                <td className="sticky left-0 bg-white group-hover:bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800 border-b border-r border-gray-100" style={{ minWidth: 120 }}>
                  {row.name}{row.ka_id == null && <span className="ml-1 text-[10px] text-blue-400" title="复盘自加(不在 KA map)">＋</span>}
                </td>
                {c.map(([f]) => (
                  <td key={f} className="border-b border-r border-gray-100 p-0">
                    <textarea value={data[row.name]?.[f] ?? ''} onChange={e => set(row.name, f, e.target.value)} rows={3}
                      className="w-full h-full min-h-[64px] resize-y bg-transparent px-2 py-1.5 text-xs text-gray-800 outline-none focus:bg-yellow-50 focus:ring-1 focus:ring-blue-300" placeholder="—" />
                  </td>
                ))}
                <td className="border-b border-gray-100 text-center align-middle">
                  <button onClick={() => setConfirmDel(row.name)} title={`Remove ${row.name}`}
                    className="opacity-0 group-hover:opacity-100 transition text-gray-300 hover:text-red-600 text-lg leading-none px-1">×</button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={c.length + 2} className="px-3 py-2 border-t border-gray-200 bg-gray-50/50">
                {adding ? (
                  <div className="flex items-center gap-2">
                    <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addChannel(); if (e.key === 'Escape') { setAdding(false); setNewName('') } }}
                      placeholder="New channel name" className="px-2 py-1 border border-gray-300 rounded text-sm" />
                    <button onClick={addChannel} disabled={!newName.trim()} className="px-3 py-1 text-sm rounded bg-blue-600 text-white disabled:opacity-50">Add</button>
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
          <button onClick={save} disabled={busy || !changed}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${changed ? 'bg-green-600 text-white hover:bg-green-700 shadow' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            {busy ? 'Saving…' : changed ? '💾 Save' : 'Saved'}
          </button>
        </div>
      </div>

      <div style={{ perspective: '2500px' }}>
        <div className="relative" style={{ transformStyle: 'preserve-3d', transition: 'transform 0.7s', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)', height: '64vh', minHeight: 420 }}>
          {renderFace('front')}
          {renderFace('back')}
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-400">渠道列表为复盘自有(增删只动本表,<strong>不影响 KA channel map</strong>,后者仅 admin 可改)。悬停行尾显示 ×。编辑后点 Save。</p>

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-1">确认删除「{confirmDel}」这一行?</h3>
            <p className="text-sm text-gray-500 mb-5">仅从本季度复盘中移除该渠道行(<strong>不影响 KA channel map</strong>)。保存后生效。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">取消</button>
              <button onClick={() => removeRow(confirmDel)} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
