'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ExternalLink, FileText, Loader2, Mail, Save, Send, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/leads/OnboardingLinkPanel'
import { InvoiceLines } from '@/components/billing/InvoiceLines'
import { InvoiceStatusBadge } from '@/components/billing/InvoiceStatusBadge'
import { discardInitialBill, prepareInitialBill, saveInitialBill, sendInitialBill } from '@/app/(lms)/leads/actions'
import { CURRENCIES, CURRENCY_LABELS, computeBill, formatMoney, invoiceEmail, type Currency, type DraftBillInput } from '@/lib/billing-fields'
import { SCHEDULE_LABELS } from '@/lib/onboarding-fields'
import { manilaDate, manilaDateTime } from '@/lib/customer-fields'
import type { InitialBillView, InvoiceView } from '@/lib/billing-view'

// Contract & Billing Initiation's Initial Billing section (lead page). The
// Lead Manager prepares the bill from the lead's service requests, checks
// each VA's rate and hours, adds any CEO-approved discounts and free hours,
// and marks it sent with the email below. After that it's read-only here;
// Accounting records the payments in the Accounting System.

const when = (iso: string) => new Date(iso).toLocaleString('en-PH', manilaDateTime)
const day = (s: string) => new Date(`${s}T00:00:00+08:00`).toLocaleDateString('en-PH', manilaDate)

