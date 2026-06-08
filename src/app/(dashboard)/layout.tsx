import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LogoutButton } from '@/components/logout-button'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // 拿当前用户的 sales_rep 信息
  const { data: rep } = await supabase
    .from('sales_rep')
    .select('id, display_name, role, color_hex')
    .eq('user_id', user.id)
    .single()

  // 拿用户能访问的国家
  const { data: countries } = await supabase
    .from('country')
    .select('id, code, name_zh, flag_emoji, region')
    .order('sort_order')

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
          <div className="text-xs font-semibold text-gray-400 uppercase px-3 py-2">销售</div>
          <Link href="/shipments" className="block px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
            📊 发货记录
          </Link>
          <Link href="/forecast" className="block px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-100">
            📈 需求预测 <span className="text-xs">（待开发）</span>
          </Link>
          <Link href="/summary" className="block px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-100">
            📋 EU 汇总 <span className="text-xs">（待开发）</span>
          </Link>

          {rep?.role === 'admin' && (
            <>
              <div className="text-xs font-semibold text-gray-400 uppercase px-3 py-2 mt-4">管理</div>
              <Link href="/admin" className="block px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-100">
                ⚙️ 主数据 <span className="text-xs">（待开发）</span>
              </Link>
            </>
          )}
        </nav>

        {/* 用户区 */}
        <div className="border-t p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
              style={{ background: rep?.color_hex || '#9ca3af' }}
            >
              {rep?.display_name?.[0] || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{rep?.display_name}</div>
              <div className="text-xs text-gray-500 truncate">
                {rep?.role === 'admin' ? '🌍 Admin' : '🧑‍💼 Sales'}
              </div>
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
