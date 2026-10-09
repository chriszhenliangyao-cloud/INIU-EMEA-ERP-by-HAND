'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function LogoutButton({ compact = false }: { compact?: boolean }) {
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
      title={compact ? 'Sign out' : undefined}
      className={compact
        ? 'w-full text-center py-2 mt-1 text-base text-gray-600 hover:bg-gray-100 rounded-lg'
        : 'w-full text-left px-3 py-2 mt-1 text-sm text-gray-600 hover:bg-gray-100 rounded-lg'}
    >
      {compact ? '🚪' : '🚪 Sign out'}
    </button>
  )
}
