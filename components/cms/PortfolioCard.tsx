import { STATUS_META, STATUS_ORDER } from '@/components/cms/status-meta'
import type { CustomerStatus } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

// The overview card: every customer as one bar split by status, with the
// figures beside it. All numbers are counted from the database.
export function PortfolioCard({
  byStatus,
  total,
  accounts,
  vasRequested,
  changesThisWeek,
}: {
  byStatus: Record<CustomerStatus, number>
  total: number
  accounts: number
  vasRequested: number
  changesThisWeek: number
}) {
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

  return (
    <section className="grid gap-6 rounded-2xl border bg-card p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-10" aria-label="Customer portfolio">
      <div className="min-w-0 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium text-muted-foreground">Status mix</p>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? 'customer' : 'customers'}
          </p>
        </div>

        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={STATUS_ORDER.map((s) => `${STATUS_META[s].label} ${byStatus[s]}`).join(', ')}
        >
          {total > 0 &&
            STATUS_ORDER.filter((s) => byStatus[s] > 0).map((s) => (
              <span key={s} className={cn('h-full border-r-2 border-card last:border-r-0', STATUS_META[s].bar)} style={{ width: `${(byStatus[s] / total) * 100}%` }} />
            ))}
        </div>

        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {STATUS_ORDER.map((s) => (
            <li key={s} className="flex items-baseline gap-1.5 text-sm">
              <span className={cn('h-2 w-2 shrink-0 self-center rounded-full', STATUS_META[s].dot)} />
              <span className="text-muted-foreground">{STATUS_META[s].label}</span>
              <span className="font-display font-semibold tabular-nums">{byStatus[s]}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{pct(byStatus[s])}%</span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="grid grid-cols-3 gap-6 border-t pt-5 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
        {[
          { value: accounts, label: 'Accounts' },
          { value: vasRequested, label: 'VAs requested' },
          { value: changesThisWeek, label: 'Status changes (7d)' },
        ].map((k) => (
          <div key={k.label} className="flex flex-col justify-center gap-1">
            <dd className="font-display text-[26px] font-semibold leading-none tabular-nums tracking-tight">{k.value}</dd>
            <dt className="text-[12px] leading-tight text-muted-foreground">{k.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}
