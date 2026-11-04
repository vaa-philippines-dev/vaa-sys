'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { completeHandoff } from '@/app/(cms)/customers/actions'

// Customer Success Handoff done: the CS team onboarded the customer
// officially (lib/lead-phase-fields.ts). Asks once before saving.
export function HandoffButton({ customerId, special }: { customerId: string; special: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)

  if (!confirming)
    return (
      <Button size="sm" onClick={() => setConfirming(true)}>
        <UserCheck /> Mark onboarded
      </Button>
    )

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>
        {special ? 'Mark the handoff done? This Special Request still needs its contract and payment confirmed.' : 'Mark this customer as onboarded by the CS team?'}
      </span>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await completeHandoff(customerId)
            if (!result.ok) return void toast.error(result.error)
            toast.success(special ? 'Handoff done.' : 'Customer onboarded.')
            setConfirming(false)
            router.refresh()
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />} Yes, mark it done
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  )
}
