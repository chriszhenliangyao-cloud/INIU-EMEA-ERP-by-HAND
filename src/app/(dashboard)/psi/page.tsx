import { getCurrentUser } from '@/lib/auth/current-user'

/**
 * /psi 路由 — 实际 iframe 在 DashboardShell 持久挂载（避免切路由时重新加载）。
 * 这个 page 只做两件事：
 *   1. 触发 getCurrentUser → 未登录跳到 /auth/login
 *   2. 占一个空 placeholder 让 Next.js 知道路由存在（实际 UI 由 shell 提供）
 */
export default async function PsiPage() {
  await getCurrentUser()
  return null
}

export const metadata = {
  title: 'PSI Dashboard',
}
