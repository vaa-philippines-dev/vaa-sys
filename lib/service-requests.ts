import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'
import { dateOnly, manilaStartOf, manilaToday } from '@/lib/customer-fields'
import { customerScopeWhere, assertCustomerInScope } from '@/lib/scope'
import { activateOnConnectionStart } from '@/lib/va-connection-hooks'
import { requestRow } from '@/lib/ticket-rows'
import { scheduleHold } from '@/lib/request-schedule'
import { departmentForService, departmentInfo, managesDepartment, requestDepartment } from '@/lib/request-departments'
import { listServiceDepartments } from '@/lib/workforce'
import { SERVICE_OFFERINGS, subTicketCode } from '@/lib/onboarding-fields'
import { REVIEWER, serviceText, type ServiceSnapshot } from '@/lib/request-schedule-fields'
import { cancelRateAgreements, openRateAgreement } from '@/lib/rate-agreement-hooks'
import type { VaRequest } from '@/lib/onboarding-fields'
import { CANDIDATE_STAGE_LABELS, SR_PHASE_LABELS, SR_TYPE_LABELS, isClosed, phaseFor, srCode, type CandidateStage, type SrPhase, type SrType, type VaOption } from '@/lib/service-request-fields'

// Server-only: Customer Management's Service Requests (lib/service-request-fields.ts
// has the workflow). Every step checks who may take it, writes the
// activity log in the same transaction, and works the ticket's phase out
// again (recompute below).
//
// Who acts:
// - the customer's CS (their CS Specialist, someone covering them, a CS
//   Manager or an admin): a VA request's department, the kick-off call, the
//   connection call's outcome, and closing a ticket as lost;
// - a Service Department Manager of the VA request's department (any active
//   Service Manager of it on Access, or an admin): assign VAs, move them to
//   Rate Agreement, and mark one started (lib/request-departments.ts);
// - HR: the Rate Agreement (lib/rate-agreements.ts). Moving a VA to Rate
//   Agreement opens one; the VA moves on once they acknowledge it.

type Tx = Prisma.TransactionClient
type Result<T = null> = { ok: true; data: T } | { ok: false; error: string }
const TX = { maxWait: 10_000, timeout: 30_000 }

// ── Who may act ───────────────────────────────────────────────────

async function isCsFor(actor: Actor, customerId: string) {
  if (actor.role === 'ADMIN' || actor.role === 'CS_MANAGER') return true
  return actor.role === 'CUSTOMER_SPECIALIST' && (await assertCustomerInScope(actor, customerId))
}
// A request's department, worked out from its service when it has none yet.
async function departmentOfRequest(r: { departmentId: string | null; service: string }) {
  return r.departmentId ?? departmentForService(await departmentInfo(), r.service)
}
const isHr = (actor: Actor) => actor.role === 'ADMIN' || actor.role === 'HR_SPECIALIST' || actor.role === 'HR_MANAGER'

// ── Reading ───────────────────────────────────────────────────────

const ticketInclude = {
  customer: { select: { id: true, name: true, customerCode: true, assignedSpecialistEmail: true, isTest: true } },
  account: { select: { id: true, name: true, accountCode: true, status: true, timeZone: true, contacts: { where: { isFocal: true }, select: { firstName: true, lastName: true, email: true, whatsapp: true, role: true } } } },
  requests: { orderBy: { lineNo: 'asc' } },
  candidates: { orderBy: [{ role: 'asc' }, { assignedAt: 'asc' }] },
  connections: { select: { id: true, connectionCode: true, candidateId: true, status: true, startDate: true } },
  scheduleChanges: { orderBy: { changedAt: 'desc' } },
  rateAgreements: { select: { id: true, candidateId: true, status: true, assignedToEmail: true, sentOn: true } },
} satisfies Prisma.TicketInclude
export type ServiceRequestFull = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>

export async function getServiceRequest(id: string) {
  return prisma.ticket.findUnique({ where: { id }, include: ticketInclude })
}

// HR sees only the tickets that have reached Rate Agreement (Nov 6, 2026):
// those with a Rate Agreement, cancelled ones included.
const isHrRole = (actor: Actor) => actor.role === 'HR_SPECIALIST' || actor.role === 'HR_MANAGER'
export const hrTicketWhere = (actor: Actor): Prisma.TicketWhereInput => (isHrRole(actor) ? { rateAgreements: { some: {} } } : {})

