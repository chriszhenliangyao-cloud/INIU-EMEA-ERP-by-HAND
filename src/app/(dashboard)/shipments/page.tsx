import { redirect } from 'next/navigation'

// 旧 Shipments 板块已停用（与 PO 高度重合）：直接跳到 /po。
// 页面组件 shipments-view.tsx 仍保留，将来要恢复只需还原本文件。
export default function ShipmentsPage() {
  redirect('/po')
}
