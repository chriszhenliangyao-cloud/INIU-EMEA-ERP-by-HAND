'use client'

import { usePathname } from 'next/navigation'
import { LogoutButton } from '@/components/logout-button'
import { roleLabelFor } from '@/lib/user-flair'
import { NavLink } from './nav-link'

type Props = {
  me: {
    displayName: string
    email: string
    isAdmin: boolean
    countryIds: number[]
  }
  buildId: string
  children: React.ReactNode
}

/**
 * Dashboard 客户端壳层 — 实现两件事：
 *  1. 侧栏（接 server 端传来的 me 信息）
 *  2. 持久挂载 PSI iframe：用户从 /psi 切到其他路由时只是 display:none
 *     iframe DOM + Chart.js 实例 + 已拉的数据都保留，再切回 /psi 瞬间显示
 */
export function DashboardShell({ me, buildId, children }: Props) {
  const pathname = usePathname()
  const isPsiRoute = pathname === '/psi'

  const avatarColor = me.isAdmin ? '#7c3aed' : '#3b82f6'
  const roleLabel = roleLabelFor(me.email, me.isAdmin)
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
          {/* Shipments 与 PO 高度重合，暂时隐藏入口（页面 /shipments 仍保留，可随时恢复） */}
          <NavLink href="/po">🧾 PO (Orders)</NavLink>
          <NavLink href="/forecast">📈 Demand Forecast</NavLink>
          <NavLink href="/psi">📦 PSI Dashboard</NavLink>
          <NavLink href="/performance">🏆 Performance</NavLink>

          {me.isAdmin && (
            <>
              <div className="text-xs font-semibold text-gray-400 uppercase px-3 py-2 mt-4">Admin only</div>
              <NavLink href="/admin/sku">⚙️ SKU Master Data</NavLink>
              <NavLink href="/admin/sales">👤 Sales Reps</NavLink>
              <NavLink href="/admin/ka">🗺️ KA Channel Map</NavLink>
              <NavLink href="/admin/sku/map">🧬 SKU Product Map</NavLink>
              <NavLink href="/admin/forecast-log">📋 Forecast Activity</NavLink>
              {/* TODO: Country 管理 */}
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
        <PsiIframeHolder visible={isPsiRoute} buildId={buildId} />

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

function PsiIframeHolder({ visible, buildId }: { visible: boolean; buildId: string }) {
  // 用 state 记录"曾经显示过"，避免初始进入 /shipments 时就预加载 iframe
  const [hasMounted, setHasMounted] = useState(visible)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (visible && !hasMounted) setHasMounted(true)
  }, [visible, hasMounted])

  if (!hasMounted) {
    return null
  }

  // 把 buildId 拼进 src + 设到 React key 上：
  //  - 同一部署内 buildId 不变 → src 不变 → iframe 持久（切路由不重载）
  //  - 新部署 buildId 变 → src 变 + key 变 → React remount → 自动用新版 HTML（不用关 tab）
  const src = `/psi-dashboard.html?v=${buildId}`
  return (
    <iframe
      key={buildId}
      ref={iframeRef}
      src={src}
      title="INIU PSI Dashboard"
      className="absolute inset-0 w-full h-full border-0 block bg-white"
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}