// The list: everyone with Service Requests sees every ticket, except a CS
// Specialist, who sees their own customers', and HR (above).
export async function listServiceRequests(actor: Actor, params: { phase?: SrPhase | 'OPEN' | 'ALL'; mine?: boolean; q?: string }) {
  const scope = await customerScopeWhere(actor)
  const q = params.q?.trim()
  const number = q && /^(tkt-?)?\d+$/i.test(q) ? Number(q.replace(/\D/g, '')) : null
  const me = actor.email.toLowerCase()
  const mine: Prisma.TicketWhereInput | null = !params.mine
    ? null
    : actor.role === 'SERVICE_MANAGER'
      ? { requests: { some: { departmentId: actor.departmentId ?? '-' } }, phase: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } }
      : actor.role === 'HR_SPECIALIST'
        ? { rateAgreements: { some: { assignedToEmail: me, status: { notIn: ['VA_ACKNOWLEDGED', 'CANCELLED'] } } } }
        : actor.role === 'HR_MANAGER'
          ? { rateAgreements: { some: { status: { notIn: ['VA_ACKNOWLEDGED', 'CANCELLED'] } } } }
          : { customer: { assignedSpecialistEmail: me } }
  return prisma.ticket.findMany({
    where: {
      AND: [
        scope ? { customer: scope } : {},
        hrTicketWhere(actor),
        params.phase === 'ALL' || !params.phase ? {} : params.phase === 'OPEN' ? { phase: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } } : { phase: params.phase },
        mine ?? {},
        q
          ? {
              OR: [
                ...(number ? [{ ticketNumber: number }] : []),
                { account: { name: { contains: q, mode: 'insensitive' as const } } },
                { account: { accountCode: { contains: q, mode: 'insensitive' as const } } },
                { customer: { name: { contains: q, mode: 'insensitive' as const } } },
              ],
            }
          : {},
      ],
    },
    orderBy: { ticketNumber: 'desc' },
    take: 2000,
    include: {
      customer: { select: { id: true, name: true, assignedSpecialistEmail: true, isTest: true } },
      account: { select: { id: true, name: true, accountCode: true } },
      requests: { select: { id: true, service: true, lineNo: true, departmentId: true, scheduleType: true }, orderBy: { lineNo: 'asc' } },
      candidates: { select: { requestId: true, stage: true, vaName: true } },
    },
  })
}

export async function phaseCounts(actor: Actor) {
  const scope = await customerScopeWhere(actor)
  const rows = await prisma.ticket.groupBy({ by: ['phase'], where: { AND: [scope ? { customer: scope } : {}, hrTicketWhere(actor)] }, _count: { _all: true } })
  return Object.fromEntries(rows.map((r) => [r.phase, r._count._all])) as Partial<Record<SrPhase, number>>
}

// VA Workforce's VAs (read-only), for the assign picker: active VAs with a
// profile, those in the ticket's department first, with how many Started
// connections each has here.
export async function searchVas(query: string, departmentId: string | null): Promise<VaOption[]> {
  const q = `%${query.trim().toLowerCase()}%`
  const rows = await prisma.$queryRaw<{ id: string; name: string; email: string | null; departments: string[]; availability: string | null; inDept: boolean }[]>`
    SELECT vp.id,
           trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS name,
           lower(u.email) AS email,
           coalesce(array_agg(DISTINCT d.name) FILTER (WHERE d.id IS NOT NULL), ARRAY[]::text[]) AS departments,
           vp.availability_status::text AS availability,
           bool_or(dm.department_id = ${departmentId ?? ''}) AS "inDept"
    FROM public.va_profiles vp
    JOIN public.users u ON u.id = vp.user_id
    LEFT JOIN public.department_memberships dm ON dm.user_id = u.id AND dm.ended_at IS NULL
    LEFT JOIN public.departments d ON d.id = dm.department_id
    WHERE u.is_active AND vp.is_active
      AND (${query.trim()} = '' OR lower(u.first_name || ' ' || u.last_name) LIKE ${q} OR lower(u.email) LIKE ${q})
    GROUP BY vp.id, u.first_name, u.last_name, u.email, vp.availability_status
    ORDER BY bool_or(dm.department_id = ${departmentId ?? ''}) DESC NULLS LAST, u.first_name, u.last_name
    LIMIT 30`
  const working = await prisma.vaConnection.groupBy({ by: ['vaProfileId'], where: { status: 'STARTED', vaProfileId: { in: rows.map((r) => r.id) }, customer: { isTest: false } }, _count: { _all: true } })
  const count = new Map(working.map((w) => [w.vaProfileId, w._count._all]))
  return rows.map((r) => ({ id: r.id, name: r.name || r.email || r.id, email: r.email, departments: r.departments, availability: r.availability, working: count.get(r.id) ?? 0 }))
}

