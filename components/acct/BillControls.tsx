'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Ban, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { addPayment, deletePayment, voidBill } from '@/app/(acct)/accounting/actions'
import { PAYMENT_RECORD_METHODS, formatMoney, type Currency } from '@/lib/billing-fields'
import { manilaToday } from '@/lib/customer-fields'

// Accounting's buttons on a bill's page: record a payment, remove one
// recorded by mistake, and void a bill that went out wrong.

type Result = { ok: true; data: unknown } | { ok: false; error: string }

function useRun() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<Result>, success: string, after?: () => void) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) return void toast.error(r.error)
      toast.success(success)
      after?.()
      router.refresh()
    })
  return { pending, run }
}

export function RecordPaymentForm({ invoiceId, currency, balance, defaultMethod }: { invoiceId: string; currency: Currency; balance: number; defaultMethod: string }) {
  const { pending, run } = useRun()
  const today = manilaToday()
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : '')
  const [paidOn, setPaidOn] = useState(today)
  const [method, setMethod] = useState(defaultMethod)
  const [reference, setReference] = useState('')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => addPayment(invoiceId, { amount: Number(amount), paidOn, method, reference }), `Payment of ${formatMoney(Number(amount) || 0, currency)} recorded.`, () => {
          setReference('')
        })
      }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_10rem_10rem_minmax(0,1fr)_auto] lg:items-end"
    >
      <div className="space-y-1.5">
        <Label htmlFor="pay-amount">Amount ({currency})</Label>
        <Input id="pay-amount" type="number" inputMode="decimal" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required disabled={pending} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pay-on">Paid on</Label>
        <Input id="pay-on" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required disabled={pending} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pay-method">Method</Label>
        <NativeSelect id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={pending}>
          {PAYMENT_RECORD_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pay-ref">Reference</Label>
        <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} placeholder="Transaction ID, receipt no." disabled={pending} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} Record payment
      </Button>
    </form>
  )
}

export function RemovePayment({ paymentId, label }: { paymentId: string; label: string }) {
  const { pending, run } = useRun()
  const [confirming, setConfirming] = useState(false)
  if (!confirming)
    return (
      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirming(true)} aria-label={`Remove payment ${label}`}>
        <Trash2 />
      </Button>
    )
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => deletePayment(paymentId), 'Payment removed.')}>
        {pending && <Loader2 className="animate-spin" />} Remove
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  )
}

export function VoidBill({ invoiceId, code }: { invoiceId: string; code: string }) {
  const { pending, run } = useRun()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  if (!open)
    return (
      <Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setOpen(true)}>
        <Ban /> Void bill
      </Button>
    )
  return (
    <div role="alertdialog" aria-label={`Void ${code}`} className="basis-full space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
      <p>Void {code}? It stays on record but no longer counts, and the Lead Manager can prepare a new initial bill.</p>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why, e.g. wrong rate" maxLength={500} disabled={pending} autoFocus />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={pending || reason.trim().length < 3} onClick={() => run(() => voidBill(invoiceId, reason), `${code} is void.`, () => setOpen(false))}>
          {pending && <Loader2 className="animate-spin" />} Yes, void it
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
