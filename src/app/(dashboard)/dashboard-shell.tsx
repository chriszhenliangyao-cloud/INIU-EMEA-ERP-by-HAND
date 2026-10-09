'use client'

import { usePathname, useRouter } from 'next/navigation'
import { LogoutButton } from '@/components/logout-button'
import { roleLabelFor } from '@/lib/user-flair'
import { NavLink } from './nav-link'

type Props = {
  me: {
    displayName: string
    email: string
    isAdmin: boolean
    isFinance: boolean
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
  const router = useRouter()
  const isPsiRoute = pathname === '/psi'

  // 财务账号只开放「履约看板 · 开票」一页:去别的页面一律带回来(数据层另有 RLS 兜底,这里只是不让她看到空壳页面)
  const FINANCE_HOME = '/admin/fulfillment'
  useEffect(() => {
    if (me.isFinance && pathname !== FINANCE_HOME) router.replace(FINANCE_HOME)
  }, [me.isFinance, pathname, router])

  // 侧栏可收起成图标窄栏；状态记在本机浏览器里，下次打开保持。首屏先按展开渲染，挂载后再读取，避免水合不一致。
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem('sidebar-collapsed') === '1') setCollapsed(true) } catch { /* 隐私模式等读不到就保持展开 */ }
  }, [])
  const toggleSidebar = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0') } catch { /* 写不进去只是不记忆 */ }
  }
  const toggleButton = (
    <button
      onClick={toggleSidebar}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? '展开侧边栏' : '收起侧边栏'}
      className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-black/[0.05] transition-colors"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        {collapsed ? <path d="M14 9l3 3-3 3" /> : <path d="M17 9l-3 3 3 3" />}
      </svg>
    </button>
  )

  const avatarColor = me.isAdmin ? '#7c3aed' : me.isFinance ? '#059669' : '#3b82f6'
  const roleLabel = me.isFinance ? '🧾 Finance' : roleLabelFor(me.email, me.isAdmin)
  const roleHint = me.isFinance
    ? 'Invoicing only'
    : me.isAdmin
    ? 'All countries'
    : me.countryIds.length > 0
      ? `${me.countryIds.length} ${me.countryIds.length === 1 ? 'country' : 'countries'}`
      : 'No country assigned'

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <aside className={`${collapsed ? 'w-[60px]' : 'w-60'} shrink-0 bg-white border-r border-black/[0.06] flex flex-col overflow-hidden transition-[width] duration-200`}>
        <div className={`border-b border-black/[0.06] ${collapsed ? 'p-3 flex justify-center' : 'p-5'}`}>
          {collapsed ? (
            toggleButton
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-2xl">📦</span>
                <div>
                  <div className="font-semibold text-[15px] text-gray-900 tracking-tight leading-tight">INIU EMEA</div>
                  <div className="text-xs text-gray-400">ERP System</div>
                </div>
              </div>
              {toggleButton}
            </div>
          )}
        </div>

        <nav className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${collapsed ? 'p-2' : 'p-3'}`}>
          {me.isFinance ? (
            <NavLink collapsed={collapsed} href="/admin/fulfillment">🧾 开票 · 财务</NavLink>
          ) : (
          <>
          {!collapsed && <div className="text-[11px] font-semibold text-gray-400 px-3 py-2">Sales</div>}
          {/* Shipments 与 PO 高度重合，暂时隐藏入口（页面 /po 仍保留，可随时恢复） */}
          <NavLink collapsed={collapsed} href="/po">🧾 PO (Orders)</NavLink>
          <NavLink collapsed={collapsed} href="/forecast">📈 Demand Forecast</NavLink>
          <NavLink collapsed={collapsed} href="/psi">📦 PSI Dashboard</NavLink>
          <NavLink collapsed={collapsed} href="/performance">🏆 Performance</NavLink>
          {/* SKU 主数据对销售只读开放（写操作 UI 隐藏 + RLS 仅 admin 可写） */}
          <NavLink collapsed={collapsed} href="/admin/sku">⚙️ Logistic & Stock</NavLink>

          {me.isAdmin && (
            <>
              {collapsed ? (
                <div className="my-2 border-t border-black/[0.06]" />
              ) : (
                <div className="text-[11px] font-semibold text-gray-400 px-3 py-2 mt-4">Admin only</div>
              )}
              <NavLink collapsed={collapsed} href="/admin/po-shipment">🚚 Shipment Workflow</NavLink>
              <NavLink collapsed={collapsed} href="/admin/fulfillment">📋 履约看板 · 单据/交期/开票</NavLink>
              <NavLink collapsed={collapsed} href="/admin/sales">👤 Sales Reps</NavLink>
              <NavLink collapsed={collapsed} href="/admin/ka">🗺️ KA Channel Map</NavLink>
              <NavLink collapsed={collapsed} href="/admin/sku/map">🧬 SKU Product Map</NavLink>
              <NavLink collapsed={collapsed} href="/admin/forecast-log">📋 Forecast Activity</NavLink>
              {/* TODO: Country 管理 */}
            </>
          )}
        </>
          )}
        </nav>

        <div className={`border-t border-black/[0.06] ${collapsed ? 'p-2' : 'p-3'}`}>
          <div
            className={`flex items-center ${collapsed ? 'justify-center py-2' : 'gap-3 px-2 py-2'}`}
            title={collapsed ? `${me.displayName} · ${roleLabel}` : undefined}
          >
            <div
              className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
              style={{ background: avatarColor }}
            >
              {me.displayName?.[0]?.toUpperCase() ?? '?'}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{me.displayName}</div>
                <div className="text-xs text-gray-500 truncate">{roleLabel}</div>
                <div className="text-[10px] text-gray-400 truncate">{roleHint}</div>
              </div>
            )}
          </div>
          <LogoutButton compact={collapsed} />
        </div>
      </aside>

      <main className="flex-1 overflow-auto relative">
        {/* 持久 PSI iframe：始终挂载，仅切显示。第一次进 /psi 才 src= 触发加载 */}
        <PsiIframeHolder visible={isPsiRoute} buildId={buildId} />

        {/* 其他路由的 children：仅在非 /psi 时显示 */}
        <div style={{ display: isPsiRoute ? 'none' : 'block' }} className="h-full">
          {me.isFinance && pathname !== FINANCE_HOME ? null : children}
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
  // 用 state 记录"曾经显示过"，避免初始进入 /po 时就预加载 iframe
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
