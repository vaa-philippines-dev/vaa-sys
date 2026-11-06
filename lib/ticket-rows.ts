import { Prisma } from '@/src/generated/prisma/client'
import { dayHoursFor, dayHoursToJson, nightDifferentialHours, shiftHours, workDaysOf, type VaRequest } from '@/lib/onboarding-fields'

// Server-side: one VA as a sub-ticket row (vaa_sys.ticket_requests), for the
// onboarding form's ticket, service requests opened in Customer Management
// (lib/service-requests.ts) and the ticket import. Hours are stored per
// schedule type; a fixed shift's hours and night differential are worked out
// from its times. A daily schedule keeps its hours for each day (day_hours),
// and its work days are the days with hours. The platform now lives on the
// account, so new rows leave it empty.
export function requestRow(r: VaRequest, lineNo: number) {
  return { lineNo, numberOfVas: 1, ...requestFields(r) }
}

// The columns a VA request's form sets (everything but its line and count).
export function requestFields(r: Omit<VaRequest, 'numberOfVas'>) {
  const fixed = r.scheduleType === 'DAILY_FIXED'
  const daily = fixed || r.scheduleType === 'DAILY_FLEXIBLE'
  const [y, m, d] = r.targetStartDate.split('-').map(Number)
  const hoursPerDay = r.scheduleType === 'DAILY_FLEXIBLE' ? r.hoursPerDay : fixed ? shiftHours(r.startTimePht, r.endTimePht) : null
  const days = daily ? dayHoursFor({ ...r, hoursPerDay }) : null
  return {
    service: r.service,
    scheduleType: r.scheduleType,
    hoursPerWeek: r.scheduleType === 'WEEKLY_FLEXIBLE' ? r.hoursPerWeek : null,
    hoursPerMonth: r.scheduleType === 'MONTHLY' ? r.hoursPerMonth : null,
    hoursPerDay,
    projectHours: r.scheduleType === 'PROJECT' ? r.projectHours : null,
    startTimePht: fixed ? r.startTimePht : null,
    endTimePht: fixed ? r.endTimePht : null,
    workDays: days ? workDaysOf(days) : [],
    // DbNull, not undefined, so an edit away from a daily schedule clears them.
    dayHours: days ? dayHoursToJson(days) : Prisma.DbNull,
    nightDifferential: fixed && nightDifferentialHours(r.startTimePht, r.endTimePht) > 0,
    additionalHours: r.additionalHours || null,
    // Date.UTC, never new Date('YYYY-MM-DD') parsing in local time.
    targetStartDate: new Date(Date.UTC(y, m - 1, d)),
    // The column predates tasks being optional, so no answer is stored as ''.
    tasks: r.tasks,
    tools: r.tools || null,
    taskTracker: r.taskTracker,
    timeZone: r.timeZone || null,
    mustHaves: r.mustHaves || null,
  }
}
