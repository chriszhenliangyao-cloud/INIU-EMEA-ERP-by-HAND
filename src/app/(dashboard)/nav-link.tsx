'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useTransition } from 'react'

/**
 * 侧栏导航链接 —— 解决「点击后画面冻结、不知道在不在加载」的问题。
 *
 * App Router 默认导航会等目标页面在服务端渲染完才切换，期间无任何反馈。
 * 这里用 useTransition 捕获导航 pending 状态：点击后保持旧页面可见，
 * 被点的菜单项立刻显示加载圆圈，直到新页面就绪 —— 体感丝滑。
 *
 * 同时 useEffect 里 prefetch，保留 <Link> 的预取加速（router.push 本身不预取）。
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const active = pathname === href

  useEffect(() => {
    router.prefetch(href)
  }, [href, router])

  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (pathname === href) return
        startTransition(() => router.push(href))
      }}
      className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm hover:bg-gray-100 ${
        active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-700'
      }`}
    >
      <span className="truncate">{children}</span>
      {pending && (
        <span
          aria-label="loading"
          className="ml-2 shrink-0 w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"
        />
      )}
    </a>
  )
}
