'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resolveReview } from '@/app/(cms)/approvals/actions'

// Confirm or Cancel (revert) a pending status change.
export function ReviewButtons({ kind, id }: { kind: 'customer' | 'account'; id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const act = (decision: 'CONFIRM' | 'CANCEL') => {
    if (decision === 'CANCEL' && !window.confirm('Cancel this change and put the previous status back?')) return
    start(async () => {
      const result = await resolveReview(kind, id, decision)
      if (!result.ok) return void toast.error(result.error)
      toast.success(decision === 'CONFIRM' ? 'Confirmed.' : 'Cancelled. The previous status is back.')
      router.refresh()
    })
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" disabled={pending} onClick={() => act('CONFIRM')}>
        {pending ? <Loader2 className="animate-spin" /> : <Check />} Confirm
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => act('CANCEL')}>
        <Undo2 /> Cancel change
      </Button>
    </div>
  )
}
