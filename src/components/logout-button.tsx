'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()
  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }
  return (
    <button
      onClick={handleLogout}
      className="w-full text-left px-3 py-2 mt-1 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
    >
      🚪 退出登录
    </button>
  )
}
