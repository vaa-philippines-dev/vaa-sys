import { z } from 'zod'
import {
  SCHEDULE_LABELS,
  SCHEDULE_TYPES,
  WORK_DAYS,
  dayHoursFor,
  dayHoursFromJson,
  dayHoursSchema,
  dayHoursText,
  hasDayHours,
  isTimeZone,
  time12,
  workDaysOf,
  type DayHours,
  type ScheduleType,
} from '@/lib/onboarding-fields'

// Client-safe: a VA request's schedule as the schedule-change log keeps it
// (Nov 6, 2026; lib/request-schedule.ts). Only what the bill works from: the
// work hour type, its hours, a fixed shift's times (Philippine time), the
// hours for each day and the additional hours. The target start date and
// the tasks aren't part of it.

export type ScheduleSnapshot = {
  scheduleType: ScheduleType
  hoursPerDay: number | null
  hoursPerWeek: number | null
  hoursPerMonth: number | null
  projectHours: number | null
  startTimePht: string | null
  endTimePht: string | null
  // Mon..Sun, daily schedules only.
  dayHours: DayHours | null
  additionalHours: string | null
}

const n = (v: unknown) => (v == null ? null : Number(v))

// From a ticket_requests row (Decimals and JSON as Prisma returns them).
export function snapshotOf(r: {
  scheduleType: string
  hoursPerDay: unknown
  hoursPerWeek: unknown
  hoursPerMonth: unknown
  projectHours: unknown
  startTimePht: string | null
  endTimePht: string | null
  workDays: string[]
  dayHours: unknown
  additionalHours: string | null
}): ScheduleSnapshot {
  const scheduleType = r.scheduleType as ScheduleType
  const base = { scheduleType, hoursPerDay: n(r.hoursPerDay), startTimePht: r.startTimePht, endTimePht: r.endTimePht }
  return {
    ...base,
    hoursPerWeek: n(r.hoursPerWeek),
    hoursPerMonth: n(r.hoursPerMonth),
    projectHours: n(r.projectHours),
    dayHours: dayHoursFor({ ...base, dayHours: dayHoursFromJson(r.dayHours), workDays: r.workDays }),
    additionalHours: r.additionalHours || null,
  }
}

export function sameSchedule(a: ScheduleSnapshot, b: ScheduleSnapshot): boolean {
  return scheduleText(a) === scheduleText(b)
}

const h = (v: number | null) => (v == null ? '?' : `${Math.round(v * 100) / 100}`)

// "Daily, fixed time 8:00 AM–5:00 PM PH time: Mon–Fri 9h (45h a week)".
export function scheduleText(s: ScheduleSnapshot): string {
  const extra = s.additionalHours ? ` + ${s.additionalHours}` : ''
  const label = SCHEDULE_LABELS[s.scheduleType] ?? s.scheduleType
  if (s.scheduleType === 'PROJECT') return `${label}: ${h(s.projectHours)}h${extra}`
  if (s.scheduleType === 'WEEKLY_FLEXIBLE') return `${label}: ${h(s.hoursPerWeek)}h a week${extra}`
  if (s.scheduleType === 'MONTHLY') return `${label}: ${h(s.hoursPerMonth)}h a month${extra}`
  const times = s.scheduleType === 'DAILY_FIXED' && s.startTimePht && s.endTimePht ? ` ${time12(s.startTimePht)}–${time12(s.endTimePht)} PH time` : ''
  const days = hasDayHours(s.dayHours) ? `: ${dayHoursText(s.dayHours)} (${h(s.dayHours.reduce<number>((t, x) => t + (x ?? 0), 0))}h a week)` : ''
  return `${label}${times}${days}${extra}`
}

// ── Editing a schedule ───────────────────────────────────────────

const TIME_RE = /^\d{2}:\d{2}$/
const hours = (ceiling: number) => z.number('Enter the hours as a number.').positive('Use more than 0 hours.').max(ceiling).nullable()

