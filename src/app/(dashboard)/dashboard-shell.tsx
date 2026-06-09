'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoutButton } from '@/components/logout-button'

type Props = {
  me: {
    displayName: string
    isAdmin: boolean
    countryIds: number[]
  }
  children: React.ReactNode
}

/**
 * Dashboard 客户端壳层 — 实现两件事：
 *  1. 侧栏（接 server 端传来的 me 信息）
 *  2. 持久挂载 PSI iframe：用户从 /psi 切到其他路由时只是 display:none
 *     iframe DOM + Chart.js 实例 + 已拉的数据都保留，再切回 /psi 瞬间显示
 */
export function DashboardShell({ me, children }: Props) {
  const pathname = usePathname()
  const isPsiRoute = pathname === '/psi'

  const avatarColor = me.isAdmin ? '#7c3aed' : '#3b82f6'
  const roleLabel = me.isAdmin ? '🌍 Admin (HQ)' : '🧑‍💼 Sales'
  const roleHint = me.isAdmin
    ? 'All countries'
    : me.countryIds.length > 0
      ? `${me.countryIds.length} ${me.countryIds.length === 1 ? 'country' : 'countries'}`
      : 'No country assigned'

  return (
    <div className="flex h-screen bg-gray-50">
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
          <Link href="/psi" className="block px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
            📦 PSI Dashboard
          </Link>

          {me.isAdmin && (
            <>
              <div className="text-xs font-semibold text-gray-400 uppercase px-3 py-2 mt-4">Admin only</div>
              {/* 没有真实路由 → 用 span 占位，避免 Next.js prefetch /admin 报 404 */}
              <span
                aria-disabled="true"
                className="block px-3 py-2 rounded-lg text-sm text-gray-400 cursor-not-allowed select-none"
              >
                ⚙️ Master Data <span className="text-xs">(coming soon)</span>
              </span>
            </>
          )}
        </nav>

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

      <main className="flex-1 overflow-auto relative">
        {/* 持久 PSI iframe：始终挂载，仅切显示。第一次进 /psi 才 src= 触发加载 */}
        <PsiIframeHolder visible={isPsiRoute} />

        {/* 其他路由的 children：仅在非 /psi 时显示 */}
        <div style={{ display: isPsiRoute ? 'none' : 'block' }} className="h-full">
          {children}
        </div>
      </main>
    </div>
  )
}

/**
 * PSI iframe 容器 — 用 lazy mount + 持久 DOM 策略：
 *  - 第一次访问 /psi 时才插入 iframe（src 触发加载）
 *  - 之后无论切到哪个路由，iframe DOM 都不卸载
 *  - 切回 /psi 时只是 display: block，状态 + 数据 100% 保留
 */
import { useEffect, useRef, useState } from 'react'

function PsiIframeHolder({ visible }: { visible: boolean }) {
  // 用 state 记录"曾经显示过"，避免初始进入 /shipments 时就预加载 iframe
  const [hasMounted, setHasMounted] = useState(visible)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (visible && !hasMounted) setHasMounted(true)
  }, [visible, hasMounted])

  if (!hasMounted) {
    return null
  }

  return (
    <iframe
      ref={iframeRef}
      src="/psi-dashboard.html"
      title="INIU PSI Dashboard"
      className="absolute inset-0 w-full h-full border-0 block bg-white"
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}
