import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { canUse } from '@/lib/access-fields'
import { getInvoice } from '@/lib/billing'
import { invoiceView } from '@/lib/billing-view'
import { CURRENCY_LABELS, formatMoney } from '@/lib/billing-fields'
import { PAYMENT_LABELS, SCHEDULE_LABELS } from '@/lib/onboarding-fields'
import { manilaDate, manilaDateTime } from '@/lib/customer-fields'
import { InvoiceLines } from '@/components/billing/InvoiceLines'
import { InvoiceStatusBadge } from '@/components/billing/InvoiceStatusBadge'
import { TestBadge } from '@/components/leads/TestBadge'
import { RecordPaymentForm, RemovePayment, VoidBill } from '@/components/acct/BillControls'
import { SortableTable } from '@/components/ui/sortable-table'

const when = (iso: string) => new Date(iso).toLocaleString('en-PH', manilaDateTime)
const day = (s: string) => new Date(`${s}T00:00:00+08:00`).toLocaleDateString('en-PH', manilaDate)

// One bill in the Accounting System: its lines, the inputs it was worked out
// from, and its payments. Accounting records payments and voids it here; the
// bill itself changes only while it's a draft, on the lead's page.
export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireCan('billing', 'read', `/accounting/invoices/${id}`)
  const row = await getInvoice(id)
  if (!row) notFound()
  const inv = invoiceView(row)
  const balance = Math.max(0, Math.round((inv.total - inv.amountPaid) * 100) / 100)
  const open = inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID'
  const method = row.account
    ? row.account.paymentMethod === 'OTHER'
      ? /paypal/i.test(row.account.paymentMethodOther ?? '')
        ? 'PayPal'
        : 'Other'
      : PAYMENT_LABELS[row.account.paymentMethod]
    : 'Other'

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Bills
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Initial bill</p>
          <h1 className="mt-1 flex items-center gap-3 font-mono text-2xl font-semibold">
            {inv.code} <InvoiceStatusBadge status={inv.status} className="font-sans" />
          </h1>
          <p className="mt-1 text-sm">
            {inv.customer.name}
            {inv.customer.isTest && <TestBadge className="ml-2" />}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{inv.customer.customerCode}</span>
          </p>
          {inv.account && (
            <p className="text-sm text-muted-foreground">
              Bill to {inv.account.invoiceContactName ? `${inv.account.invoiceContactName} · ` : ''}
              {inv.account.invoiceContactEmail} · {inv.account.name} ({inv.account.accountCode})
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total due</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(inv.total, inv.currency)}</p>
          {inv.status !== 'DRAFT' && inv.status !== 'VOID' && <p className="text-sm text-muted-foreground">Balance {formatMoney(balance, inv.currency)}</p>}
        </div>
      </header>

      {inv.status === 'DRAFT' && (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Draft: the Lead Manager is still preparing this bill on the lead’s page. Payments can be recorded once it’s sent.
        </p>
      )}
      {inv.status === 'VOID' && (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Void since {inv.voidedAt && when(inv.voidedAt)} ({inv.voidedByEmail}): {inv.voidReason}
        </p>
      )}

      <section className="space-y-3">
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
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Currency</dt>
          <dd>{CURRENCY_LABELS[inv.currency]}</dd>
          <dt className="text-muted-foreground">Prepared</dt>
          <dd>
            {when(inv.createdAt)} by {inv.createdByEmail}
          </dd>
          <dt className="text-muted-foreground">Sent</dt>
          <dd>{inv.sentAt ? `${when(inv.sentAt)} by ${inv.sentByEmail}` : 'Not yet'}</dd>
          {inv.notes && (
            <>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap">{inv.notes}</dd>
            </>
          )}
        </dl>
        {canUse(user.role, 'leads') && (
          <Link href={`/leads/${inv.customer.id}`} className="inline-flex items-center gap-1 text-sm hover:underline">
            <ExternalLink className="h-3.5 w-3.5" /> Open the lead
          </Link>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Payments</h2>
        {inv.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">None recorded yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {inv.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium tabular-nums">{formatMoney(p.amount, inv.currency)}</span> on {day(p.paidOn)} · {p.method}
                  {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                  <span className="block text-xs text-muted-foreground">Recorded by {p.recordedByEmail}</span>
                </span>
                {can(user.role, 'billing', 'delete') && <RemovePayment paymentId={p.id} label={`${formatMoney(p.amount, inv.currency)} on ${day(p.paidOn)}`} />}
              </li>
            ))}
          </ul>
        )}
        {open && can(user.role, 'billing', 'create') && (
          <div className="border-t pt-4">
            <RecordPaymentForm invoiceId={inv.id} currency={inv.currency} balance={balance} defaultMethod={method} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Worked out from</h2>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <SortableTable
            className="w-full min-w-[720px] text-left text-[13px]"
            theadClassName="border-b text-[12px] text-muted-foreground"
            columns={[
              { key: 'service', label: 'VA request', className: 'px-4 py-2.5 font-medium' },
              { key: 'period', label: 'Period', className: 'px-4 py-2.5 font-medium' },
              { key: 'rate', label: 'Rate', align: 'right', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
              { key: 'hours', label: 'Hours / ND', align: 'right', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
              { key: 'free', label: 'Free hours · deposit', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            ]}
            rows={inv.items.map((i) => ({
              id: i.id,
              values: { service: i.service, period: i.periodStart, rate: i.hourlyRate, hours: i.hours, free: i.freeHours },
              node: (
                <tr key={i.id} className="border-b last:border-0 align-top">
                  <td className="px-4 py-2.5">
                    {i.service}
                    <p className="text-[12px] text-muted-foreground">
                      {i.department} · {SCHEDULE_LABELS[i.scheduleType]} · {i.numberOfVas} VA{i.numberOfVas === 1 ? '' : 's'}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                    {i.periodEnd ? `${day(i.periodStart)} to ${day(i.periodEnd)}` : `From ${day(i.periodStart)}`}
                    <span className="block">{i.hoursBasis}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(i.hourlyRate, inv.currency)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {i.hours} h{i.ndHours > 0 && <span className="block text-[12px] text-muted-foreground">{i.ndHours} h ND</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                    {i.freeHours > 0 ? `${i.freeHours} h free (${i.freeHoursRef})` : 'No free hours'}
                    <span className="block">{i.depositDiscountPercent > 0 ? `Deposit ${i.depositDiscountPercent}% off (${i.depositApprovalRef})` : 'Full deposit'}</span>
                  </td>
                </tr>
              ),
            }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Fees used: One-Time Fee {formatMoney(inv.settings.otf, inv.currency)} per department, deposit {formatMoney(inv.settings.deposit, inv.currency)} per VA, night differential {inv.settings.ndPercent}%, VAT{' '}
          {inv.settings.vatPercent}% {inv.applyVat ? '(applied)' : '(not applied)'}, PayPal fee {inv.settings.paypalPercent}% {inv.applyPaypalFee ? '(applied)' : '(not applied)'}.
        </p>
      </section>

      {open && inv.payments.length === 0 && can(user.role, 'billing', 'update') && (
        <div className="flex flex-wrap border-t pt-4">
          <VoidBill invoiceId={inv.id} code={inv.code} />
        </div>
      )}
    </main>
  )
}