// Staff edit a request's schedule from its service request (and the
// account's Details): looser than the onboarding form, no minimums.
export const scheduleEditSchema = z
  .object({
    scheduleType: z.enum(SCHEDULE_TYPES, 'Choose a work hour type.'),
    hoursPerDay: hours(24),
    hoursPerWeek: hours(168),
    hoursPerMonth: hours(744),
    projectHours: hours(10000),
    // Philippine time.
    startTimePht: z.string().trim().max(5),
    endTimePht: z.string().trim().max(5),
    dayHours: dayHoursSchema,
    additionalHours: z.string().trim().max(200),
    // The client's time zone for this request; blank = the account's.
    timeZone: z
      .string()
      .trim()
      .max(60)
      .refine((v) => v === '' || isTimeZone(v), 'Choose a time zone from the list.'),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (r.scheduleType === 'DAILY_FIXED' && (!TIME_RE.test(r.startTimePht) || !TIME_RE.test(r.endTimePht))) issue('startTimePht', 'Enter the start and end time (Philippine time).')
    if (r.scheduleType === 'DAILY_FLEXIBLE' && r.hoursPerDay == null) issue('hoursPerDay', 'Enter the hours a day.')
    if ((r.scheduleType === 'DAILY_FIXED' || r.scheduleType === 'DAILY_FLEXIBLE') && !hasDayHours(r.dayHours)) issue('dayHours', 'Enter the hours for at least one day.')
    if (r.scheduleType === 'WEEKLY_FLEXIBLE' && r.hoursPerWeek == null) issue('hoursPerWeek', 'Enter the hours a week.')
    if (r.scheduleType === 'MONTHLY' && r.hoursPerMonth == null) issue('hoursPerMonth', 'Enter the hours a month.')
    if (r.scheduleType === 'PROJECT' && r.projectHours == null) issue('projectHours', 'Enter the project hours.')
  })
export type ScheduleEdit = z.input<typeof scheduleEditSchema>

// What the schedule editor starts from.
export function scheduleEditOf(s: ScheduleSnapshot, timeZone: string | null): ScheduleEdit {
  return {
    scheduleType: s.scheduleType,
    hoursPerDay: s.hoursPerDay,
    hoursPerWeek: s.hoursPerWeek,
    hoursPerMonth: s.hoursPerMonth,
    projectHours: s.projectHours,
    startTimePht: s.startTimePht ?? '',
    endTimePht: s.endTimePht ?? '',
    dayHours: s.dayHours ?? WORK_DAYS.map(() => null),
    additionalHours: s.additionalHours ?? '',
    timeZone: timeZone ?? '',
  }
}

// The daily work days an edit leaves (the days with hours).
export const editWorkDays = (e: { dayHours?: DayHours | null }) => (hasDayHours(e.dayHours) ? workDaysOf(e.dayHours) : [])

// Who checks a change: shown on the notices.
export const REVIEWER = 'Executive Support'

// ── Service and department changes (Nov 6, 2026) ──────────────────

// What a SERVICE change keeps before and after. The department's name is
// kept too, so the history reads well if Workforce renames it.
export type ServiceSnapshot = { service: string; departmentId: string | null; department: string | null }

export const serviceText = (s: ServiceSnapshot) => `${s.service} · ${s.department ?? 'no department'}`

// A logged change (schedule_changes), as one line.
export function changeText(kind: string, value: unknown): string {
  return kind === 'SERVICE' ? serviceText(value as ServiceSnapshot) : scheduleText(value as ScheduleSnapshot)
}
export const CHANGE_KIND_LABELS: Record<string, string> = { SCHEDULE: 'Schedule', SERVICE: 'Service and department' }

export const serviceChangeSchema = z.object({
  service: z.string().trim().min(1, 'Pick the service.').max(120),
  departmentId: z.string().trim().min(1, 'Pick the department.').max(60),
})