// ── The phase ─────────────────────────────────────────────────────

async function recompute(tx: Tx, actor: Actor, ticketId: string, note: string) {
  const t = await tx.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { phase: true, ticketNumber: true, customerId: true, closedReason: true, closedAt: true, requests: { select: { id: true } }, candidates: { select: { requestId: true, stage: true } } },
  })
  const phase = phaseFor({
    closed: t.phase === 'CLOSED_LOST' ? 'LOST' : null,
    requests: t.requests.map((r) => {
      const stages = t.candidates.filter((c) => c.requestId === r.id).map((c) => c.stage as CandidateStage)
      return { started: stages.includes('STARTED'), stages }
    }),
  })
  if (phase === t.phase) return phase
  const now = new Date()
  await tx.ticket.update({
    where: { id: ticketId },
    data: { phase, phaseChangedAt: now, ...(phase === 'CLOSED_WON' ? { closedAt: now, closedByEmail: actor.email.toLowerCase(), closedReason: null } : {}) },
  })
  await logActivity(tx, actor, {
    entityType: 'ServiceRequest',
    entityId: ticketId,
    entityLabel: srCode(t.ticketNumber),
    customerId: t.customerId,
    action: 'PHASE_CHANGE',
    field: 'phase',
    oldValue: SR_PHASE_LABELS[t.phase as SrPhase],
    newValue: SR_PHASE_LABELS[phase],
    notes: note,
  })
  return phase
}

async function loadTicket(id: string) {
  return prisma.ticket.findUnique({
    where: { id },
    select: { id: true, ticketNumber: true, phase: true, customerId: true, accountId: true, requests: { select: { id: true, service: true, lineNo: true, departmentId: true } } },
  })
}

const logBase = (t: { id: string; ticketNumber: number; customerId: string }) => ({ entityType: 'ServiceRequest', entityId: t.id, entityLabel: srCode(t.ticketNumber), customerId: t.customerId })

// ── Steps ─────────────────────────────────────────────────────────

