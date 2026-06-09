import { getCurrentUser } from '@/lib/auth/current-user'
import { DashboardShell } from './dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser()
  // buildId = Vercel 部署的 commit SHA 前 8 位（本地 dev 用 'dev'）
  // 当 buildId 变化时，PSI iframe 的 src 跟着变，React 自动 remount → 用新版本 HTML
  // 同一部署内 buildId 不变 → iframe 持久挂载，切路由不重载
  const buildId =
    (process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8)) ||
    (process.env.NEXT_PUBLIC_BUILD_ID) ||
    'dev'

  return (
    <DashboardShell
      me={{
        displayName: me.displayName,
        isAdmin: me.isAdmin,
        countryIds: me.countryIds,
      }}
      buildId={buildId}
    >
      {children}
    </DashboardShell>
  )
}
