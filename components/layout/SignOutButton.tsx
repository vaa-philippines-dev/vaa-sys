'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SignOutButton() {
  const [busy, setBusy] = useState(false)

  const signOut = async () => {
    setBusy(true)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      await createClient().auth.signOut()
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={signOut} disabled={busy} aria-label="Sign out" title="Sign out">
      <LogOut className="h-4 w-4" />
    </Button>
  )
}
