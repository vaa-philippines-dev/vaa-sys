import Link from 'next/link'
import { AlertTriangle, Hourglass } from 'lucide-react'
import { STATUS_META } from '@/components/cms/status-meta'
import { WARNING_LABELS, type CustomerStatus, type CustomerWarning } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

export type LedgerRow = {
  id: string
  name: string
  code: string
  email: string | null
  status: CustomerStatus
  daysInStatus: number
  accountCount: number
  vasRequested: number
  specialist: string | null
  inReview: boolean
  warnings: CustomerWarning[]
}

// The customer list as a ledger: one row per customer, its status as a
// coloured stripe on the left edge so the mix reads at a glance.
export function CustomerLedger({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="py-3 pl-6 pr-3 font-medium">Customer</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="hidden px-3 py-3 font-medium lg:table-cell">CS Specialist</th>
            <th className="hidden px-3 py-3 text-right font-medium sm:table-cell">Accounts</th>
            <th className="hidden px-3 py-3 text-right font-medium sm:table-cell">VAs</th>
            <th className="hidden py-3 pl-3 pr-6 text-right font-medium md:table-cell">In status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="group border-b last:border-b-0 hover:bg-muted/50">
              <td
                className={cn(
                  'relative py-3 pl-6 pr-3 before:absolute before:inset-y-2.5 before:left-2.5 before:w-1 before:rounded-full',
                  STATUS_META[r.status].stripe
                )}
              >
                <Link href={`/customers/${r.id}`} className="font-medium after:absolute after:inset-0 group-hover:underline">
                  {r.name}
                </Link>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {r.code}
                  {r.email && <span className="hidden font-sans lg:inline"> · {r.email}</span>}
                </p>
              </td>
              <td className="px-3 py-3">
                <span className="flex items-center gap-1.5">
                  <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium', STATUS_META[r.status].soft)}>{STATUS_META[r.status].label}</span>
                  {r.inReview && <Hourglass className="h-3.5 w-3.5 text-warning" aria-label="Waiting for a CS Manager's review" />}
                  {r.warnings.length > 0 && (
                    <span title={r.warnings.map((w) => WARNING_LABELS[w]).join(', ')}>
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-label={r.warnings.map((w) => WARNING_LABELS[w]).join(', ')} />
                    </span>
                  )}
                </span>
              </td>
              <td className="hidden px-3 py-3 text-[13px] lg:table-cell">{r.specialist ?? <span className="text-muted-foreground">Unassigned</span>}</td>
              <td className="hidden px-3 py-3 text-right font-display tabular-nums sm:table-cell">{r.accountCount}</td>
              <td className="hidden px-3 py-3 text-right font-display tabular-nums sm:table-cell">{r.vasRequested}</td>
              <td className="hidden whitespace-nowrap py-3 pl-3 pr-6 text-right text-muted-foreground md:table-cell">
                {r.daysInStatus === 0 ? 'Today' : `${r.daysInStatus} ${r.daysInStatus === 1 ? 'day' : 'days'}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
