'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { removeLead } from '@/app/(lms)/leads/actions'

// Admins, on a lead's page: deletes the lead for good after a confirmation.
// A real lead also needs its name typed, since everything attached to it
// goes too; a test lead only needs the click. The server checks both again
// (lib/lead-delete.ts).
export function DeleteLead({ customerId, name, isTest }: { customerId: string; name: string; isTest: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, start] = useTransition()
  const matches = isTest || typed.trim().toLowerCase() === name.trim().toLowerCase()

  // On success the action redirects to the Leads table.
  const remove = () =>
    start(async () => {
      const result = await removeLead(customerId, isTest ? name : typed)
      if (result && !result.ok) toast.error(result.error)
    })

  if (!confirming)
    return (
      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirming(true)}>
        <Trash2 /> {isTest ? 'Delete test lead' : 'Delete lead'}
      </Button>
    )

  return (
    <div role="alertdialog" aria-label="Delete lead" className="basis-full space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
      <p>
        Delete <span className="font-medium">{name}</span> for good? Its onboarding links, form, accounts, tickets, initial bill and logs go with it. This can’t be undone.
      </p>
      {!isTest && (
        <label className="block max-w-sm space-y-1">
          <span className="text-xs text-muted-foreground">Type the lead’s name to confirm</span>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoFocus disabled={pending} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={pending || !matches} onClick={remove}>
          {pending && <Loader2 className="animate-spin" />} Yes, delete it
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setConfirming(false)
            setTyped('')
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