// The customer's CS changes a VA request's service and department (Nov 6,
// 2026; the department starts as its service's), after confirming it on the
// page. Its department's Service Managers then act on it. Every change is
// kept with the schedule changes (kind SERVICE). On an open New ticket it's
// a significant change to what the customer signed up for: Executive
// Support checks it, and the VA can't be marked started until then.
export async function changeRequestService(actor: Actor, requestId: string, input: { service: string; departmentId: string }): Promise<Result<{ ticketId: string; needsReview: boolean }>> {
  const r = await prisma.ticketRequest.findUnique({
    where: { id: requestId },
    select: { id: true, lineNo: true, service: true, departmentId: true, ticket: { select: { id: true, ticketNumber: true, phase: true, type: true, customerId: true } }, candidates: { where: { stage: 'STARTED' }, select: { id: true } } },
  })
  if (!r) return { ok: false, error: 'That VA request no longer exists.' }
  if (isClosed(r.ticket.phase as SrPhase)) return { ok: false, error: 'This service request is closed.' }
  if (r.candidates.length) return { ok: false, error: 'A VA already started on this request, so its service can’t change.' }
  if (!(await isCsFor(actor, r.ticket.customerId))) return { ok: false, error: 'Only the customer’s CS can change the service or department.' }
  const service = input.service.trim()
  if (service !== r.service && !(SERVICE_OFFERINGS as readonly string[]).includes(service)) return { ok: false, error: 'Pick one of the services in the list.' }
  const [departments, info] = await Promise.all([listServiceDepartments(), departmentInfo()])
  const dept = departments.find((d) => d.id === input.departmentId)
  if (!dept) return { ok: false, error: 'Pick one of VAA Workforce’s service departments.' }
  const oldDept = requestDepartment(info, r)
  if (service === r.service && dept.id === oldDept) return { ok: true, data: { ticketId: r.ticket.id, needsReview: false } }

  const before: ServiceSnapshot = { service: r.service, departmentId: oldDept, department: departments.find((d) => d.id === oldDept)?.name ?? null }
  const after: ServiceSnapshot = { service, departmentId: dept.id, department: dept.name }
  const needsReview = r.ticket.type === 'NEW'
  await prisma.$transaction(async (tx) => {
    await tx.ticketRequest.update({ where: { id: requestId }, data: { service, departmentId: dept.id } })
    await tx.scheduleChange.create({
      data: {
        ticketId: r.ticket.id,
        requestId,
        kind: 'SERVICE',
        changedByEmail: actor.email.toLowerCase(),
        before: before as unknown as Prisma.InputJsonValue,
        after: after as unknown as Prisma.InputJsonValue,
        phase: r.ticket.phase,
        needsReview,
      },
    })
    await logActivity(tx, actor, {
      ...logBase(r.ticket),
      entityLabel: subTicketCode(r.ticket.ticketNumber, r.lineNo),
      action: 'UPDATE',
      field: 'service and department',
      oldValue: serviceText(before),
      newValue: serviceText(after),
      notes: needsReview ? `Changed on a New request: waiting for ${REVIEWER}` : undefined,
    })
  }, TX)
  return { ok: true, data: { ticketId: r.ticket.id, needsReview } }
}

// VA Assignment: the manager puts a VA forward for one VA request.
export async function addCandidate(actor: Actor, ticketId: string, input: { requestId: string; vaProfileId: string; role: 'MAIN' | 'BUFFER' }): Promise<Result> {
  const t = await loadTicket(ticketId)
  if (!t) return { ok: false, error: 'That service request no longer exists.' }
  if (isClosed(t.phase as SrPhase)) return { ok: false, error: 'This service request is closed.' }
  const request = t.requests.find((r) => r.id === input.requestId)
  if (!request) return { ok: false, error: 'That VA request isn’t on this ticket.' }
  if (!managesDepartment(actor, await departmentOfRequest(request))) return { ok: false, error: 'Only a Service Department Manager of this VA request’s department can assign VAs.' }
  const started = await prisma.serviceRequestCandidate.count({ where: { requestId: request.id, stage: 'STARTED' } })
  if (started) return { ok: false, error: 'This VA request already has a VA who started.' }
  const va = (await prisma.$queryRaw<{ name: string; email: string | null }[]>`
    SELECT trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS name, lower(u.email) AS email
    FROM public.va_profiles vp JOIN public.users u ON u.id = vp.user_id
    WHERE vp.id = ${input.vaProfileId} AND u.is_active AND vp.is_active`)[0]
  if (!va) return { ok: false, error: 'That VA isn’t active in VA Workforce.' }
  const already = await prisma.serviceRequestCandidate.findUnique({ where: { requestId_vaProfileId: { requestId: request.id, vaProfileId: input.vaProfileId } } })
  if (already && already.stage !== 'WITHDRAWN' && already.stage !== 'DECLINED') return { ok: false, error: `${va.name} is already a candidate for this VA request.` }

  await prisma.$transaction(async (tx) => {
    const data = { role: input.role, stage: 'VA_PREPARATION' as const, stageChangedAt: new Date(), assignedByEmail: actor.email.toLowerCase(), assignedAt: new Date(), vaName: va.name || va.email || 'VA', vaEmail: va.email }
    const c = already
      ? await tx.serviceRequestCandidate.update({ where: { id: already.id }, data: { ...data, prepDoneAt: null, rateConfirmedAt: null, kickoffAt: null, outcomeAt: null, declineReason: null } })
      : await tx.serviceRequestCandidate.create({ data: { ...data, ticketId, requestId: request.id, vaProfileId: input.vaProfileId } })
    await logActivity(tx, actor, { ...logBase(t), action: 'CREATE', field: 'candidate', newValue: `${c.vaName} (${input.role === 'MAIN' ? 'main' : 'buffer'}) for ${request.service}` })
    await recompute(tx, actor, ticketId, 'VA assigned')
  }, TX)
  return { ok: true, data: null }
}

