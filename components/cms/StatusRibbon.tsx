import { STATUS_META } from '@/components/cms/status-meta'
import type { CustomerStatus } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

// A customer's whole history on one bar: each status a segment as long as
// the customer stayed in it, oldest on the left, today on the right. Built
// from the status log, so it is exactly as complete as the log.
type LogEntry = { toStatus: CustomerStatus; changedAt: Date }

const day = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })

function duration(ms: number) {
  const days = Math.floor(ms / 86_400_000)
  if (days >= 60) return `${Math.round(days / 30)} months`
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'}`
  const hours = Math.floor(ms / 3_600_000)
  return hours >= 1 ? `${hours} h` : 'under an hour'
}

export function StatusRibbon({ logs, now }: { logs: LogEntry[]; now: Date }) {
  const ordered = [...logs].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
  if (ordered.length === 0) return null

  const start = ordered[0].changedAt.getTime()
  const span = Math.max(now.getTime() - start, 1)
  const segments = ordered.map((log, i) => {
    const from = log.changedAt.getTime()
    const to = ordered[i + 1]?.changedAt.getTime() ?? now.getTime()
    return { status: log.toStatus, ms: to - from, share: (to - from) / span, current: i === ordered.length - 1 }
  })

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segments.map((s) => `${STATUS_META[s.status].label} for ${duration(s.ms)}`).join(', then ')}>
        {segments.map((s, i) => (
          <span
            key={i}
            title={`${STATUS_META[s.status].label}: ${duration(s.ms)}`}
            className={cn('h-full rounded-full', STATUS_META[s.status].bar, s.current && 'animate-pulse [animation-duration:3s]')}
            style={{ flexGrow: Math.max(s.share, 0.02), flexBasis: 0 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{day.format(ordered[0].changedAt)}</span>
        <span>Today</span>
      </div>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-hidden>
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[s.status].dot)} />
            <span className={s.current ? 'font-medium' : 'text-muted-foreground'}>{STATUS_META[s.status].label}</span>
            <span className="text-muted-foreground">{duration(s.ms)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
