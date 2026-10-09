'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * 财务账号专用登录页(邮箱 + 密码)。
 *
 * 为什么单独一页：财务的邮箱不在公司 Google 域名下，过不了主登录页的 Google 登录。
 * 这一页不在主登录页挂链接，只把地址发给财务；公司同事仍走 Google 一键登录，互不影响。
 *
 * 安全边界(都在数据库里，不靠这个页面)：
 *  - 能注册出账号的邮箱只有 @iniushop.com 和 login_exception 白名单(见 handle_new_user 触发器)
 *  - 财务角色只有「看 PO/批次 + 操作开票」的权限(RLS)，登录后侧栏只剩开票页
 *  - 账号由管理员在 Supabase 后台创建(Auto Confirm)，这里只负责登录，不提供注册/找回密码
 */
export default function FinanceLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setErr('')
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) {
      setBusy(false)
      setErr('邮箱或密码不正确')   // 统一提示，不透露账号是否存在
      return
    }
    window.location.assign('/admin/fulfillment')   // 整页跳转，确保服务端拿到刚写入的登录 cookie
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-blue-50">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full mx-4">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🧾</div>
          <h1 className="text-2xl font-bold text-gray-900">INIU EMEA ERP</h1>
          <p className="text-sm text-gray-500 mt-2">Finance · Invoicing</p>
        </div>

        <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="fin-email">Email</label>
        <input
          id="fin-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mb-4 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
          required
        />

        <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="fin-password">Password</label>
        <input
          id="fin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mb-2 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
          required
        />

        {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-3">{err}</div>}

        <button
          type="submit"
          disabled={busy}
          className="w-full mt-5 px-6 py-3 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-xs text-center text-gray-400 mt-6">
          Finance accounts only · 忘记密码请联系管理员重置
        </p>
      </form>
    </div>
  )
}