type Step = 'toRateAgreement' | 'confirmRate' | 'kickoffDone' | 'accepted' | 'declined' | 'withdraw' | 'started'

// One candidate moves on. `from` is the stage it must be in. confirmRate
// isn't taken here any more: the VA moves on when their Rate Agreement is
// acknowledged (lib/rate-agreements.ts, rateAgreementAcknowledged below).
const STEPS: Record<Step, { from: CandidateStage[]; to: CandidateStage; who: 'manager' | 'hr' | 'cs'; label: string }> = {
  toRateAgreement: { from: ['VA_PREPARATION'], to: 'RATE_AGREEMENT', who: 'manager', label: 'Prepared and mock interview done, moved to Rate Agreement' },
  confirmRate: { from: ['RATE_AGREEMENT'], to: 'KICKOFF_CALL', who: 'hr', label: 'Rate Agreement confirmed' },
  kickoffDone: { from: ['KICKOFF_CALL'], to: 'CONNECTION_CALL', who: 'cs', label: 'CS Kick-off Call done' },
  accepted: { from: ['CONNECTION_CALL'], to: 'START_VA', who: 'cs', label: 'Client accepted the VA' },
  declined: { from: ['CONNECTION_CALL'], to: 'DECLINED', who: 'cs', label: 'Client declined the VA' },
  withdraw: { from: ['VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL'], to: 'WITHDRAWN', who: 'manager', label: 'VA withdrawn' },
  started: { from: ['START_VA'], to: 'STARTED', who: 'manager', label: 'VA started' },
}

