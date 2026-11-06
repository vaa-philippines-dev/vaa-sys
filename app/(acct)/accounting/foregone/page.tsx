import Link from 'next/link'
import { requireCan } from '@/lib/auth'
import { listForegone } from '@/lib/billing'
import { FOREGONE_LABELS, LINE_KIND_LABELS, formatMoney, invoiceCode, type Currency } from '@/lib/billing-fields'
import { manilaDate } from '@/lib/customer-fields'
import { TestBadge } from '@/components/leads/TestBadge'
import { SortableTable } from '@/components/ui/sortable-table'

// [7] of the billing doc: every amount not collected because of a waiver,
// discount or free hours, on bills that went out, so the full standard price
// stays traceable. Each row is a reduction line on a bill.
export default async function ForegonePage() {
  await requireCan('billing', 'read', '/accounting/foregone')
  const rows = await listForegone()
  const totals = new Map<Currency, number>()
  for (const r of rows) if (!r.invoice.customer.isTest) totals.set(r.invoice.currency, (totals.get(r.invoice.currency) ?? 0) + Number(r.foregoneAmount))

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Accounting System</p>
          <h1 className="mt-1 text-2xl font-semibold">Foregone Revenue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Waived and discounted One-Time Fees and deposits (CEO-approved), and free hours, on sent bills.</p>
        </div>
        <p className="text-sm">
          Total{' '}
          <span className="font-semibold tabular-nums">{totals.size ? [...totals.entries()].map(([c, v]) => formatMoney(v, c)).join(' · ') : formatMoney(0, 'USD')}</span>
          <span className="block text-right text-[11px] text-muted-foreground">Test leads not counted</span>
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <SortableTable
          className="w-full min-w-[820px] text-left text-[13px]"
          theadClassName="border-b text-[12px] text-muted-foreground"
          columns={[
            { key: 'customer', label: 'Customer', className: 'px-4 py-2.5 font-medium' },
            { key: 'bill', label: 'Bill', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            { key: 'component', label: 'Component', className: 'px-4 py-2.5 font-medium' },
            { key: 'type', label: 'Type', className: 'px-4 py-2.5 font-medium' },
            { key: 'foregone', label: 'Foregone', align: 'right', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            { key: 'approval', label: 'Approval / reference', className: 'px-4 py-2.5 font-medium' },
          ]}
          empty={
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                Nothing foregone yet.
              </td>
            </tr>
          }
          rows={rows.map((r) => ({
            id: r.id,
            values: {
              customer: r.invoice.customer.name,
              bill: r.invoice.invoiceNumber,
              component: LINE_KIND_LABELS[r.kind],
              type: r.foregoneType ? FOREGONE_LABELS[r.foregoneType] : null,
              foregone: Number(r.foregoneAmount),
              approval: r.approvalRef,
            },
            node: (
              <tr key={r.id} className="border-b last:border-0 align-top">
                <td className="px-4 py-2.5">
                  {r.invoice.customer.name}
                  {r.invoice.customer.isTest && <TestBadge className="ml-2" />}
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/accounting/invoices/${r.invoice.id}`} className="font-mono hover:underline">
                    {invoiceCode(r.invoice.invoiceNumber)}
                  </Link>
                  {r.invoice.sentAt && <span className="block text-[12px] text-muted-foreground">{r.invoice.sentAt.toLocaleDateString('en-PH', manilaDate)}</span>}
                </td>
                <td className="px-4 py-2.5">
                  {LINE_KIND_LABELS[r.kind]}
                  <span className="block text-[12px] text-muted-foreground">{r.calculation}</span>
                </td>
                <td className="px-4 py-2.5">{r.foregoneType && FOREGONE_LABELS[r.foregoneType]}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(Number(r.foregoneAmount), r.invoice.currency)}</td>
                <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{r.approvalRef ?? '–'}</td>
              </tr>
            ),
          }))}
        />
      </div>
    </main>
  )
}
