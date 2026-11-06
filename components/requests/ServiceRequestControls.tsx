'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, Search, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { assignServiceManager, assignVa, closeAsLost, findVas, moveVa } from '@/app/(cms)/service-requests/actions'
import type { CandidateStage, VaOption } from '@/lib/service-request-fields'

// The buttons on a service request's page. The page works out who may take
// each step and only shows those; the server checks again.

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) return void toast.error(r.error)
      toast.success(done)
      after?.()
      router.refresh()
    })
  return { pending, run }
}

export function AssignManagerForm({ ticketId, managers, current }: { ticketId: string; managers: { email: string; label: string }[]; current: string | null }) {
  const [email, setEmail] = useState(current ?? '')
  const { pending, run } = useAction()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => assignServiceManager(ticketId, email), 'Service Department Manager assigned.')
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="sr-manager">Service Department Manager</Label>
        <NativeSelect id="sr-manager" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending}>
          <option value="">Pick one…</option>
          {managers.map((m) => (
            <option key={m.email} value={m.email}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
        {managers.length === 0 && <p className="text-xs text-muted-foreground">No Service Managers yet. Add them on the Access page, with their department.</p>}
      </div>
      <Button type="submit" disabled={!email || email === current || pending}>
        {pending && <Loader2 className="animate-spin" />} {current ? 'Reassign' : 'Assign'}
      </Button>
    </form>
  )
}

// Search VA Workforce's VAs (the ticket's department first) and put one
// forward for a VA request.
export function AddVaForm({ ticketId, requestId, departmentId, hasMain }: { ticketId: string; requestId: string; departmentId: string | null; hasMain: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<VaOption[] | null>(null)
  const [role, setRole] = useState<'MAIN' | 'BUFFER'>(hasMain ? 'BUFFER' : 'MAIN')
  const [searching, startSearch] = useTransition()
  const { pending, run } = useAction()

  useEffect(() => {
    if (!open) return
    const id = setTimeout(
      () =>
        startSearch(async () => {
          const r = await findVas(query, departmentId)
          setResults(r.ok ? r.data : [])
        }),
      250
    )
    return () => clearTimeout(id)
  }, [open, query, departmentId])

  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus /> Assign a VA
      </Button>
    )
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input aria-label="Search VAs" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search VA Workforce by name or email" className="pl-8" />
        </div>
        <NativeSelect aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as 'MAIN' | 'BUFFER')} className="sm:w-36">
          <option value="MAIN">Main VA</option>
          <option value="BUFFER">Buffer VA</option>
        </NativeSelect>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Close">
          <X />
        </Button>
      </div>
      {searching && !results ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Searching…
        </p>
      ) : results && results.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active VAs match.</p>
      ) : (
        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border bg-card">
          {(results ?? []).map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{v.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[v.departments.join(', ') || 'No department', v.availability?.toLowerCase().replace(/_/g, ' '), v.working ? `${v.working} started connection${v.working === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => assignVa(ticketId, { requestId, vaProfileId: v.id, role }), `${v.name} assigned.`, () => setOpen(false))}>
                {pending ? <Loader2 className="animate-spin" /> : <Check />} Assign
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Can = { manager: boolean; hr: boolean; cs: boolean }

export function CandidateActions({ candidateId, stage, name, can }: { candidateId: string; stage: CandidateStage; name: string; can: Can }) {
  const { pending, run } = useAction()
  const [asking, setAsking] = useState<'declined' | 'started' | null>(null)
  const [reason, setReason] = useState('')
  const [startDate, setStartDate] = useState('')
  const step = (s: Parameters<typeof moveVa>[1], done: string, extra?: Parameters<typeof moveVa>[2]) => run(() => moveVa(candidateId, s, extra), done, () => setAsking(null))

  if (asking === 'declined')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          step('declined', `${name}: declined.`, { reason })
        }}
        className="flex flex-col gap-1.5 sm:flex-row"
      >
        <Input aria-label="Why the client declined" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the client declined" required autoFocus />
        <Button size="sm" type="submit" variant="destructive" disabled={pending || !reason.trim()}>
          {pending && <Loader2 className="animate-spin" />} Declined
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setAsking(null)}>
          Cancel
        </Button>
      </form>
    )
  if (asking === 'started')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          step('started', `${name} started. The VA connection is made.`, { startDate })
        }}
        className="flex flex-col gap-1.5 sm:flex-row sm:items-center"
      >
        <Label htmlFor={`start-${candidateId}`} className="text-xs">
          Start date
        </Label>
        <Input id={`start-${candidateId}`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required className="sm:w-40" />
        <Button size="sm" type="submit" disabled={pending || !startDate}>
          {pending && <Loader2 className="animate-spin" />} Mark started
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setAsking(null)}>
          Cancel
        </Button>
      </form>
    )

  const buttons: React.ReactNode[] = []
  if (stage === 'VA_PREPARATION' && can.manager)
    buttons.push(
      <Button key="ra" size="sm" variant="outline" disabled={pending} onClick={() => step('toRateAgreement', `${name} moved to Rate Agreement.`)}>
        Prepared · to Rate Agreement
      </Button>
    )
  if (stage === 'RATE_AGREEMENT' && can.hr)
    buttons.push(
      <Button key="rc" size="sm" variant="outline" disabled={pending} onClick={() => step('confirmRate', `${name}: Rate Agreement confirmed.`)}>
        Confirm Rate Agreement
      </Button>
    )
  if (stage === 'KICKOFF_CALL' && can.cs)
    buttons.push(
      <Button key="ko" size="sm" variant="outline" disabled={pending} onClick={() => step('kickoffDone', `${name}: kick-off call done.`)}>
        Kick-off call done
      </Button>
    )
  if (stage === 'CONNECTION_CALL' && can.cs) {
    buttons.push(
      <Button key="acc" size="sm" variant="outline" disabled={pending} onClick={() => step('accepted', `${name}: accepted by the client.`)}>
        Client accepted
      </Button>
    )
    buttons.push(
      <Button key="dec" size="sm" variant="ghost" disabled={pending} onClick={() => setAsking('declined')}>
        Client declined
      </Button>
    )
  }
  if (stage === 'START_VA' && can.manager)
    buttons.push(
      <Button key="st" size="sm" disabled={pending} onClick={() => setAsking('started')}>
        Mark VA started
      </Button>
    )
  if ((stage === 'VA_PREPARATION' || stage === 'RATE_AGREEMENT' || stage === 'KICKOFF_CALL') && can.manager)
    buttons.push(
      <Button key="wd" size="sm" variant="ghost" disabled={pending} onClick={() => step('withdraw', `${name} withdrawn.`)}>
        Withdraw
      </Button>
    )
  if (buttons.length === 0) return null
  return <div className="flex flex-wrap items-center gap-1.5">{pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}{buttons}</div>
}

export function CloseLostForm({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const { pending, run } = useAction()
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Close as lost
      </Button>
    )
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => closeAsLost(ticketId, reason), 'Closed as lost.', () => setOpen(false))
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <Input aria-label="Why it’s closed as lost" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it won’t be filled" required autoFocus />
      <Button type="submit" size="sm" variant="destructive" disabled={pending || !reason.trim()}>
        {pending && <Loader2 className="animate-spin" />} Close as lost
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  )
}
