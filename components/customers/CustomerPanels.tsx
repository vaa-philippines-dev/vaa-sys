'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { addNote, assignSpecialist, updateCustomer } from '@/app/(cms)/customers/actions'
import { manilaDateTime, manilaToday } from '@/lib/customer-fields'

// The editable panels on a customer's page in Customer Management.

export function CustomerEditForm({
  customerId,
  initial,
}: {
  customerId: string
  initial: { name: string; email: string | null; notes: string | null; noPaymentYet: boolean; paymentDate: string | null }
}) {
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [email, setEmail] = useState(initial.email ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [noPaymentYet, setNoPaymentYet] = useState(initial.noPaymentYet)
  const [paymentDate, setPaymentDate] = useState(initial.paymentDate ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const result = await updateCustomer(customerId, { name, email, notes, noPaymentYet, paymentDate: noPaymentYet ? '' : paymentDate })
          if (!result.ok) return setError(result.error)
          setError(null)
          toast.success('Saved.')
          router.refresh()
        })
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="c-name">Name</Label>
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required disabled={pending} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-email">Email</Label>
        <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">First payment</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={noPaymentYet} onChange={(e) => setNoPaymentYet(e.target.checked)} disabled={pending} />
          No payment yet
        </label>
        {!noPaymentYet && <Input type="date" aria-label="Payment date" value={paymentDate} max={manilaToday()} onChange={(e) => setPaymentDate(e.target.value)} required disabled={pending} />}
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="c-notes">Notes</Label>
        <Textarea id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={pending} className="min-h-14" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" />} Save details
      </Button>
    </form>
  )
}

export function SpecialistSelect({ customerId, current, team }: { customerId: string; current: string | null; team: { email: string; name: string }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const known = !current || team.some((t) => t.email === current)
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        aria-label="CS Specialist"
        value={current ?? ''}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const result = await assignSpecialist(customerId, e.target.value)
            if (!result.ok) return void toast.error(result.error)
            toast.success(e.target.value ? 'CS Specialist assigned.' : 'CS Specialist removed.')
            router.refresh()
          })
        }
      >
        <option value="">Unassigned</option>
        {!known && <option value={current!}>{current} (no longer on the team)</option>}
        {team.map((t) => (
          <option key={t.email} value={t.email}>
            {t.name}
          </option>
        ))}
      </NativeSelect>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  )
}

type Note = { id: string; body: string; createdByEmail: string; createdAt: Date; accountLabel?: string | null }

// Customer notes, or an account's notes with its customer's mixed in
// (legacy CustomerAccountNotes).
export function NotesPanel({ customerId, accountId, notes, canAdd }: { customerId: string; accountId: string | null; notes: Note[]; canAdd: boolean }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [pending, start] = useTransition()

  return (
    <div className="space-y-3">
      {canAdd && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
              const result = await addNote(customerId, accountId, { body })
              if (!result.ok) return void toast.error(result.error)
              setBody('')
              router.refresh()
            })
          }}
          className="space-y-2"
        >
          <Textarea aria-label="New note" value={body} onChange={(e) => setBody(e.target.value)} placeholder={accountId ? 'A note about this account' : 'A note about this customer'} disabled={pending} className="min-h-14" />
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            {pending && <Loader2 className="animate-spin" />} Add note
          </Button>
        </form>
      )}
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl border bg-card p-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {n.createdAt.toLocaleString('en-PH', manilaDateTime)} · {n.createdByEmail}
                {n.accountLabel !== undefined && <> · {n.accountLabel ?? 'Customer note'}</>}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
