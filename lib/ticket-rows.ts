import { nightDifferentialHours, shiftHours, type VaRequest } from '@/lib/onboarding-fields'

// Server-side: one VA as a sub-ticket row (vaa_sys.ticket_requests), for the
// onboarding form's ticket and for service requests opened in Customer
// Management (lib/service-requests.ts). Hours are stored per schedule type;
// a fixed shift's hours and night differential are worked out from its
// times. The platform now lives on the account, so new rows leave it empty.
export function requestRow(r: VaRequest, lineNo: number) {
  const fixed = r.scheduleType === 'DAILY_FIXED'
  const daily = fixed || r.scheduleType === 'DAILY_FLEXIBLE'
  const [y, m, d] = r.targetStartDate.split('-').map(Number)
  return {
    lineNo,
    service: r.service,
    numberOfVas: 1,
    scheduleType: r.scheduleType,
    hoursPerWeek: r.scheduleType === 'WEEKLY_FLEXIBLE' ? r.hoursPerWeek : null,
    hoursPerMonth: r.scheduleType === 'MONTHLY' ? r.hoursPerMonth : null,
    hoursPerDay: r.scheduleType === 'DAILY_FLEXIBLE' ? r.hoursPerDay : fixed ? shiftHours(r.startTimePht, r.endTimePht) : null,
    projectHours: r.scheduleType === 'PROJECT' ? r.projectHours : null,
    startTimePht: fixed ? r.startTimePht : null,
    endTimePht: fixed ? r.endTimePht : null,
    workDays: daily ? r.workDays : [],
    nightDifferential: fixed && nightDifferentialHours(r.startTimePht, r.endTimePht) > 0,
    additionalHours: r.additionalHours || null,
    // Date.UTC, never new Date('YYYY-MM-DD') parsing in local time.
    targetStartDate: new Date(Date.UTC(y, m - 1, d)),
    // The column predates tasks being optional, so no answer is stored as ''.
    tasks: r.tasks,
    tools: r.tools || null,
    taskTracker: r.taskTracker,
  }
}
