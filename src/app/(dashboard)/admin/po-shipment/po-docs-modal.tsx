'use client'

// 单个 PO 的文档归档面板：箱唛 / 送货单 / 装箱单 / POD / 发票。
// 文件本体存 Supabase Storage(bucket 'po-docs')，元数据存 po_document 表；均 admin-only(RLS)。
// 打开 = 现取签名 URL（private 桶），新标签页预览/下载。

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

const BUCKET = 'po-docs'
type DocType = 'po_original' | 'carton_label' | 'delivery_note' | 'packing_list' | 'pod' | 'invoice'
type Doc = { id: number; doc_type: DocType; file_name: string; storage_path: string; mime: string | null; size_bytes: number | null; notes: string | null; created_at: string }

// 六类单据 + 履约阶段分组
const SECTIONS: { type: DocType; label: string; icon: string; phase: string }[] = [
  { type: 'po_original',   label: 'PO 原件 (Original PO)', icon: '📑', phase: 'Order 下单' },
  { type: 'carton_label',  label: 'Carton Label 箱唛',   icon: '🏷️', phase: 'Pre-ship 发货前' },
  { type: 'delivery_note', label: 'Delivery Note 送货单', icon: '📄', phase: 'Pre-ship 发货前' },
  { type: 'packing_list',  label: 'Packing List 装箱单',  icon: '📦', phase: 'Pre-ship 发货前' },
  { type: 'pod',           label: 'POD 签收证明',         icon: '✍️', phase: 'Post-delivery 送达后' },
  { type: 'invoice',       label: 'Invoice 发票',         icon: '🧾', phase: 'Post-delivery 送达后' },
]

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
const fmtSize = (b: number | null) => b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`
const fileIcon = (mime: string | null, name: string) => {
  const n = name.toLowerCase()
  if (mime?.includes('pdf') || n.endsWith('.pdf')) return '📕'
  if (mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/.test(n)) return '🖼️'
  if (/\.(xlsx?|csv)$/.test(n) || mime?.includes('sheet') || mime?.includes('excel')) return '📗'
  if (/\.docx?$/.test(n) || mime?.includes('word')) return '📘'
  return '📎'
}

export function PoDocsModal({ poNumber, onClose, onChanged }: { poNumber: string; onClose: () => void; onChanged?: () => void }) {
  const supabase = useRef(createClient()).current
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)   // 'up:carton_label' / 'del:12'
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('po_document')
      .select('id, doc_type, file_name, storage_path, mime, size_bytes, notes, created_at')
      .eq('po_number', poNumber).order('created_at', { ascending: true })
    if (error) setErr(error.message)
    setDocs((data as Doc[]) ?? [])
    setLoading(false)
  }, [poNumber, supabase])

  useEffect(() => { load() }, [load])

  const upload = async (type: DocType, files: FileList | null) => {
    if (!files?.length) return
    setErr(null); setBusy(`up:${type}`)
    for (const file of Array.from(files)) {
      const path = `${sanitize(poNumber)}/${type}/${Date.now()}-${sanitize(file.name)}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (upErr) { setErr(`上传失败: ${upErr.message}`); setBusy(null); return }
      const { error: dbErr } = await supabase.from('po_document').insert({
        po_number: poNumber, doc_type: type, file_name: file.name, storage_path: path,
        mime: file.type || null, size_bytes: file.size,
      })
      if (dbErr) { await supabase.storage.from(BUCKET).remove([path]); setErr(`保存记录失败: ${dbErr.message}`); setBusy(null); return }
    }
    setBusy(null); await load(); onChanged?.()
  }

  const openDoc = async (d: Doc) => {
    setBusy(`open:${d.id}`)
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 3600)
    setBusy(null)
    if (error || !data) { setErr(`打开失败: ${error?.message}`); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const del = async (d: Doc) => {
    if (!confirm(`删除「${d.file_name}」？此操作不可撤销。`)) return
    setBusy(`del:${d.id}`)
    await supabase.storage.from(BUCKET).remove([d.storage_path])
    const { error } = await supabase.from('po_document').delete().eq('id', d.id)
    setBusy(null)
    if (error) { setErr(`删除失败: ${error.message}`); return }
    await load(); onChanged?.()
  }

  const byType = (t: DocType) => docs.filter(d => d.doc_type === t)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[680px] p-5 max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-lg font-semibold text-gray-900">📎 PO Documents · <span className="font-mono text-base">{poNumber}</span></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-400 mb-3">按单据类型归档该 PO 的所有文件。文件私有存储，仅你可见；点文件名新标签打开预览/下载。</div>

        {err && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-3">
          {loading ? <div className="text-center text-gray-300 py-10">加载中…</div> : SECTIONS.map((sec, i) => {
            const list = byType(sec.type)
            const upKey = `up:${sec.type}`
            const showPhase = i === 0 || SECTIONS[i - 1].phase !== sec.phase
            return (
              <div key={sec.type}>
                {showPhase && <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mt-1 mb-1.5">{sec.phase}</div>}
                <div className="border border-gray-200 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-gray-800">{sec.icon} {sec.label}
                      <span className="ml-1.5 text-xs text-gray-400">({list.length})</span>
                    </div>
                    <label className={`shrink-0 px-2.5 py-1 text-xs rounded-md cursor-pointer transition ${busy === upKey ? 'bg-gray-100 text-gray-400' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}>
                      {busy === upKey ? '上传中…' : '＋ 上传'}
                      <input type="file" multiple className="hidden" disabled={!!busy}
                        onChange={e => { upload(sec.type, e.target.files); e.target.value = '' }} />
                    </label>
                  </div>
                  {list.length === 0 ? (
                    <div className="text-xs text-gray-300 py-1.5">暂无文件</div>
                  ) : (
                    <div className="space-y-1">
                      {list.map(d => (
                        <div key={d.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 group">
                          <span className="text-base">{fileIcon(d.mime, d.file_name)}</span>
                          <button onClick={() => openDoc(d)} disabled={busy === `open:${d.id}`}
                            className="flex-1 min-w-0 text-left text-sm text-gray-700 hover:text-indigo-600 truncate" title="点击打开">
                            {busy === `open:${d.id}` ? '打开中…' : d.file_name}
                          </button>
                          <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">{fmtSize(d.size_bytes)}</span>
                          <span className="text-[11px] text-gray-300 shrink-0 whitespace-nowrap">{d.created_at.slice(0, 10)}</span>
                          <button onClick={() => del(d)} disabled={busy === `del:${d.id}`}
                            className="shrink-0 text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition text-sm" title="删除">🗑</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-between items-center mt-4">
          <span className="text-xs text-gray-400">{docs.length} 个文件 · 私有存储</span>
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">关闭</button>
        </div>
      </div>
    </div>
  )
}
