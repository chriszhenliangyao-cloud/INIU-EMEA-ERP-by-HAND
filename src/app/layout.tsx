import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'INIU EMEA ERP',
  description: '欧洲市场销售管理系统',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
