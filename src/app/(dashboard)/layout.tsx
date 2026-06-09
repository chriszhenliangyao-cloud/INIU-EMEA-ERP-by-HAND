import { getCurrentUser } from '@/lib/auth/current-user'
import { DashboardShell } from './dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser()
  // 把 server 拿的身份信息传给 client shell，
  // client shell 负责持久挂载 PSI iframe 等需要 pathname 的逻辑
  return (
    <DashboardShell
      me={{
        displayName: me.displayName,
        isAdmin: me.isAdmin,
        countryIds: me.countryIds,
      }}
    >
      {children}
    </DashboardShell>
  )
}
