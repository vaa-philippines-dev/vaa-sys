import { Gauge } from '@/components/lms/Gauge'
import type { OnboardingStage } from '@/lib/customer-fields'

// The LMS stats card. Every figure comes from the leads themselves:
// new leads per day this week, how many sent links came back as forms,
// and where the rest are waiting.
type StatLead = { createdAt: Date; stage: OnboardingStage }

const manilaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' })
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Manila' })

function lastSevenDays(now: Date) {
  return Array.from({ length: 7 }, (_, i) => new Date(now.getTime() - (6 - i) * 86_400_000))
}

function BarChart({ leads, now }: { leads: StatLead[]; now: Date }) {
  const days = lastSevenDays(now)
  const counts = days.map((d) => {
    const key = manilaDay.format(d)
    return leads.filter((l) => manilaDay.format(l.createdAt) === key).length
  })
  const max = Math.max(4, ...counts)

  return (
    <div className="flex items-end gap-3" role="img" aria-label={`New leads per day: ${days.map((d, i) => `${weekday.format(d)} ${counts[i]}`).join(', ')}`}>
      <div className="flex h-[92px] flex-col justify-between pb-4 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden>
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="flex h-[92px] items-end gap-2" aria-hidden>
        {days.map((d, i) => (
          <div key={d.toISOString()} className="flex flex-col items-center gap-2">
            <div className="flex h-[68px] w-5 items-end">
              <div className="w-full rounded-[3px] bg-primary" style={{ height: `${Math.max((counts[i] / max) * 100, counts[i] > 0 ? 6 : 0)}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground">{weekday.format(d)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Kpi({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[22px] font-semibold tabular-nums tracking-tight">{value}</span>
      <span className="text-[12px] leading-tight text-muted-foreground">{label}</span>
    </div>
  )
}

// `now` comes from the page so the component itself stays pure.
export function StatsRow({ leads, now }: { leads: StatLead[]; now: Date }) {
  const weekAgo = now.getTime() - 7 * 86_400_000
  const newThisWeek = leads.filter((l) => l.createdAt.getTime() >= weekAgo).length
  const sent = leads.filter((l) => l.stage !== 'NEW').length
  const submitted = leads.filter((l) => l.stage === 'SUBMITTED').length
  const completion = sent > 0 ? Math.round((submitted / sent) * 100) : null
  const waiting = leads.filter((l) => l.stage === 'LINK_SENT' || l.stage === 'OPENED').length

  return (
    <div className="grid grid-cols-1 items-center gap-6 rounded-2xl border bg-card px-6 py-5 sm:grid-cols-2 sm:px-8 sm:py-6 lg:grid-cols-4 lg:gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">New leads (7d) · {newThisWeek}</p>
        <BarChart leads={leads} now={now} />
      </div>
      <div className="flex justify-center lg:border-l">
        <Gauge percent={completion} label="Forms completed" />
      </div>
      <div className="flex justify-center sm:border-l">
        <Kpi value={leads.length} label="Leads in onboarding" />
      </div>
      <div className="flex justify-center sm:border-l">
        <Kpi value={waiting} label="Waiting on the customer" />
      </div>
    </div>
  )
}
