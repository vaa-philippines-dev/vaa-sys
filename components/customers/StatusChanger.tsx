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
import { changeCustomerStatus } from '@/app/(cms)/customers/actions'
import { changeAccountStatus } from '@/app/(cms)/accounts/actions'
import {
  CUSTOMER_STATUSES,
  PICKABLE_ACCOUNT_STATUSES,
  REASON_REQUIRED,
  REVIEWED_STATUSES,
  STATUS_LABELS,
  isTerminal,
  manilaToday,
  type CustomerStatus,
} from '@/lib/customer-fields'
import type { SettingOptionLite } from '@/lib/settings-fields'

type Reactivatable = { id: string; name: string; status: CustomerStatus }

// One status form for customers and accounts. Every change carries a
// reason (required for Paused/Cancelled/Terminated), an effective date
// (today unless backdated, never in the future), and for terminations a
// reason from Settings. Pause/Terminate/Cancel by anyone but a CS Manager
// applies at once and waits for review.
export function StatusChanger({
  kind,
  id,
  current,
  terminationReasons,
  reviewed,
  reactivatable = [],
}: {
  kind: 'customer' | 'account'
  id: string
  current: CustomerStatus
  terminationReasons: SettingOptionLite[]
  // True when this person's pauses/terminations go to review.
  reviewed: boolean
  // Customers only: terminated/cancelled accounts that can come back too.
  reactivatable?: Reactivatable[]
}) {
  const router = useRouter()
  const choices = (kind === 'customer' ? [...CUSTOMER_STATUSES] : PICKABLE_ACCOUNT_STATUSES).filter((s) => s !== current)
  const [picked, setStatus] = useState<CustomerStatus>(choices[0])
  // After a save the current status changes; never offer it back.
  const status = choices.includes(picked) ? picked : choices[0]
  const [reason, setReason] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [terminationReasonId, setTerminationReasonId] = useState('')
  const [bringBack, setBringBack] = useState<Set<string>>(new Set(reactivatable.map((a) => a.id)))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const needsReason = REASON_REQUIRED.includes(status)
  const terminating = isTerminal(status)
  const reactivating = kind === 'customer' && isTerminal(current) && !isTerminal(status)
  const goesToReview = reviewed && REVIEWED_STATUSES.includes(status)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const base = { reason, effectiveDate, terminationReasonId: terminating ? terminationReasonId : '' }
      const result =
        kind === 'customer'
          ? await changeCustomerStatus(id, { status, ...base, reactivateAccountIds: reactivating ? [...bringBack] : [] })
          : await changeAccountStatus(id, { status: status as (typeof PICKABLE_ACCOUNT_STATUSES)[number], ...base })
      if (!result.ok) return setError(result.error)
      setError(null)
      setReason('')
      setEffectiveDate('')
      toast.success(result.data.review ? `Changed to ${STATUS_LABELS[status]}. A CS Manager will review it.` : `Status changed to ${STATUS_LABELS[status]}.`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`new-status-${id}`}>Change status to</Label>
        <NativeSelect id={`new-status-${id}`} value={status} onChange={(e) => setStatus(e.target.value as CustomerStatus)} disabled={pending}>
          {choices.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {terminating && terminationReasons.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor={`term-reason-${id}`}>Termination reason</Label>
          <NativeSelect id={`term-reason-${id}`} value={terminationReasonId} onChange={(e) => setTerminationReasonId(e.target.value)} disabled={pending}>
            <option value="">Pick a reason…</option>
            {terminationReasons
              .filter((r) => r.isActive)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
          </NativeSelect>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`status-reason-${id}`}>
          {terminating ? 'Details' : 'Reason'} {needsReason ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <Textarea id={`status-reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the status log" disabled={pending} className="min-h-14" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`status-date-${id}`}>
          Effective date <span className="font-normal text-muted-foreground">(blank = now)</span>
        </Label>
        <Input id={`status-date-${id}`} type="date" value={effectiveDate} max={manilaToday()} onChange={(e) => setEffectiveDate(e.target.value)} disabled={pending} />
      </div>
      {reactivating && reactivatable.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Bring these accounts back too</legend>
          <p className="text-xs text-muted-foreground">They go back to Pending and are marked Returning. They become Active when a VA starts.</p>
          {reactivatable.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={bringBack.has(a.id)}
                disabled={pending}
                onChange={() =>
                  setBringBack((s) => {
                    const next = new Set(s)
                    if (next.has(a.id)) next.delete(a.id)
                    else next.add(a.id)
                    return next
                  })
                }
              />
              {a.name} <span className="text-xs text-muted-foreground">({STATUS_LABELS[a.status]})</span>
            </label>
          ))}
        </fieldset>
      )}
      {goesToReview && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">This applies now and goes to a CS Manager for review.</p>}
      {kind === 'customer' && (status === 'PAUSED' || terminating) && (
        <p className="text-xs text-muted-foreground">{status === 'PAUSED' ? 'Its Active accounts are paused too.' : 'Every account not already terminated or cancelled gets this status too.'}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" />} Save status
      </Button>
    </form>
  )
}