export async function moveCandidate(actor: Actor, candidateId: string, step: Step, extra: { reason?: string; startDate?: string } = {}): Promise<Result<{ ticketId: string }>> {
  const c = await prisma.serviceRequestCandidate.findUnique({
    where: { id: candidateId },
    include: { ticket: { select: { id: true, ticketNumber: true, phase: true, customerId: true, accountId: true } }, request: { select: { id: true, service: true, departmentId: true, lineNo: true } } },
  })
  if (!c) return { ok: false, error: 'That VA candidate no longer exists.' }
  if (step === 'confirmRate') return { ok: false, error: 'Confirm the Rate Agreement from its page: the VA moves on once they acknowledge it.' }
  const t = c.ticket
  const s = STEPS[step]
  if (isClosed(t.phase as SrPhase)) return { ok: false, error: 'This service request is closed.' }
  if (!s.from.includes(c.stage as CandidateStage)) return { ok: false, error: `${c.vaName} is in ${CANDIDATE_STAGE_LABELS[c.stage as CandidateStage]}, so that step doesn’t apply.` }
  const allowed = s.who === 'manager' ? managesDepartment(actor, await departmentOfRequest(c.request)) : s.who === 'hr' ? isHr(actor) : await isCsFor(actor, t.customerId)
  if (!allowed)
    return {
      ok: false,
      error: s.who === 'manager' ? 'Only a Service Department Manager of this VA request’s department can do that.' : s.who === 'hr' ? 'Only an HR Specialist can confirm the Rate Agreement.' : 'Only the customer’s CS can do that.',
    }
  if (step === 'declined' && !extra.reason?.trim()) return { ok: false, error: 'Say why the client declined.' }
  const today = manilaToday()
  if (step === 'started' && (!extra.startDate || extra.startDate > today)) return { ok: false, error: extra.startDate ? 'The start date can’t be in the future.' : 'Pick the start date.' }
  // A schedule change during the request changes the bill: Executive
  // Support checks it before the VA starts (Nov 6, 2026).
  if (step === 'started') {
    const waiting = await scheduleHold(prisma, t.id)
    if (waiting) return { ok: false, error: `The schedule changed and ${REVIEWER} hasn’t checked it yet (${waiting} change${waiting === 1 ? '' : 's'}). The VA can start once it’s checked.` }
  }

  const me = actor.email.toLowerCase()
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.serviceRequestCandidate.update({
      where: { id: candidateId },
      data: {
        stage: s.to,
        stageChangedAt: now,
        ...(step === 'toRateAgreement' ? { prepDoneAt: now, prepDoneByEmail: me } : {}),
        ...(step === 'kickoffDone' ? { kickoffAt: now, kickoffByEmail: me } : {}),
        ...(step === 'accepted' || step === 'declined' ? { outcomeAt: now, outcomeByEmail: me, declineReason: step === 'declined' ? extra.reason!.trim() : null } : {}),
        ...(step === 'started' ? { startDate: dateOnly(extra.startDate!), startedByEmail: me } : {}),
      },
    })
    await logActivity(tx, actor, { ...logBase(t), action: 'UPDATE', field: 'candidate', oldValue: CANDIDATE_STAGE_LABELS[c.stage as CandidateStage], newValue: CANDIDATE_STAGE_LABELS[s.to], notes: `${c.vaName}: ${s.label}${extra.reason ? ` (${extra.reason.trim()})` : ''}` })
    // The VA's Rate Agreement: opened for HR, or cancelled with the VA.
    if (step === 'toRateAgreement') await openRateAgreement(tx, actor, { id: c.id, ticketId: t.id, requestId: c.requestId, vaName: c.vaName, customerId: t.customerId }, subTicketCode(t.ticketNumber, c.request.lineNo))
    if (step === 'withdraw' || step === 'declined') await cancelRateAgreements(tx, actor, { candidateId: c.id }, step === 'withdraw' ? 'VA withdrawn' : 'Client declined the VA')

    if (step === 'started') {
      // The VA connection, and the account (and customer) become Active.
      const startedAt = manilaStartOf(extra.startDate!)
      const conn = await tx.vaConnection.create({
        data: {
          connectionCode: await newConnectionCode(tx),
          customerId: t.customerId,
          accountId: t.accountId,
          ticketId: t.id,
          candidateId,
          vaProfileId: c.vaProfileId,
          vaName: c.vaName,
          status: 'STARTED',
          statusChangedAt: startedAt,
          service: c.request.service,
          connectionDate: dateOnly(today),
          startDate: dateOnly(extra.startDate!),
          createdByEmail: me,
        },
      })
      await logActivity(tx, actor, { entityType: 'VaConnection', entityId: conn.id, entityLabel: `${conn.connectionCode} (${c.vaName})`, customerId: t.customerId, action: 'CREATE', newValue: 'Started', notes: `From ${srCode(t.ticketNumber)}` })
      await activateOnConnectionStart(tx, { ...actor, role: actor.role }, t.accountId, startedAt, now)
      // The VA request is filled: its other candidates step aside.
      await tx.serviceRequestCandidate.updateMany({ where: { requestId: c.requestId, id: { not: candidateId }, stage: { in: ['VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA'] } }, data: { stage: 'WITHDRAWN', stageChangedAt: now, notes: `Another VA (${c.vaName}) started` } })
      await cancelRateAgreements(tx, actor, { requestId: c.requestId, candidateId: { not: candidateId } }, `Another VA (${c.vaName}) started`)
    }
    await recompute(tx, actor, t.id, `${c.vaName}: ${s.label}`)
  }, TX)
  return { ok: true, data: { ticketId: t.id } }
}

async function newConnectionCode(tx: Tx) {
  for (;;) {
    const code = `CONN_${randomBytes(6).toString('hex').toUpperCase()}`
    if (!(await tx.vaConnection.count({ where: { connectionCode: code } }))) return code
  }
}

// A CS Manager (or admin) closes a ticket that won't be filled.
export async function closeLost(actor: Actor, ticketId: string, reason: string): Promise<Result> {
  const t = await loadTicket(ticketId)
  if (!t) return { ok: false, error: 'That service request no longer exists.' }
  if (isClosed(t.phase as SrPhase)) return { ok: false, error: 'This service request is already closed.' }
  if (actor.role !== 'ADMIN' && actor.role !== 'CS_MANAGER') return { ok: false, error: 'Only a CS Manager can close a service request as lost.' }
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticketId }, data: { phase: 'CLOSED_LOST', phaseChangedAt: now, closedAt: now, closedByEmail: actor.email.toLowerCase(), closedReason: reason } })
    await tx.serviceRequestCandidate.updateMany({ where: { ticketId, stage: { in: ['VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA'] } }, data: { stage: 'WITHDRAWN', stageChangedAt: now, notes: 'Ticket closed as lost' } })
    await logActivity(tx, actor, { ...logBase(t), action: 'PHASE_CHANGE', field: 'phase', oldValue: SR_PHASE_LABELS[t.phase as SrPhase], newValue: SR_PHASE_LABELS.CLOSED_LOST, notes: reason })
    // Its Rate Agreements go with it (Nov 6, 2026).
    await cancelRateAgreements(tx, actor, { ticketId }, `Ticket closed as lost: ${reason}`)
  }, TX)
  return { ok: true, data: null }
}

