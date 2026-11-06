import { prisma } from '@/lib/prisma'
import { Prisma } from '@/src/generated/prisma/client'
import { logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { assertCustomerInScope, customerScopeWhere } from '@/lib/scope'
import { dayHoursToJson, hasDayHours, shiftHours, nightDifferentialHours, subTicketCode, workDaysOf } from '@/lib/onboarding-fields'
import { REVIEWER, sameSchedule, scheduleText, snapshotOf, type ScheduleEdit, type ScheduleSnapshot } from '@/lib/request-schedule-fields'
import { SR_PHASE_LABELS, isClosed, type SrPhase } from '@/lib/service-request-fields'
import { departmentInfo, managesDepartment, requestDepartment } from '@/lib/request-departments'

// Server-only: changes to a VA request's schedule (Nov 6, 2026).
//
// Every change is kept (vaa_sys.schedule_changes), also after the VA is
// connected, so the schedule can be followed over time. A change while the
// service request is still open affects the initial bill: Lead Management
// is told (its Schedule changes page and the lead's page) and Executive
// Support checks it. Until then the VA can't be marked started
// (scheduleHold below, used by lib/service-requests.ts).

type Tx = Prisma.TransactionClient
type Result<T = null> = { ok: true; data: T } | { ok: false; error: string }

// Inside the transaction that saves the new schedule. Does nothing when the
// schedule didn't change.
export async function recordScheduleChange(
  tx: Tx,
  actor: Actor,
  t: { id: string; ticketNumber: number; customerId: string; phase: string },
  request: { id: string; lineNo: number },
  before: ScheduleSnapshot,
  after: ScheduleSnapshot
): Promise<boolean> {
  if (sameSchedule(before, after)) return false
  const open = !isClosed(t.phase as SrPhase)
  await tx.scheduleChange.create({
    data: {
      ticketId: t.id,
      requestId: request.id,
      changedByEmail: actor.email.toLowerCase(),
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      phase: t.phase,
      needsReview: open,
    },
  })
  await logActivity(tx, actor, {
    entityType: 'ServiceRequest',
    entityId: t.id,
    entityLabel: subTicketCode(t.ticketNumber, request.lineNo),
    customerId: t.customerId,
    action: 'UPDATE',
    field: 'schedule',
    oldValue: scheduleText(before),
    newValue: scheduleText(after),
    notes: open ? `Schedule changed during ${SR_PHASE_LABELS[t.phase as SrPhase] ?? t.phase}: affects billing, waiting for ${REVIEWER}` : 'Schedule changed after the service request closed',
  })
  return true
}

// The ticket_requests columns a schedule edit sets.
export function scheduleColumns(e: ScheduleEdit) {
  const fixed = e.scheduleType === 'DAILY_FIXED'
  const daily = fixed || e.scheduleType === 'DAILY_FLEXIBLE'
  const hoursPerDay = e.scheduleType === 'DAILY_FLEXIBLE' ? (e.hoursPerDay ?? null) : fixed ? shiftHours(e.startTimePht, e.endTimePht) : null
  const days = daily && hasDayHours(e.dayHours) ? e.dayHours : null
  return {
    scheduleType: e.scheduleType,
    hoursPerDay,
    hoursPerWeek: e.scheduleType === 'WEEKLY_FLEXIBLE' ? (e.hoursPerWeek ?? null) : null,
    hoursPerMonth: e.scheduleType === 'MONTHLY' ? (e.hoursPerMonth ?? null) : null,
    projectHours: e.scheduleType === 'PROJECT' ? (e.projectHours ?? null) : null,
    startTimePht: fixed ? e.startTimePht : null,
    endTimePht: fixed ? e.endTimePht : null,
    workDays: days ? workDaysOf(days) : [],
    // DbNull clears them when the schedule stops being daily.
    dayHours: days ? (dayHoursToJson(days) as Prisma.InputJsonValue) : Prisma.DbNull,
    nightDifferential: fixed && nightDifferentialHours(e.startTimePht, e.endTimePht) > 0,
    additionalHours: e.additionalHours || null,
  }
}

// What a snapshot of the saved columns would be, without reading them back.
export function snapshotOfColumns(c: ReturnType<typeof scheduleColumns>): ScheduleSnapshot {
  return snapshotOf({ ...c, dayHours: c.dayHours === Prisma.DbNull ? null : c.dayHours })
}

// The customer's CS, a Service Department Manager of the request's
// department, or an admin may change a request's schedule.
async function mayEditSchedule(actor: Actor, t: { customerId: string }, r: { departmentId: string | null; service: string }) {
  if (actor.role === 'ADMIN' || actor.role === 'CS_MANAGER') return true
  if (actor.role === 'SERVICE_MANAGER') return managesDepartment(actor, requestDepartment(await departmentInfo(), r))
  return actor.role === 'CUSTOMER_SPECIALIST' && (await assertCustomerInScope(actor, t.customerId))
}

export async function updateRequestSchedule(actor: Actor, requestId: string, e: ScheduleEdit): Promise<Result<{ ticketId: string; changed: boolean; needsReview: boolean }>> {
  const r = await prisma.ticketRequest.findUnique({
    where: { id: requestId },
    include: { ticket: { select: { id: true, ticketNumber: true, customerId: true, phase: true } } },
  })
  if (!r) return { ok: false, error: 'That VA request no longer exists.' }
  if (!(await mayEditSchedule(actor, r.ticket, r))) return { ok: false, error: 'Only the customer’s CS or a Service Department Manager of this request’s department can change the schedule.' }
  const columns = scheduleColumns(e)
  const before = snapshotOf(r)
  const after = snapshotOfColumns(columns)
  const timeZone = e.timeZone || null
  const changed = !sameSchedule(before, after)
  if (!changed && timeZone === r.timeZone) return { ok: true, data: { ticketId: r.ticketId, changed: false, needsReview: false } }

  await prisma.$transaction(async (tx) => {
    await tx.ticketRequest.update({ where: { id: requestId }, data: { ...columns, timeZone } })
    if (timeZone !== r.timeZone)
      await logActivity(tx, actor, {
        entityType: 'ServiceRequest',
        entityId: r.ticketId,
        entityLabel: subTicketCode(r.ticket.ticketNumber, r.lineNo),
        customerId: r.ticket.customerId,
        action: 'UPDATE',
        field: 'timeZone',
        oldValue: r.timeZone ?? 'the account’s',
        newValue: timeZone ?? 'the account’s',
      })
    await recordScheduleChange(tx, actor, r.ticket, r, before, after)
  })
  return { ok: true, data: { ticketId: r.ticketId, changed, needsReview: changed && !isClosed(r.ticket.phase as SrPhase) } }
}

// Executive Support (or an admin) checks a change made while the request was open.
export async function reviewScheduleChange(actor: Actor, id: string, note: string): Promise<Result<{ ticketId: string }>> {
  if (!can(actor.role, 'scheduleReviews', 'update')) return { ok: false, error: `Only ${REVIEWER} can check schedule changes.` }
  const c = await prisma.scheduleChange.findUnique({ where: { id }, include: { ticket: { select: { ticketNumber: true, customerId: true } }, request: { select: { lineNo: true } } } })
  if (!c) return { ok: false, error: 'That schedule change no longer exists.' }
  if (!c.needsReview || c.reviewedAt) return { ok: false, error: 'That change has already been checked.' }
  await prisma.$transaction(async (tx) => {
    const done = await tx.scheduleChange.updateMany({ where: { id, reviewedAt: null }, data: { reviewedAt: new Date(), reviewedByEmail: actor.email.toLowerCase(), reviewNote: note || null } })
    if (done.count === 0) return
    await logActivity(tx, actor, {
      entityType: 'ServiceRequest',
      entityId: c.ticketId,
      entityLabel: subTicketCode(c.ticket.ticketNumber, c.request.lineNo),
      customerId: c.ticket.customerId,
      action: 'UPDATE',
      field: 'scheduleReview',
      newValue: 'Checked',
      notes: `${c.kind === 'SERVICE' ? 'Service and department change' : 'Schedule change'} checked${note ? `: ${note}` : ''}`,
    })
  })
  return { ok: true, data: { ticketId: c.ticketId } }
}

// Changes still waiting for the check on a ticket: the VA can't start until none are left.
export async function scheduleHold(db: Tx | typeof prisma, ticketId: string): Promise<number> {
  return db.scheduleChange.count({ where: { ticketId, needsReview: true, reviewedAt: null } })
}

export async function countSchedulesToReview(): Promise<number> {
  return prisma.scheduleChange.count({ where: { needsReview: true, reviewedAt: null, ticket: { customer: { isTest: false } } } })
}

const changeInclude = {
  ticket: { select: { id: true, ticketNumber: true, phase: true, customer: { select: { id: true, name: true, isTest: true, leadPhase: true, status: true } }, account: { select: { id: true, name: true, accountCode: true } } } },
  request: { select: { id: true, lineNo: true, service: true } },
} satisfies Prisma.ScheduleChangeInclude
export type ScheduleChangeRow = Prisma.ScheduleChangeGetPayload<{ include: typeof changeInclude }>

// The Schedule changes pages (Customer Management and Lead Management): the
// changes waiting for the check, or all of them. A CS Specialist sees their
// own customers'.
export async function listScheduleChanges(actor: Actor, params: { show: 'waiting' | 'all'; customerId?: string; ticketId?: string }): Promise<ScheduleChangeRow[]> {
  const scope = await customerScopeWhere(actor)
  return prisma.scheduleChange.findMany({
    where: {
      AND: [
        scope ? { ticket: { customer: scope } } : {},
        params.show === 'waiting' ? { needsReview: true, reviewedAt: null } : {},
        params.customerId ? { ticket: { customerId: params.customerId } } : {},
        params.ticketId ? { ticketId: params.ticketId } : {},
      ],
    },
    orderBy: { changedAt: 'desc' },
    take: 500,
    include: changeInclude,
  })
}
