import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listInvoices } from '@/lib/billing'
import { REAL_CUSTOMERS } from '@/lib/customers'
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, formatMoney, invoiceCode, type Currency, type InvoiceStatus } from '@/lib/billing-fields'
import { manilaDate, manilaToday } from '@/lib/customer-fields'
import { InvoiceStatusBadge } from '@/components/billing/InvoiceStatusBadge'
import { TestBadge } from '@/components/leads/TestBadge'
import { SortableTable } from '@/components/ui/sortable-table'
import { cn } from '@/lib/utils'

// Accounting's home: every bill, newest first, with what's still owed.
// Figures leave test leads out; the list shows them with a Test badge.
export default async function BillsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requireCan('billing', 'read', '/accounting')
  const sp = await searchParams
  const status = INVOICE_STATUSES.includes(sp.status as InvoiceStatus) ? (sp.status as InvoiceStatus) : undefined
  const q = sp.q?.trim() ?? ''

  const monthStart = new Date(`${manilaToday().slice(0, 8)}01T00:00:00+08:00`)
  const [invoices, open, paidThisMonth, drafts, foregone] = await Promise.all([
    listInvoices({ status, q }),
    prisma.invoice.findMany({ where: { status: { in: ['SENT', 'PARTIALLY_PAID'] }, customer: REAL_CUSTOMERS }, select: { currency: true, total: true, amountPaid: true } }),
    prisma.payment.findMany({ where: { paidOn: { gte: monthStart }, customer: REAL_CUSTOMERS }, select: { amount: true, invoice: { select: { currency: true } } } }),
    prisma.invoice.count({ where: { status: 'DRAFT', customer: REAL_CUSTOMERS } }),
    prisma.invoiceLine.findMany({
      where: { foregoneType: { not: null }, invoice: { status: { notIn: ['DRAFT', 'VOID'] }, customer: REAL_CUSTOMERS } },
      select: { foregoneAmount: true, invoice: { select: { currency: true } } },
    }),
  ])

  // Amounts in different currencies are never added together.
  const byCurrency = (rows: { currency: Currency; value: number }[]) => {
    const sums = new Map<Currency, number>()
    for (const r of rows) sums.set(r.currency, (sums.get(r.currency) ?? 0) + r.value)
    const list = [...sums.entries()].filter(([, v]) => Math.abs(v) >= 0.005)
    return list.length ? list.map(([c, v]) => formatMoney(v, c)).join(' · ') : formatMoney(0, 'USD')
  }
  const tiles = [
    { label: 'Still owed', value: byCurrency(open.map((i) => ({ currency: i.currency, value: Number(i.total) - Number(i.amountPaid) }))), hint: `${open.length} bill${open.length === 1 ? '' : 's'} sent and not fully paid` },
    { label: 'Paid this month', value: byCurrency(paidThisMonth.map((p) => ({ currency: p.invoice.currency, value: Number(p.amount) }))), hint: `${paidThisMonth.length} payment${paidThisMonth.length === 1 ? '' : 's'}` },
    { label: 'Foregone Revenue', value: byCurrency(foregone.map((f) => ({ currency: f.invoice.currency, value: Number(f.foregoneAmount) }))), hint: 'Waivers, discounts and free hours on sent bills' },
    { label: 'Drafts', value: String(drafts), hint: 'Being prepared in Lead Management' },
  ]

  const href = (next: { status?: string; q?: string }) => {
    const qs = new URLSearchParams(Object.entries({ status, q, ...next }).filter(([, v]) => v) as [string, string][])
    const s = qs.toString()
    return s ? `/accounting?${s}` : '/accounting'
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Accounting System</p>
        <h1 className="mt-1 text-2xl font-semibold">Bills</h1>
        <p className="mt-1 text-sm text-muted-foreground">Initial bills are prepared and sent by the Lead Manager from the lead’s page. Record the payments here.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{t.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{t.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          {[undefined, ...INVOICE_STATUSES].map((s) => (
            <Link
              key={s ?? 'all'}
              href={href({ status: s ?? '' })}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium', status === s ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground')}
            >
              {s ? INVOICE_STATUS_LABELS[s] : 'All'}
            </Link>
          ))}
        </nav>
        <form action="/accounting" className="flex h-9 items-center gap-2 rounded-xl border bg-card px-3">
          {status && <input type="hidden" name="status" value={status} />}
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <label htmlFor="bill-search" className="sr-only">
            Search bills
          </label>
          <input id="bill-search" name="q" type="search" defaultValue={q} placeholder="Customer or INV-0001" className="w-48 bg-transparent text-[13px] outline-none" />
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <SortableTable
          className="w-full min-w-[760px] text-left text-[13px]"
          theadClassName="border-b text-[12px] text-muted-foreground"
          columns={[
            { key: 'bill', label: 'Bill', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            { key: 'customer', label: 'Customer', className: 'px-4 py-2.5 font-medium' },
            { key: 'status', label: 'Status', className: 'px-4 py-2.5 font-medium' },
            // Amounts in different currencies sort by their number alone.
            { key: 'total', label: 'Total', align: 'right', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            { key: 'balance', label: 'Balance', align: 'right', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            { key: 'sent', label: 'Sent', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
          ]}
          empty={
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                {q || status ? 'No bills match.' : 'No bills yet. The first one appears when a Lead Manager prepares a lead’s initial bill.'}
              </td>
            </tr>
          }
          rows={invoices.map((i) => {
            const balance = i.status === 'VOID' || i.status === 'DRAFT' ? null : Number(i.total) - Number(i.amountPaid)
            return {
              id: i.id,
              values: {
                bill: i.invoiceNumber,
                customer: i.customer.name,
                status: INVOICE_STATUSES.indexOf(i.status),
                total: Number(i.total),
                balance: balance === null ? null : Math.max(0, balance),
                sent: i.sentAt,
              },
              node: (
                <tr key={i.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <Link href={`/accounting/invoices/${i.id}`} className="font-mono font-medium hover:underline">
                      {invoiceCode(i.invoiceNumber)}
                    </Link>
                    <p className="text-[12px] text-muted-foreground">Initial bill</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {i.customer.name}
                    {i.customer.isTest && <TestBadge className="ml-2" />}
                    <p className="font-mono text-[12px] text-muted-foreground">{i.customer.customerCode}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <InvoiceStatusBadge status={i.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(Number(i.total), i.currency)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{balance === null ? '–' : formatMoney(Math.max(0, balance), i.currency)}</td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{i.sentAt ? i.sentAt.toLocaleDateString('en-PH', manilaDate) : 'Not sent'}</td>
                </tr>
              ),
            }
          })}
        />
      </div>
    </main>
  )
}