// The VA acknowledged their Rate Agreement (lib/rate-agreements.ts, in its
// transaction): they move on to the Kick-off Call, and the ticket's phase
// follows.
export async function rateAgreementAcknowledged(tx: Tx, actor: Actor, candidateId: string) {
  const c = await tx.serviceRequestCandidate.findUniqueOrThrow({ where: { id: candidateId }, select: { stage: true, vaName: true, ticket: { select: { id: true, ticketNumber: true, customerId: true } } } })
  if (c.stage !== 'RATE_AGREEMENT') return
  const now = new Date()
  await tx.serviceRequestCandidate.update({ where: { id: candidateId }, data: { stage: 'KICKOFF_CALL', stageChangedAt: now, rateConfirmedAt: now, rateConfirmedByEmail: actor.email.toLowerCase() } })
  await logActivity(tx, actor, { ...logBase(c.ticket), action: 'UPDATE', field: 'candidate', oldValue: CANDIDATE_STAGE_LABELS.RATE_AGREEMENT, newValue: CANDIDATE_STAGE_LABELS.KICKOFF_CALL, notes: `${c.vaName}: Rate Agreement acknowledged by the VA` })
  await recompute(tx, actor, c.ticket.id, `${c.vaName}: Rate Agreement acknowledged`)
}

// A new ticket on an account: Additional, Replacement or Reliever (or a New
// one for an account that has none). One sub-ticket per VA, as the form does.
export async function createServiceRequest(actor: Actor, accountId: string, type: SrType, requests: VaRequest[]): Promise<Result<{ id: string }>> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true, name: true, customerId: true } })
  if (!account) return { ok: false, error: 'That account no longer exists.' }
  if (!(await isCsFor(actor, account.customerId))) return { ok: false, error: 'Only the customer’s CS can open a service request.' }
  const info = await departmentInfo()
  const id = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.create({
      data: {
        customerId: account.customerId,
        accountId,
        type,
        // Straight to its departments' Service Department Managers.
        phase: 'VA_ASSIGNMENT',
        createdByEmail: actor.email.toLowerCase(),
        requests: {
          create: requests
            .flatMap((r) => Array.from({ length: r.numberOfVas }, () => r))
            .map((r, i) => ({ ...requestRow(r, i + 1), departmentId: departmentForService(info, r.service) })),
        },
      },
      select: { id: true, ticketNumber: true },
    })
    await logActivity(tx, actor, { entityType: 'ServiceRequest', entityId: t.id, entityLabel: srCode(t.ticketNumber), customerId: account.customerId, action: 'CREATE', newValue: `${SR_TYPE_LABELS[type]} service request on ${account.name}` })
    return t.id
  }, TX)
  return { ok: true, data: { id } }
}

// ── The Customers page's figures ──────────────────────────────────

export async function vaConnectionFigures(scope: Prisma.CustomerWhereInput | null) {
  const where: Prisma.VaConnectionWhereInput = { status: 'STARTED', customer: { AND: [scope ?? {}, { isTest: false }] } }
  const [connections, profiles, legacy] = await Promise.all([
    prisma.vaConnection.count({ where }),
    prisma.vaConnection.findMany({ where: { ...where, vaProfileId: { not: null } }, distinct: ['vaProfileId'], select: { vaProfileId: true } }),
    prisma.vaConnection.findMany({ where: { ...where, vaProfileId: null, vaExternalId: { not: null } }, distinct: ['vaExternalId'], select: { vaExternalId: true } }),
  ]).catch(() => [0, [], []] as const)
  return { connections, vas: profiles.length + legacy.length }
}