export function InitialBill({
  customerId,
  customerName,
  senderName,
  hasRequests,
  canEdit,
  bill,
}: {
  customerId: string
  customerName: string
  senderName: string
  hasRequests: boolean
  canEdit: boolean
  bill: InitialBillView
}) {
  const inv = bill.invoice
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Initial billing</h2>
          <p className="text-sm text-muted-foreground">
            The first bill, from the service requests on the onboarding form: One-Time Fee per department, deposit per VA, and the first (partial) month of service.
          </p>
        </div>
        {inv && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{inv.code}</span>
            <InvoiceStatusBadge status={inv.status} />
          </div>
        )}
      </div>

      {!inv ? (
        <EmptyBill customerId={customerId} hasRequests={hasRequests} canEdit={canEdit} defaults={bill.defaults} />
      ) : inv.status === 'DRAFT' && canEdit ? (
        <DraftEditor key={inv.id} customerId={customerId} customerName={customerName} senderName={senderName} inv={inv} />
      ) : (
        <SentBill inv={inv} customerName={customerName} senderName={senderName} canOpenAccounting={bill.canOpenAccounting} />
      )}

      {bill.voided.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {bill.voided.length} void bill{bill.voided.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {bill.voided.map((v) => (
              <li key={v.id}>
                <span className="font-mono text-xs">{v.code}</span> · {formatMoney(v.total, v.currency)}
                {v.voidedAt && ` · voided ${when(v.voidedAt)}`}
                {v.voidReason && ` · ${v.voidReason}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function EmptyBill({ customerId, hasRequests, canEdit, defaults }: { customerId: string; hasRequests: boolean; canEdit: boolean; defaults: InitialBillView['defaults'] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (!hasRequests)
    return <p className="text-sm text-muted-foreground">No service requests yet. The initial bill is made from the requests on the customer’s onboarding form.</p>
  if (!canEdit) return <p className="text-sm text-muted-foreground">Not prepared yet.</p>
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm">
      <p className="text-muted-foreground">
        Starts from the default rates and fees: One-Time Fee {formatMoney(defaults.otf, 'USD')}, deposit {formatMoney(defaults.deposit, 'USD')} per VA, night differential {defaults.ndPercent}%.
      </p>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await prepareInitialBill(customerId)
            if (!r.ok) return void toast.error(r.error)
            toast.success('Initial bill drafted. Check the rates and hours.')
            router.refresh()
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <FileText />} Prepare initial bill
      </Button>
    </div>
  )
}

// Numbers are kept as typed (strings) and read as numbers for the preview.
type ItemState = { id: string; hourlyRate: string; hours: string; ndHours: string; freeHours: string; freeHoursRef: string; depositDiscountPercent: string; depositApprovalRef: string }
type DeptState = { department: string; discountPercent: string; approvalRef: string }
const num = (s: string) => {
  const v = Number(s)
  return s.trim() === '' || Number.isNaN(v) ? 0 : v
}
const str = (v: number) => String(Number(v.toFixed(2)))

function DraftEditor({ customerId, customerName, senderName, inv }: { customerId: string; customerName: string; senderName: string; inv: InvoiceView }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [currency, setCurrency] = useState<Currency>(inv.currency)
  const [applyVat, setApplyVat] = useState(inv.applyVat)
  const [applyPaypalFee, setApplyPaypalFee] = useState(inv.applyPaypalFee)
  const [notes, setNotes] = useState(inv.notes ?? '')
  const [items, setItems] = useState<ItemState[]>(
    inv.items.map((i) => ({
      id: i.id,
      hourlyRate: str(i.hourlyRate),
      hours: str(i.hours),
      ndHours: str(i.ndHours),
      freeHours: str(i.freeHours),
      freeHoursRef: i.freeHoursRef ?? '',
      depositDiscountPercent: str(i.depositDiscountPercent),
      depositApprovalRef: i.depositApprovalRef ?? '',
    }))
  )
  const [depts, setDepts] = useState<DeptState[]>(inv.departments.map((d) => ({ department: d.department, discountPercent: str(d.discountPercent), approvalRef: d.approvalRef ?? '' })))
  const [confirming, setConfirming] = useState<'send' | 'discard' | null>(null)

  const setItem = (id: string, patch: Partial<ItemState>) => setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const setDept = (department: string, patch: Partial<DeptState>) => setDepts((all) => all.map((d) => (d.department === department ? { ...d, ...patch } : d)))

  const input: DraftBillInput = {
    currency,
    applyVat,
    applyPaypalFee,
    notes,
    items: items.map((i) => ({
      id: i.id,
      hourlyRate: num(i.hourlyRate),
      hours: num(i.hours),
      ndHours: num(i.ndHours),
      freeHours: num(i.freeHours),
      freeHoursRef: i.freeHoursRef,
      depositDiscountPercent: num(i.depositDiscountPercent),
      depositApprovalRef: i.depositApprovalRef,
    })),
    departments: depts.map((d) => ({ department: d.department, discountPercent: num(d.discountPercent), approvalRef: d.approvalRef })),
  }

  // The same maths the server saves, run as the Lead Manager types.
  const preview = useMemo(() => {
    const byId = new Map(inv.items.map((i) => [i.id, i]))
    return computeBill(
      { ...inv.settings, applyVat, applyPaypalFee },
      items.map((s) => {
        const i = byId.get(s.id)!
        return {
          lineNo: i.lineNo,
          service: i.service,
          department: i.department,
          scheduleType: i.scheduleType,
          numberOfVas: i.numberOfVas,
          hourlyRate: num(s.hourlyRate),
          hours: num(s.hours),
          ndHours: num(s.ndHours),
          freeHours: num(s.freeHours),
          freeHoursRef: s.freeHoursRef || null,
          depositDiscountPercent: num(s.depositDiscountPercent),
          depositApprovalRef: s.depositApprovalRef || null,
        }
      }),
      inv.departments.map((d) => {
        const s = depts.find((x) => x.department === d.department)
        return { department: d.department, exempt: d.exempt, discountPercent: s ? num(s.discountPercent) : 0, approvalRef: s?.approvalRef || null }
      }),
      currency
    )
  }, [inv, items, depts, applyVat, applyPaypalFee, currency])

  const email = invoiceEmail({
    customerName,
    senderName,
    code: inv.code,
    currency,
    lines: preview.lines,
    subtotal: preview.subtotal,
    vatAmount: preview.vatAmount,
    vatPercent: inv.settings.vatPercent,
    paypalFeeAmount: preview.paypalFeeAmount,
    paypalPercent: inv.settings.paypalPercent,
    total: preview.total,
  })
  const to = inv.account?.invoiceContactEmail ?? inv.customer.email ?? ''
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`

  const run = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, success: string) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) return void toast.error(r.error)
      toast.success(success)
      setConfirming(null)
      router.refresh()
    })

  const field = 'h-8 w-24 text-right tabular-nums'
  const money = (v: number) => formatMoney(v, currency)

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="bill-currency">Currency</Label>
          <NativeSelect id="bill-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} disabled={pending}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={applyVat} onChange={(e) => setApplyVat(e.target.checked)} disabled={pending} />
          VAT {inv.settings.vatPercent}% (Israeli client)
        </label>
        <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={applyPaypalFee} onChange={(e) => setApplyPaypalFee(e.target.checked)} disabled={pending} />
          PayPal fee {inv.settings.paypalPercent}%
        </label>
      </div>
      {currency !== 'USD' && <p className="text-xs text-warning">Rates and fees aren’t converted: check that they’re in {currency} before sending.</p>}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">VA requests</h3>
        {inv.items.map((i) => {
          const s = items.find((x) => x.id === i.id)!
          return (
            <div key={i.id} className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {i.service}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {i.department} · {SCHEDULE_LABELS[i.scheduleType]} · {i.numberOfVas} VA{i.numberOfVas === 1 ? '' : 's'}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {i.periodEnd ? `${day(i.periodStart)} to ${day(i.periodEnd)}` : `Starts ${day(i.periodStart)}`}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">Prefilled from the request: {i.hoursBasis}.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumberField label={`Hourly rate (${currency})`} value={s.hourlyRate} onChange={(v) => setItem(i.id, { hourlyRate: v })} className={field} disabled={pending} warn={num(s.hourlyRate) <= 0 ? 'No rate yet' : undefined} />
                <NumberField label={i.numberOfVas > 1 ? 'Hours per VA' : 'Hours billed'} value={s.hours} onChange={(v) => setItem(i.id, { hours: v })} className={field} disabled={pending} />
                <NumberField
                  label={i.numberOfVas > 1 ? 'ND hours per VA' : 'Night differential hours'}
                  value={s.ndHours}
                  onChange={(v) => setItem(i.id, { ndHours: v })}
                  className={field}
                  disabled={pending || i.scheduleType !== 'DAILY_FIXED'}
                  hint={i.scheduleType === 'DAILY_FIXED' ? '10 PM–6 AM PH time' : 'Flexible: approved ND goes on the next bill'}
                />
                <div className="space-y-1.5">
                  <Label className="text-xs">Free hours</Label>
                  <NativeSelect className="h-8" value={['0', '10', '20'].includes(s.freeHours) ? s.freeHours : '0'} onChange={(e) => setItem(i.id, { freeHours: e.target.value })} disabled={pending}>
                    <option value="0">None</option>
                    <option value="10">10 hours</option>
                    <option value="20">20 hours</option>
                  </NativeSelect>
                </div>
              </div>
              {num(s.freeHours) > 0 && (
                <RefField label="Promo or agreement for the free hours" value={s.freeHoursRef} onChange={(v) => setItem(i.id, { freeHoursRef: v })} disabled={pending} />
              )}
              <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
                <NumberField label="Deposit discount %" value={s.depositDiscountPercent} onChange={(v) => setItem(i.id, { depositDiscountPercent: v })} className={field} disabled={pending} hint="100 waives it" />
                {num(s.depositDiscountPercent) > 0 && (
                  <RefField label="CEO approval (email, date…)" value={s.depositApprovalRef} onChange={(v) => setItem(i.id, { depositApprovalRef: v })} disabled={pending} />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">One-Time Fee by department</h3>
        <div className="divide-y rounded-xl border">
          {inv.departments.map((d) => {
            const s = depts.find((x) => x.department === d.department)!
            return (
              <div key={d.department} className="grid gap-3 p-4 sm:grid-cols-[10rem_auto_minmax(0,1fr)] sm:items-end">
                <div className="text-sm">
                  <p className="font-medium">{d.department}</p>
                  <p className="text-xs text-muted-foreground">{d.exempt ? 'Project-based only: no OTF' : money(inv.settings.otf)}</p>
                </div>
                {!d.exempt && (
                  <>
                    <NumberField label="Discount %" value={s.discountPercent} onChange={(v) => setDept(d.department, { discountPercent: v })} className={field} disabled={pending} hint="100 waives it" />
                    {num(s.discountPercent) > 0 ? <RefField label="CEO approval (email, date…)" value={s.approvalRef} onChange={(v) => setDept(d.department, { approvalRef: v })} disabled={pending} /> : <span />}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bill-notes">Notes for Accounting</Label>
        <Textarea id="bill-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={pending} placeholder="Anything Accounting should know (holidays left out, agreed terms…)" />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">The bill</h3>
          {preview.foregone > 0 && <p className="text-xs text-muted-foreground">Foregone Revenue: {money(preview.foregone)}</p>}
        </div>
        <InvoiceLines
          lines={preview.lines}
          currency={currency}
          subtotal={preview.subtotal}
          vatAmount={preview.vatAmount}
          vatPercent={inv.settings.vatPercent}
          paypalFeeAmount={preview.paypalFeeAmount}
          paypalPercent={inv.settings.paypalPercent}
          total={preview.total}
        />
      </div>

      {confirming === 'send' && (
        <div role="alertdialog" aria-label="Send the initial bill" className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <p className="font-medium">Send this email to {to || 'the customer'}, then mark the bill as sent.</p>
          <div className="rounded-lg border bg-card p-3">
            <p className="mb-2">
              <span className="text-muted-foreground">Subject: </span>
              {email.subject}
            </p>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{email.body}</pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={`Subject: ${email.subject}\n\n${email.body}`} label="Copy email" />
            <a href={mailto} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Mail /> Open in email app
            </a>
          </div>
          <p className="text-xs text-muted-foreground">Once marked sent, the bill can’t be changed here. If it turns out wrong, Accounting voids it and you prepare a new one.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => sendInitialBill(customerId, inv.id, input), `${inv.code} marked as sent.`)}>
              {pending ? <Loader2 className="animate-spin" /> : <Send />} Mark bill as sent
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
              Back to editing
            </Button>
          </div>
        </div>
      )}

      {confirming === 'discard' && (
        <div role="alertdialog" aria-label="Discard the draft" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p>Discard this draft? You can prepare a new one from the service requests afterwards.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => discardInitialBill(customerId, inv.id), 'Draft discarded.')}>
              {pending && <Loader2 className="animate-spin" />} Yes, discard it
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!confirming && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button disabled={pending} onClick={() => setConfirming('send')}>
            <Send /> Review and send
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => run(() => saveInitialBill(customerId, inv.id, input), 'Draft saved.')}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Save draft
          </Button>
          <Button variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => setConfirming('discard')}>
            <Trash2 /> Discard draft
          </Button>
        </div>
      )}
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  className,
  disabled,
  hint,
  warn,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  className?: string
  disabled?: boolean
  hint?: string
  warn?: string
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium">{label}</span>
      <Input type="number" inputMode="decimal" min={0} step="0.01" value={value} onChange={(e) => onChange(e.target.value)} className={className} disabled={disabled} />
      {(warn || hint) && <span className={warn ? 'block text-[11px] text-warning' : 'block text-[11px] text-muted-foreground'}>{warn ?? hint}</span>}
    </label>
  )
}

function RefField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8" maxLength={200} disabled={disabled} placeholder="e.g. CEO email, Nov 10, 2026" />
    </label>
  )
}

function SentBill({ inv, customerName, senderName, canOpenAccounting }: { inv: InvoiceView; customerName: string; senderName: string; canOpenAccounting: boolean }) {
  const email = invoiceEmail({
    customerName,
    senderName,
    code: inv.code,
    currency: inv.currency,
    lines: inv.lines,
    subtotal: inv.subtotal,
    vatAmount: inv.vatAmount,
    vatPercent: inv.settings.vatPercent,
    paypalFeeAmount: inv.paypalFeeAmount,
    paypalPercent: inv.settings.paypalPercent,
    total: inv.total,
  })
  const paid = inv.payments.length > 0
  return (
    <div className="space-y-4">
      <InvoiceLines
        lines={inv.lines}
        currency={inv.currency}
        subtotal={inv.subtotal}
        vatAmount={inv.vatAmount}
        vatPercent={inv.settings.vatPercent}
        paypalFeeAmount={inv.paypalFeeAmount}
        paypalPercent={inv.settings.paypalPercent}
        total={inv.total}
        amountPaid={inv.amountPaid}
      />
      <div className="space-y-1 text-sm text-muted-foreground">
        {inv.status === 'DRAFT' ? <p>Draft, not sent yet.</p> : inv.sentAt && <p>Sent {when(inv.sentAt)} by {inv.sentByEmail}.</p>}
        {paid ? (
          <ul className="space-y-0.5">
            {inv.payments.map((p) => (
              <li key={p.id}>
                Paid {formatMoney(p.amount, inv.currency)} on {day(p.paidOn)} by {p.method}
                {p.reference && ` (${p.reference})`}, recorded by {p.recordedByEmail}.
              </li>
            ))}
          </ul>
        ) : (
          inv.status !== 'DRAFT' && <p>No payment recorded yet. Accounting records it in the Accounting System.</p>
        )}
        {inv.notes && <p className="whitespace-pre-wrap">Notes: {inv.notes}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {inv.status !== 'DRAFT' && <CopyButton text={`Subject: ${email.subject}\n\n${email.body}`} label="Copy bill email" />}
        {canOpenAccounting && (
          <Link href={`/accounting/invoices/${inv.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <ExternalLink /> Open in Accounting
          </Link>
        )}
      </div>
    </div>
  )
}
