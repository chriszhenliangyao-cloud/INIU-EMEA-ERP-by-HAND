import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'INIU EMEA ERP',
    template: '%s · INIU EMEA ERP',     // 子页面用 metadata.title = '需求预测' 会渲染成"需求预测 · INIU EMEA ERP"
  },
  description: 'INIU EMEA sales operations platform — shipments, demand forecast, cross-country inventory coordination',
  applicationName: 'INIU EMEA ERP',
  authors: [{ name: 'INIU EMEA' }],
  keywords: ['INIU', 'ERP', 'EMEA', 'Forecast', 'Sales', 'Shipments'],
  robots: { index: false, follow: false },  // 内部系统不被搜索引擎收录
}

export const viewport: Viewport = {
  themeColor: '#2563eb',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
