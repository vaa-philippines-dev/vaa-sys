import Link from 'next/link'
import { STATUS_META } from '@/components/cms/status-meta'
import type { CustomerStatus } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

type Activity = {
  id: string
  fromStatus: CustomerStatus | null
  toStatus: CustomerStatus
  reason: string | null
  changedAt: Date
  changedByEmail: string
  customer: { id: string; name: string }
}

const when = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })

// The latest entries from every customer's status log.
export function ActivityFeed({ items }: { items: Activity[] }) {
  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby="activity-title">
      <h2 id="activity-title" className="font-display text-sm font-semibold">
        Recent activity
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Status changes will show up here.</p>
      ) : (
        <ol className="mt-4 space-y-4">
          {items.map((a) => (
            <li key={a.id} className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-3 text-sm">
              <span className={cn('mt-1.5 h-2 w-2 rounded-full', STATUS_META[a.toStatus].dot)} aria-hidden />
              <div className="min-w-0">
                <p className="leading-snug">
                  <Link href={`/customers/${a.customer.id}`} className="font-medium hover:underline">
                    {a.customer.name}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    {a.fromStatus ? `${STATUS_META[a.fromStatus].label} → ${STATUS_META[a.toStatus].label}` : `added as ${STATUS_META[a.toStatus].label}`}
                  </span>
                </p>
                {a.reason && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">“{a.reason}”</p>}
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {when.format(a.changedAt)} · {a.changedByEmail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
