'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { assignRa, moveRa, saveRa } from '@/app/(cms)/rate-agreements/actions'
import { RA_BONDS, RA_BOND_LABELS, RA_STATUS_LABELS, type RaBond, type RaStatus } from '@/lib/rate-agreement-fields'

// The controls on a Rate Agreement's page and the HR table. The page works
// out who may do what; the server checks again.

export function RaAssignSelect({ id, current, people, compact }: { id: string; current: string | null; people: { email: string; name: string }[]; compact?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <NativeSelect
      aria-label="Assigned HR Specialist"
      value={current ?? ''}
      disabled={pending}
      className={compact ? 'h-8 w-44 text-xs' : 'max-w-xs'}
      onChange={(e) =>
        start(async () => {
          const r = await assignRa(id, e.target.value)
          if (!r.ok) return void toast.error(r.error)
          toast.success(e.target.value ? 'Assigned.' : 'Unassigned.')
          router.refresh()
        })
      }
    >
      <option value="">Not assigned</option>
      {people.map((p) => (
        <option key={p.email} value={p.email}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  )
}

type YesNo = '' | 'yes' | 'no'
const yn = (v: boolean | null): YesNo => (v == null ? '' : v ? 'yes' : 'no')

export function RaTermsForm({
  id,
  status,
  initial,
  hints,
  canEdit,
}: {
  id: string
  status: RaStatus
  initial: { bond: RaBond | null; nightDifferential: boolean | null; incrementalWage: boolean | null; notes: string }
  // Where each starting value came from (the contract).
  hints: { bond: string; nightDifferential: string; incrementalWage: string }
  canEdit: boolean
}) {
  const router = useRouter()
  const [bond, setBond] = useState<RaBond | ''>(initial.bond ?? '')
  const [nd, setNd] = useState<YesNo>(yn(initial.nightDifferential))
  const [iwi, setIwi] = useState<YesNo>(yn(initial.incrementalWage))
  const [notes, setNotes] = useState(initial.notes)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const waiting = status === 'WAITING'
  const disabled = pending || !canEdit

  const save = (prepare: boolean) =>
    start(async () => {
      const r = await saveRa(id, { bond: bond as RaBond, nightDifferential: nd as 'yes', incrementalWage: iwi as 'yes', notes }, prepare)
      if (!r.ok) return setError(r.error)
      setError(null)
      toast.success(prepare ? 'Rate Agreement confirmed: Prepared by HR.' : r.data.reopened ? 'Terms saved. Payroll acknowledges them again.' : 'Terms saved.')
      router.refresh()
    })

  const field = (key: string, label: string, hint: string, control: React.ReactNode) => (
    <div className="space-y-1.5">
      <Label htmlFor={`ra-${key}`}>{label}</Label>
      {control}
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save(waiting)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {field(
          'bond',
          'Training or Performance Bond',
          hints.bond,
          <NativeSelect id="ra-bond" value={bond} onChange={(e) => setBond(e.target.value as RaBond)} disabled={disabled} required>
            <option value="" disabled>
              Choose…
            </option>
            {RA_BONDS.map((b) => (
              <option key={b} value={b}>
                {RA_BOND_LABELS[b]}
              </option>
            ))}
          </NativeSelect>
        )}
        {field(
          'nd',
          'Night Differential applies',
          hints.nightDifferential,
          <NativeSelect id="ra-nd" value={nd} onChange={(e) => setNd(e.target.value as YesNo)} disabled={disabled} required>
            <option value="" disabled>
              Choose…
            </option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </NativeSelect>
        )}
        {field(
          'iwi',
          'Incremental Wage Increase applies',
          hints.incrementalWage,
          <NativeSelect id="ra-iwi" value={iwi} onChange={(e) => setIwi(e.target.value as YesNo)} disabled={disabled} required>
            <option value="" disabled>
              Choose…
            </option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </NativeSelect>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ra-notes">Notes (optional)</Label>
        <Textarea id="ra-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={disabled} rows={2} maxLength={2000} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || !bond || !nd || !iwi}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} {waiting ? 'Confirm Rate Agreement' : 'Save terms'}
          </Button>
          {waiting && <span className="text-xs text-muted-foreground">Marks it {RA_STATUS_LABELS.PREPARED}.</span>}
          {status === 'PAYROLL_ACKNOWLEDGED' && <span className="text-xs text-muted-foreground">Changing a term sends it back to Payroll.</span>}
        </div>
      )}
    </form>
  )
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// The confidential rate, hidden until asked for (it only reaches the page
// for rate viewers).
export function RevealRate({ value }: { value: number }) {
  const [shown, setShown] = useState(false)
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums">{shown ? `${usd.format(value)} an hour` : '••••'}</span>
      <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setShown(!shown)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </span>
  )
}

// One step forward. Sent to VA asks for the day it was sent.
export function RaStepForm({ id, to, label, today }: { id: string; to: RaStatus; label: string; today: string }) {
  const router = useRouter()
  const [sentOn, setSentOn] = useState(to === 'SENT_TO_VA' ? today : '')
  const [pending, start] = useTransition()
  const needsDate = to === 'SENT_TO_VA'
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await moveRa(id, to, sentOn)
          if (!r.ok) return void toast.error(r.error)
          toast.success(to === 'VA_ACKNOWLEDGED' ? 'VA acknowledged. They move on to the Kick-off Call.' : `${RA_STATUS_LABELS[to]}.`)
          router.refresh()
        })
      }}
    >
      {needsDate && (
        <div className="space-y-1.5">
          <Label htmlFor={`ra-sent-${id}`} className="text-xs">
            Date the Rate Agreement was sent
          </Label>
          <Input id={`ra-sent-${id}`} type="date" value={sentOn} max={today} onChange={(e) => setSentOn(e.target.value)} required className="w-44" />
        </div>
      )}
      <Button type="submit" disabled={pending || (needsDate && !sentOn)}>
        {pending ? <Loader2 className="animate-spin" /> : <Check />} {label}
      </Button>
    </form>
  )
}
