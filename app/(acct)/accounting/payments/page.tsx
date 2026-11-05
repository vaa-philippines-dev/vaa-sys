import Link from 'next/link'
import { requireCan } from '@/lib/auth'
import { listPayments } from '@/lib/billing'
import { formatMoney, invoiceCode } from '@/lib/billing-fields'
import { dayString, manilaDate } from '@/lib/customer-fields'
import { TestBadge } from '@/components/leads/TestBadge'
import { SortableTable } from '@/components/ui/sortable-table'

// Every payment recorded against a bill, newest first.
export default async function PaymentsPage() {
  await requireCan('billing', 'read', '/accounting/payments')
  const payments = await listPayments()
  const day = (d: Date) => new Date(`${dayString(d)}T00:00:00+08:00`).toLocaleDateString('en-PH', manilaDate)

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Accounting System</p>
        <h1 className="mt-1 text-2xl font-semibold">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">Recorded on each bill’s page. Removing one puts the bill’s balance back.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <SortableTable
          className="w-full min-w-[720px] text-left text-[13px]"
          theadClassName="border-b text-[12px] text-muted-foreground"
          columns={[
            { key: 'paid', label: 'Paid on', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            { key: 'customer', label: 'Customer', className: 'px-4 py-2.5 font-medium' },
            { key: 'bill', label: 'Bill', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            { key: 'method', label: 'Method', className: 'px-4 py-2.5 font-medium' },
            { key: 'amount', label: 'Amount', align: 'right', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            { key: 'by', label: 'Recorded by', className: 'px-4 py-2.5 font-medium' },
          ]}
          empty={
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                No payments recorded yet.
              </td>
            </tr>
          }
          rows={payments.map((p) => ({
            id: p.id,
            values: { paid: p.paidOn, customer: p.customer.name, bill: p.invoice.invoiceNumber, method: p.method, amount: Number(p.amount), by: p.recordedByEmail },
            node: (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-4 py-2.5 tabular-nums">{day(p.paidOn)}</td>
                <td className="px-4 py-2.5">
                  {p.customer.name}
                  {p.customer.isTest && <TestBadge className="ml-2" />}
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/accounting/invoices/${p.invoice.id}`} className="font-mono hover:underline">
                    {invoiceCode(p.invoice.invoiceNumber)}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  {p.method}
                  {p.reference && <span className="block text-[12px] text-muted-foreground">{p.reference}</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(Number(p.amount), p.invoice.currency)}</td>
                <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{p.recordedByEmail}</td>
              </tr>
            ),
          }))}
        />
      </div>
    </main>
  )
}
