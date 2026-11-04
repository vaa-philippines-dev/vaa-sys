'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { confirmContractPayment, markContractSent, setLeadContract, setLeadRequestType } from '@/app/(lms)/leads/actions'
import { manilaToday } from '@/lib/customer-fields'
import { PHASE_LABELS, REQUEST_TYPE_LABELS, type LeadRequestType } from '@/lib/lead-phase-fields'

// The lead workflow's buttons (components/leads/LeadWorkflow.tsx). Each one
// changes one fact; the server works out the phase.

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, success: string | ((data: unknown) => string), after?: () => void) =>
    start(async () => {
      const result = await fn()
      if (!result.ok) return void toast.error(result.error)
      toast.success(typeof success === 'string' ? success : success(result.data))
      after?.()
      router.refresh()
    })
  return { pending, run }
}

const movedTo = (data: unknown) => {
  const phase = (data as { phase?: keyof typeof PHASE_LABELS } | null)?.phase
  return phase ? `Now in ${PHASE_LABELS[phase]}.` : 'Saved.'
}

// Regular ↔ Special Request, behind a confirmation (the CEO approves a
// Special Request outside the app).
export function RequestTypeSwitch({ customerId, current }: { customerId: string; current: LeadRequestType }) {
  const { pending, run } = useAction()
  const [confirming, setConfirming] = useState(false)
  const next: LeadRequestType = current === 'REGULAR' ? 'SPECIAL' : 'REGULAR'

  if (!confirming)
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        Change to {REQUEST_TYPE_LABELS[next]}
      </Button>
    )

  return (
    <div role="alertdialog" aria-label={`Change to ${REQUEST_TYPE_LABELS[next]}`} className="basis-full space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
      <p>
        {next === 'SPECIAL'
          ? 'Change this lead to a Special Request? The customer meets the VA first, so the lead goes straight to Customer Success Handoff and the contract and payment are confirmed after it. Only do this once the CEO has approved it.'
          : 'Change this lead back to a Regular Request? The contract and payment have to be confirmed before the Customer Success Handoff.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => setLeadRequestType(customerId, next), movedTo, () => setConfirming(false))}>
          {pending && <Loader2 className="animate-spin" />} Yes, change to {REQUEST_TYPE_LABELS[next]}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function ContractPicker({ customerId, current, choices }: { customerId: string; current: string | null; choices: { id: string; label: string }[] }) {
  const { pending, run } = useAction()
  return (
    <div className="space-y-1.5">
      <Label htmlFor="lead-contract">Contract</Label>
      <NativeSelect
        id="lead-contract"
        value={current ?? ''}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value
          run(() => setLeadContract(customerId, id), id ? 'Contract picked.' : 'Contract cleared.')
        }}
      >
        <option value="">Pick a contract…</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

export function MarkContractSent({ customerId, again }: { customerId: string; again: boolean }) {
  const { pending, run } = useAction()
  return (
    <Button disabled={pending} variant={again ? 'outline' : 'default'} onClick={() => run(() => markContractSent(customerId), movedTo)}>
      {pending ? <Loader2 className="animate-spin" /> : <Send />} {again ? 'Mark as sent again' : 'Mark contract as sent'}
    </Button>
  )
}

export function ConfirmContractForm({ customerId, paymentDate }: { customerId: string; paymentDate: string | null }) {
  const { pending, run } = useAction()
  const today = manilaToday()
  const [signedOn, setSignedOn] = useState(today)
  const [paid, setPaid] = useState(paymentDate ?? today)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => confirmContractPayment(customerId, { signedOn, paymentDate: paid }), movedTo)
      }}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="space-y-1.5">
        <Label htmlFor="signed-on">Contract signed on</Label>
        <Input id="signed-on" type="date" max={today} value={signedOn} onChange={(e) => setSignedOn(e.target.value)} required disabled={pending} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="paid-on">First payment on</Label>
        <Input id="paid-on" type="date" max={today} value={paid} onChange={(e) => setPaid(e.target.value)} required disabled={pending} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirm contract and payment
      </Button>
    </form>
  )
}
