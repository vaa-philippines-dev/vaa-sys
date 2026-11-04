'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { removeTestLead } from '@/app/(lms)/leads/actions'

// Admins, on a test lead's page only: deletes it for good after a
// confirmation. The server refuses any lead that isn't a test lead.
export function DeleteTestLead({ customerId, name }: { customerId: string; name: string }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  // On success the action redirects to the Leads table.
  const remove = () =>
    start(async () => {
      const result = await removeTestLead(customerId)
      if (result && !result.ok) toast.error(result.error)
    })

  if (!confirming)
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        <Trash2 /> Delete test lead
      </Button>
    )

  return (
    <div role="alertdialog" aria-label="Delete test lead" className="basis-full space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
      <p>
        Delete {name} for good? Its onboarding link, sample form, account, ticket and logs go with it. This can’t be undone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={pending} onClick={remove}>
          {pending && <Loader2 className="animate-spin" />} Yes, delete it
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
