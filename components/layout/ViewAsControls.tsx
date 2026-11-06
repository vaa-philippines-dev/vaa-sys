'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { startViewAs, stopViewAs } from '@/app/(cms)/access/actions'

// An admin's "View as" (lib/auth.ts): from a row on Access, and the button
// on the banner that ends it.
export function ViewAsButton({ email, name }: { email: string; name: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      title={`See VAA Systems as ${name} sees it (read-only)`}
      onClick={() =>
        start(async () => {
          // A redirect on success; only an error comes back.
          const r = await startViewAs(email)
          if (r && !r.ok) toast.error(r.error)
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Eye />} View as
    </Button>
  )
}

export function StopViewAsButton() {
  const [pending, start] = useTransition()
  return (
    <Button type="button" size="sm" variant="secondary" className="h-7" disabled={pending} onClick={() => start(() => stopViewAs())}>
      {pending ? <Loader2 className="animate-spin" /> : <EyeOff />} Stop viewing
    </Button>
  )
}
