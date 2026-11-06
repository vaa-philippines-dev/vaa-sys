'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import {
  SCHEDULES_IN_GROUP,
  SCHEDULE_GROUPS,
  SCHEDULE_GROUP_LABELS,
  SCHEDULE_LABELS,
  WORK_DAYS,
  fillDayHours,
  hasDayHours,
  isDaily,
  phtToZoneTime,
  scheduleGroupOf,
  shiftHours,
  time12,
  usualDayHours,
  weeklyHoursOf,
  type DayHours,
  type ScheduleGroup,
  type ScheduleType,
} from '@/lib/onboarding-fields'

// A VA request's schedule, for staff forms (opening a service request,
// editing one, the account's Details): Regular or Project-based first, then
// the work hour type and its hours. A daily schedule has hours for each day:
// typing the hours a day (or a fixed shift) fills the work days, Mon–Fri to
// start with, and each day can be changed, Sat and Sun included. Fixed times
// are Philippine time.

export type ScheduleValue = {
  scheduleType: ScheduleType | ''
  hoursPerDay: number | null
  hoursPerWeek: number | null
  hoursPerMonth: number | null
  projectHours: number | null
  startTimePht: string
  endTimePht: string
  dayHours: DayHours
  additionalHours: string
}

const TIME_RE = /^\d{2}:\d{2}$/
const num = (v: string) => (v.trim() === '' ? null : Number(v))
const shown = (v: number | null) => (v == null || Number.isNaN(v) ? '' : String(v))

export function ScheduleFields({
  id,
  value,
  onChange,
  disabled,
  clientTimeZone,
  targetStartDate,
}: {
  id: string
  value: ScheduleValue
  onChange: (next: ScheduleValue) => void
  disabled?: boolean
  // The client's zone, to show a fixed shift in their time too.
  clientTimeZone?: string | null
  targetStartDate?: string
}) {
  const v = value
  const group: ScheduleGroup | '' = v.scheduleType ? scheduleGroupOf(v.scheduleType) : ''
  const daily = isDaily(v.scheduleType)
  const fixedOk = v.scheduleType === 'DAILY_FIXED' && TIME_RE.test(v.startTimePht) && TIME_RE.test(v.endTimePht)

  // Any change that sets the usual hours a day refills the work days.
  const set = (patch: Partial<ScheduleValue>) => {
    const next = { ...v, ...patch }
    const refill = 'hoursPerDay' in patch || 'startTimePht' in patch || 'endTimePht' in patch || ('scheduleType' in patch && !hasDayHours(next.dayHours))
    if (isDaily(next.scheduleType) && refill) {
      const perDay = usualDayHours(next)
      if (perDay != null) next.dayHours = fillDayHours(next.dayHours, perDay)
    }
    onChange(next)
  }
  const setDay = (i: number, h: number | null) => onChange({ ...v, dayHours: v.dayHours.map((x, j) => (j === i ? h : x)) })

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-group`}>Schedule</Label>
          <NativeSelect
            id={`${id}-group`}
            value={group}
            onChange={(e) => {
              const g = e.target.value as ScheduleGroup | ''
              set({ scheduleType: g === 'PROJECT_BASED' ? 'PROJECT' : g === 'REGULAR' ? (v.scheduleType && v.scheduleType !== 'PROJECT' ? v.scheduleType : 'DAILY_FIXED') : '' })
            }}
            disabled={disabled}
          >
            <option value="">Pick one…</option>
            {SCHEDULE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {SCHEDULE_GROUP_LABELS[g]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {group === 'REGULAR' && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-type`}>Regular schedule</Label>
            <NativeSelect id={`${id}-type`} value={v.scheduleType} onChange={(e) => set({ scheduleType: e.target.value as ScheduleType })} disabled={disabled}>
              {SCHEDULES_IN_GROUP.REGULAR.map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {v.scheduleType === 'DAILY_FIXED' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-from`}>Starts (PH time)</Label>
              <Input id={`${id}-from`} type="time" value={v.startTimePht} onChange={(e) => set({ startTimePht: e.target.value })} disabled={disabled} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-to`}>Ends (PH time)</Label>
              <Input id={`${id}-to`} type="time" value={v.endTimePht} onChange={(e) => set({ endTimePht: e.target.value })} disabled={disabled} />
            </div>
          </>
        )}
        {v.scheduleType === 'DAILY_FLEXIBLE' && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-hpd`}>Hours a day</Label>
            <Input id={`${id}-hpd`} type="number" min={0} max={24} step={0.5} value={shown(v.hoursPerDay)} onChange={(e) => set({ hoursPerDay: num(e.target.value) })} disabled={disabled} />
          </div>
        )}
        {v.scheduleType === 'WEEKLY_FLEXIBLE' && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-hpw`}>Hours a week</Label>
            <Input id={`${id}-hpw`} type="number" min={0} step={0.5} value={shown(v.hoursPerWeek)} onChange={(e) => set({ hoursPerWeek: num(e.target.value) })} disabled={disabled} />
          </div>
        )}
        {v.scheduleType === 'MONTHLY' && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-hpm`}>Hours a month</Label>
            <Input id={`${id}-hpm`} type="number" min={0} step={0.5} value={shown(v.hoursPerMonth)} onChange={(e) => set({ hoursPerMonth: num(e.target.value) })} disabled={disabled} />
          </div>
        )}
        {v.scheduleType === 'PROJECT' && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-ph`}>Project hours</Label>
            <Input id={`${id}-ph`} type="number" min={0} step={0.5} value={shown(v.projectHours)} onChange={(e) => set({ projectHours: num(e.target.value) })} disabled={disabled} />
          </div>
        )}
      </div>

      {fixedOk && (
        <p className="text-xs text-muted-foreground">
          {shiftHours(v.startTimePht, v.endTimePht)} hours a shift
          {clientTimeZone &&
            ` · ${time12(phtToZoneTime(v.startTimePht, clientTimeZone, targetStartDate))}–${time12(phtToZoneTime(v.endTimePht, clientTimeZone, targetStartDate))} in ${clientTimeZone.replace(/_/g, ' ')}`}
        </p>
      )}

      {daily && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Hours each day</legend>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WORK_DAYS.map((d, i) => (
              <div key={d} className="space-y-1">
                <Label htmlFor={`${id}-day-${d}`} className="text-xs text-muted-foreground">
                  {d}
                </Label>
                <Input
                  id={`${id}-day-${d}`}
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  inputMode="decimal"
                  value={shown(v.dayHours[i])}
                  onChange={(e) => setDay(i, num(e.target.value))}
                  placeholder="Off"
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {hasDayHours(v.dayHours) ? `${weeklyHoursOf(v.dayHours)} hours a week. ` : ''}A blank day is a day off.
          </p>
        </fieldset>
      )}

      {v.scheduleType && (
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor={`${id}-extra`}>Additional hours</Label>
          <Input id={`${id}-extra`} value={v.additionalHours} onChange={(e) => set({ additionalHours: e.target.value })} placeholder="e.g. 1H Sat or Sun" disabled={disabled} />
        </div>
      )}
    </div>
  )
}
