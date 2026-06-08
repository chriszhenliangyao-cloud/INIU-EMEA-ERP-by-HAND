import { getCurrentUser } from '@/lib/auth/current-user'
import Link from 'next/link'
import { LogoutButton } from '@/components/logout-button'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser()

  // Avatar color: admin purple / sales blue
  const avatarColor = me.isAdmin ? '#7c3aed' : '#3b82f6'
  const roleLabel = me.isAdmin ? '🌍 Admin (HQ)' : '🧑‍💼 Sales'
  const roleHint = me.isAdmin
    ? 'All countries'
    : me.countryIds.length > 0
      ? `${me.countryIds.length} ${me.countryIds.length === 1 ? 'country' : 'countries'}`
      : 'No country assigned'

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 左侧栏 */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-5 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📦</span>
            <div>
              <div className="font-bold text-gray-900">INIU EMEA</div>
              <div className="text-xs text-gray-500">ERP System</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3">
          <div className="text-xs font-semibold text-gray-400 uppercase px-3 py-2">Sales</div>
          <Link href="/shipments" className="block px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
            📊 Shipments
          </Link>
          <Link href="/forecast" className="block px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
            📈 Demand Forecast
          </Link>

          {me.isAdmin && (
            <>
              <div className="text-xs font-semibold text-gray-400 uppercase px-3 py-2 mt-4">Admin only</div>
              <Link href="/admin/import" className="block px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
                📥 Import Data
              </Link>
              <Link href="/admin/history" className="block px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
                🕒 Import History
              </Link>
            </>
          )}
        </nav>

        {/* 用户区 */}
        <div className="border-t p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
              style={{ background: avatarColor }}
            >
              {me.displayName?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{me.displayName}</div>
              <div className="text-xs text-gray-500 truncate">{roleLabel}</div>
              <div className="text-[10px] text-gray-400 truncate">{roleHint}</div>
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
