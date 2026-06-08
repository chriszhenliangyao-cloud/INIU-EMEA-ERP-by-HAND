'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils'

type Batch = {
  id: number
  file_name: string
  imported_by: string
  imported_at: string
  source_type: string
  total_rows: number
  new_count: number
  updated_count: number
  skipped_count: number
  error_count: number
  notes: string | null
  is_rolled_back: boolean
}

export function HistoryView({ batches, nameMap }: { batches: Batch[]; nameMap: Record<string, string> }) {
  const router = useRouter()
  const supabase = useRef(createClient()).current
  const [busyId, setBusyId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  const handleRollback = async (batch: Batch) => {
    if (batch.is_rolled_back) return
    if (!window.confirm(
      `Roll back batch #${batch.id}?\n\nThis will DELETE ${batch.new_count + batch.updated_count} rows imported from "${batch.file_name}".\n\nThis cannot be undone.`
    )) return
    setBusyId(batch.id)
    const { data, error } = await supabase.rpc('rollback_import_batch', { p_batch_id: batch.id })
    setBusyId(null)
    if (error) {
      setToast({ kind: 'error', msg: `Rollback failed: ${error.message}` })
      return
    }
    const r = data as any
    setToast({ kind: 'success', msg: `✓ Deleted ${r.deleted} rows from batch #${batch.id}` })
    router.refresh()
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
          <div className={`px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium border ${
            toast.kind === 'success' ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'
          }`}>
            {toast.msg}
            <button onClick={() => setToast(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      )}

      <h1 className="text-2xl font-bold text-gray-900 mb-1">🕒 Import history</h1>
      <p className="text-sm text-gray-500 mb-5">
        All shipment data imports · rollback is destructive (deletes inserted/updated rows)
      </p>

      {batches.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">📋</div>
          <div className="text-gray-700 font-medium">No imports yet</div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">File</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Imported by</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">When</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Total</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-green-700 uppercase">New</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-blue-700 uppercase">Updated</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-red-700 uppercase">Errors</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches.map(b => (
                <tr key={b.id} className={`hover:bg-gray-50 ${b.is_rolled_back ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">#{b.id}</td>
                  <td className="px-4 py-2.5 text-gray-900 font-medium truncate max-w-xs" title={b.file_name}>
                    {b.file_name}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 text-xs">
                    {nameMap[b.imported_by] ?? <span className="text-gray-400">unknown</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(b.imported_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtNum(b.total_rows)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-medium">{fmtNum(b.new_count)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-700 font-medium">{fmtNum(b.updated_count)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-700">
                    {b.error_count > 0 ? <strong>{fmtNum(b.error_count)}</strong> : <span className="text-gray-300">0</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {b.is_rolled_back
                      ? <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">Rolled back</span>
                      : <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Active</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {!b.is_rolled_back && (
                      <button
                        onClick={() => handleRollback(b)}
                        disabled={busyId === b.id}
                        className="text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50"
                      >
                        {busyId === b.id ? '...' : 'Roll back'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
