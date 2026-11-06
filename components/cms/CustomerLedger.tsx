import Link from 'next/link'
import { AlertTriangle, Hourglass } from 'lucide-react'
import { STATUS_META, STATUS_ORDER } from '@/components/cms/status-meta'
import { SortableTable, type SortColumn } from '@/components/ui/sortable-table'
import { TestBadge } from '@/components/leads/TestBadge'
import { WARNING_LABELS, type CustomerStatus, type CustomerWarning } from '@/lib/customer-fields'
import { LEAD_PHASES, PHASE_LABELS, type LeadPhase } from '@/lib/lead-phase-fields'
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
  // A test lead (lib/test-leads.ts): listed, never counted.
  test: boolean
  // Set for a record that is still a lead: its Lead Management phase, and
  // daysInStatus counts days in that phase.
  phase: LeadPhase | null
}

// The customer list as a ledger: one row per customer, its status as a
// coloured stripe on the left edge so the mix reads at a glance. The leads
// table (kind 'leads') shows each lead's phase instead, since every lead is
// Pending.
export function CustomerLedger({ rows, kind = 'customers' }: { rows: LedgerRow[]; kind?: 'customers' | 'leads' }) {
  const leads = kind === 'leads'
  const columns: SortColumn[] = [
    { key: 'name', label: leads ? 'Lead' : 'Customer', className: 'py-3 pl-6 pr-3 font-medium' },
    { key: 'status', label: leads ? 'Phase' : 'Status', className: 'px-3 py-3 font-medium' },
    { key: 'specialist', label: 'CS Specialist', className: 'hidden px-3 py-3 font-medium lg:table-cell' },
    { key: 'accounts', label: 'Accounts', align: 'right', firstDir: 'desc', className: 'hidden px-3 py-3 font-medium sm:table-cell' },
    { key: 'vas', label: 'VAs', align: 'right', firstDir: 'desc', className: 'hidden px-3 py-3 font-medium sm:table-cell' },
    { key: 'days', label: leads ? 'In phase' : 'In status', align: 'right', firstDir: 'desc', className: 'hidden py-3 pl-3 pr-6 font-medium md:table-cell' },
  ]
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <SortableTable
        className="w-full text-sm"
        theadClassName="text-left text-[11px] uppercase tracking-wide text-muted-foreground"
        headRowClassName="border-b"
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          // Phases and statuses sort in workflow order, not A to Z.
          values: {
            name: r.name,
            status: leads && r.phase ? LEAD_PHASES.indexOf(r.phase) : STATUS_ORDER.indexOf(r.status),
            specialist: r.specialist,
            accounts: r.accountCount,
            vas: r.vasRequested,
            days: r.daysInStatus,
          },
          node: (
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
                {r.test && <TestBadge className="ml-2" />}
                <p className="font-mono text-[11px] text-muted-foreground">
                  {r.code}
                  {r.email && <span className="hidden font-sans lg:inline"> · {r.email}</span>}
                </p>
              </td>
              <td className="px-3 py-3">
                <span className="flex items-center gap-1.5">
                  <span className={cn('inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium', STATUS_META[r.status].soft)}>
                    {leads && r.phase ? PHASE_LABELS[r.phase] : STATUS_META[r.status].label}
                  </span>
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
          ),
        }))}
      />
    </div>
  )
}
