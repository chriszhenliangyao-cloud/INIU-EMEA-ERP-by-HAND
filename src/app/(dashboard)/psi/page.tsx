import { getCurrentUser } from '@/lib/auth/current-user'

/**
 * /psi 路由 — PSI Dashboard
 *
 * 实现策略：iframe 嵌入 public/psi-dashboard.html（原 Google Apps Script 看板 1:1 复刻），
 * 数据源从 google.script.run 改成 fetch('/api/psi/load-all')，RLS 自动按国家过滤。
 *
 * 为什么用 iframe：
 *  - 原 2400 行 vanilla JS + Chart.js + 插件无需改写
 *  - 视觉 100% 还原（CSS 完整保留）
 *  - 隔离 React，避免和 ERP 全局样式冲突
 */
export default async function PsiPage() {
  const me = await getCurrentUser()  // 触发未登录 → redirect

  return (
    <div className="h-screen w-full bg-white">
      <iframe
        src="/psi-dashboard.html"
        title="INIU PSI Dashboard"
        className="w-full h-full border-0 block"
        // 同源 iframe 自动带 cookie → 内部 fetch('/api/psi/load-all') 走 user session
      />
    </div>
  )
}

export const metadata = {
  title: 'PSI Dashboard',
}
