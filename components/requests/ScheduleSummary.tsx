import {
  SCHEDULE_GROUP_LABELS,
  SCHEDULE_LABELS,
  WORK_DAYS,
  hasDayHours,
  nightDifferentialHours,
  nightDifferentialSpans,
  phtToZoneTime,
  scheduleGroupOf,
  shiftHours,
  time12,
  weeklyHoursOf,
  zoneOnDate,
} from '@/lib/onboarding-fields'
import type { ScheduleSnapshot } from '@/lib/request-schedule-fields'
import { cn } from '@/lib/utils'

const h = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100) / 100}h`)

// "23:00" + 4 hours → "03:00".
function plusHours(hhmm: string, hours: number) {
  const [a, b] = hhmm.split(':').map(Number)
  const m = (((a * 60 + b + Math.round(hours * 60)) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// A VA request's schedule, laid out in full on its service request and Rate
// Agreement (Nov 6, 2026): the work hour type, the client's time zone, the
// time the VA must work in PH time (and the client's), when the night
// differential applies, and the hours for each day, Sat and Sun included.
export function ScheduleSummary({
  schedule,
  timeZone,
  timeZoneIsAccounts = false,
  targetStartDate,
}: {
  schedule: ScheduleSnapshot
  timeZone: string | null
  // The request has no zone of its own: this is the account's.
  timeZoneIsAccounts?: boolean
  targetStartDate: string
}) {
  const s = schedule
  const fixed = s.scheduleType === 'DAILY_FIXED' && !!s.startTimePht && !!s.endTimePht
  const daily = s.scheduleType === 'DAILY_FIXED' || s.scheduleType === 'DAILY_FLEXIBLE'
  const total =
    s.scheduleType === 'WEEKLY_FLEXIBLE'
      ? `${h(s.hoursPerWeek)} a week`
      : s.scheduleType === 'MONTHLY'
        ? `${h(s.hoursPerMonth)} a month`
        : s.scheduleType === 'PROJECT'
          ? `${h(s.projectHours)} for the project`
          : hasDayHours(s.dayHours)
            ? `${h(weeklyHoursOf(s.dayHours))} a week`
            : null

  // Night differential: the part of a fixed shift between 10 PM and 6 AM PH time.
  const ndPerDay = fixed ? nightDifferentialHours(s.startTimePht!, s.endTimePht!) : 0
  const ndSpans = fixed ? nightDifferentialSpans(s.startTimePht!, s.endTimePht!) : []
  // A shorter day (e.g. a 4-hour Saturday) is taken to start at the shift's
  // start, so it gets the night hours of its first hours only.
  const ndWeek =
    fixed && hasDayHours(s.dayHours)
      ? s.dayHours.reduce<number>((sum, d) => sum + (d != null && d > 0 ? nightDifferentialHours(s.startTimePht!, plusHours(s.startTimePht!, Math.min(d, shiftHours(s.startTimePht!, s.endTimePht!)))) : 0), 0)
      : null
  const nd = fixed
    ? ndPerDay > 0
      ? {
          on: true,
          text: `Applies ${ndSpans.map((x) => `${time12(x.from)}–${time12(x.to)}`).join(' and ')} PH time`,
          sub: `${h(ndPerDay)} a full day${ndWeek != null ? `, ${h(ndWeek)} a week` : ''}`,
        }
      : { on: false, text: 'Doesn’t apply', sub: 'The shift is outside 10:00 PM–6:00 AM PH time' }
    : { on: false, text: 'Only for hours worked 10:00 PM–6:00 AM PH time', sub: 'Flexible hours: no set time' }

  const rows: [string, React.ReactNode, React.ReactNode?][] = [
    ['Client time zone', timeZone ? zoneOnDate(timeZone, targetStartDate) : <span className="text-warning">Not set</span>, timeZone && timeZoneIsAccounts ? 'The account’s' : null],
    [
      'Required PH time',
      fixed ? `${time12(s.startTimePht!)}–${time12(s.endTimePht!)}` : 'Any time',
      fixed ? `Fixed shift, ${h(s.hoursPerDay ?? null)} a day` : 'Flexible: no set time',
    ],
    ...(fixed && timeZone
      ? ([['Client’s time', `${time12(phtToZoneTime(s.startTimePht!, timeZone, targetStartDate))}–${time12(phtToZoneTime(s.endTimePht!, timeZone, targetStartDate))}`, timeZone.replace(/_/g, ' ')]] as [string, React.ReactNode, React.ReactNode][])
      : []),
    ['Night differential', <span key="nd" className={cn(nd.on && 'font-medium')}>{nd.text}</span>, nd.sub],
  ]

  return (
    <div className="space-y-3 rounded-lg border px-3 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p>
          <span className="text-[11px] text-muted-foreground">Schedule </span>
          <span className="font-medium">{SCHEDULE_LABELS[s.scheduleType] ?? s.scheduleType}</span>
          <span className="text-muted-foreground"> · {SCHEDULE_GROUP_LABELS[scheduleGroupOf(s.scheduleType)]}</span>
        </p>
        {total && <p className="font-medium tabular-nums">{total}</p>}
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, value, sub]) => (
          <div key={label}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd>
              {value}
              {sub && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {daily && (
        <ol className="grid grid-cols-7 gap-1" aria-label="Hours each day">
          {WORK_DAYS.map((d, i) => {
            const hours = s.dayHours?.[i] ?? null
            const on = hours != null && hours > 0
            return (
              <li key={d} className={cn('rounded-md border px-1 py-1.5 text-center', on ? 'bg-primary/10' : 'text-muted-foreground')}>
                <span className="block text-[11px]">{d}</span>
                <span className={cn('block tabular-nums', on && 'font-medium')}>{on ? h(hours) : 'Off'}</span>
              </li>
            )
          })}
        </ol>
      )}
      {s.additionalHours && (
        <p>
          <span className="text-[11px] text-muted-foreground">Additional hours </span>
          {s.additionalHours}
        </p>
      )}
    </div>
  )
}
