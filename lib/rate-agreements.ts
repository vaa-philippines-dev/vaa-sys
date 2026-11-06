import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { fieldChanges, logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'
import { dateOnly, manilaToday } from '@/lib/customer-fields'
import { assertCustomerInScope, customerScopeWhere } from '@/lib/scope'
import { subTicketCode } from '@/lib/onboarding-fields'
import { rateAgreementAcknowledged } from '@/lib/service-requests'
import { staffNames } from '@/lib/workforce'
import { RA_BOND_LABELS, RA_OPEN, RA_STATUS_LABELS, nextRaStep, raTermsLocked, type RaBond, type RaStatus, type RaTerms } from '@/lib/rate-agreement-fields'

// Server-only: VAs' Rate Agreements on service requests (Nov 6, 2026).
//
// - Made when the Service Department Manager moves a VA to Rate Agreement
//   (lib/rate-agreement-hooks.ts), waiting for HR; cancelled with its ticket
//   (closed as lost) or its VA (withdrawn, declined, another VA started).
// - An HR Manager (or an admin) assigns each one to an HR Specialist. Only
//   that HR Specialist, an HR Manager or an admin works on it; the
//   customer's CS can also record the schedule confirmation.
// - HR sets the terms, starting from the account's contract: a training or
//   performance bond, night differential, incremental wage increase. They
//   can change until it's sent to the VA.
// - The steps, in order: Prepared by HR, Schedule confirmation by CS,
//   Acknowledgement by Payroll, Sent to VA (with the date), VA Acknowledged.
//   At the last one the VA moves on to the Kick-off Call.

type Tx = Prisma.TransactionClient
type Result<T = null> = { ok: true; data: T } | { ok: false; error: string }
const TX = { maxWait: 10_000, timeout: 30_000 }

// ── Who may act ───────────────────────────────────────────────────

export const isHrTeam = (actor: Actor) => actor.role === 'ADMIN' || actor.role === 'HR_MANAGER' || actor.role === 'HR_SPECIALIST'
export const canAssignRa = (actor: Actor) => actor.role === 'ADMIN' || actor.role === 'HR_MANAGER'
export const mayWorkRa = (actor: Actor, ra: { assignedToEmail: string | null }) =>
  canAssignRa(actor) || (actor.role === 'HR_SPECIALIST' && !!ra.assignedToEmail && ra.assignedToEmail === actor.email.toLowerCase())

async function isCsFor(actor: Actor, customerId: string) {
  if (actor.role === 'ADMIN' || actor.role === 'CS_MANAGER') return true
  return actor.role === 'CUSTOMER_SPECIALIST' && (await assertCustomerInScope(actor, customerId))
}
export const mayConfirmSchedule = async (actor: Actor, ra: { assignedToEmail: string | null }, customerId: string) => mayWorkRa(actor, ra) || (await isCsFor(actor, customerId))

// ── Reading ───────────────────────────────────────────────────────

const listInclude = {
  ticket: { select: { id: true, ticketNumber: true, type: true, phase: true, customer: { select: { id: true, name: true, isTest: true } }, account: { select: { id: true, name: true, accountCode: true } } } },
  request: { select: { id: true, lineNo: true, service: true, departmentId: true } },
  candidate: { select: { id: true, vaName: true, vaEmail: true, stage: true, role: true } },
} satisfies Prisma.RateAgreementInclude

export type RaFilter = { status?: RaStatus | 'OPEN' | 'ALL'; who?: 'mine' | 'unassigned' | 'all'; q?: string }

async function listWhere(actor: Actor, f: RaFilter): Promise<Prisma.RateAgreementWhereInput> {
  const scope = await customerScopeWhere(actor)
  const q = f.q?.trim()
  const number = q && /^(tkt-?)?\d+(-\d+)?$/i.test(q) ? Number(q.replace(/^tkt-?/i, '').split('-')[0]) : null
  return {
    AND: [
      scope ? { ticket: { customer: scope } } : {},
      f.who === 'mine' ? { assignedToEmail: actor.email.toLowerCase() } : f.who === 'unassigned' ? { assignedToEmail: null } : {},
      q
        ? {
            OR: [
              ...(number ? [{ ticket: { ticketNumber: number } }] : []),
              { candidate: { vaName: { contains: q, mode: 'insensitive' as const } } },
              { ticket: { account: { name: { contains: q, mode: 'insensitive' as const } } } },
              { ticket: { customer: { name: { contains: q, mode: 'insensitive' as const } } } },
            ],
          }
        : {},
    ],
  }
}

export async function listRateAgreements(actor: Actor, f: RaFilter) {
  const base = await listWhere(actor, f)
  const status = f.status ?? 'OPEN'
  return prisma.rateAgreement.findMany({
    where: { AND: [base, status === 'ALL' ? {} : status === 'OPEN' ? { status: { in: RA_OPEN } } : { status }] },
    include: listInclude,
    orderBy: [{ statusChangedAt: 'asc' }],
    take: 1000,
  })
}

// Counts for the status chips, under the same who/search filter.
export async function raStatusCounts(actor: Actor, f: RaFilter) {
  const rows = await prisma.rateAgreement.groupBy({ by: ['status'], where: await listWhere(actor, f), _count: { _all: true } })
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<RaStatus, number>>
}

// The open ones assigned to this HR Specialist (or, for an HR Manager, the
// unassigned ones), for the nav.
export async function countRaWaitingOn(actor: Actor) {
  if (actor.role === 'HR_SPECIALIST') return prisma.rateAgreement.count({ where: { assignedToEmail: actor.email.toLowerCase(), status: { in: RA_OPEN } } })
  if (canAssignRa(actor)) return prisma.rateAgreement.count({ where: { assignedToEmail: null, status: { in: RA_OPEN }, ticket: { customer: { isTest: false } } } })
  return 0
}

const fullInclude = {
  ticket: {
    select: {
      id: true,
      ticketNumber: true,
      type: true,
      phase: true,
      customerId: true,
      customer: { select: { id: true, name: true, customerCode: true, assignedSpecialistEmail: true, isTest: true } },
      account: {
        select: {
          id: true,
          name: true,
          accountCode: true,
          timeZone: true,
          contract: { select: { id: true, contractCode: true, name: true, templateUrl: true, sections: { select: { value: true, sectionDef: { select: { name: true, fieldType: true, sortOrder: true } } } } } },
        },
      },
    },
  },
  request: true,
  candidate: true,
} satisfies Prisma.RateAgreementInclude
export type RateAgreementFull = Prisma.RateAgreementGetPayload<{ include: typeof fullInclude }>

export async function getRateAgreement(id: string) {
  return prisma.rateAgreement.findUnique({ where: { id }, include: fullInclude })
}

// HR Specialists and HR Managers with access, for the assign picker.
export async function listHrPeople() {
  const rows = await prisma.accessUser.findMany({ where: { isActive: true, role: { in: ['HR_SPECIALIST', 'HR_MANAGER'] } }, select: { email: true, role: true }, orderBy: { email: 'asc' } })
  const names = await staffNames(rows.map((r) => r.email))
  return rows.map((r) => ({ email: r.email, role: r.role, name: names.get(r.email) ?? r.email })).sort((a, b) => a.name.localeCompare(b.name))
}

// ── The contract's terms ──────────────────────────────────────────

export type TermDefault<T> = { value: T | null; why: string }

// What the account's contract says, for the terms HR starts from. The
// contract sections are matched by name (Contracts page): "Night
// Differential" (a percentage) and "Incremental Wage Increase" (Yes/No).
// Contracts have no bond section, so HR always chooses that one.
export function contractDefaults(
  contract: { name: string; sections: { value: string; sectionDef: { name: string } }[] } | null,
  request: { nightDifferential: boolean }
): { bond: TermDefault<RaBond>; nightDifferential: TermDefault<boolean>; incrementalWage: TermDefault<boolean> } {
  const section = (re: RegExp) => contract?.sections.find((s) => re.test(s.sectionDef.name))?.value.trim() ?? null
  const nd = section(/night\s*diff/i)
  const ndPercent = nd ? Number(nd.replace(/[^\d.]/g, '')) : NaN
  const iwi = section(/incremental\s*wage/i)
  const nightShift = request.nightDifferential
  return {
    bond: { value: null, why: 'Not in the contract: choose one.' },
    nightDifferential: !contract
      ? { value: null, why: 'The account has no contract: choose one.' }
      : Number.isFinite(ndPercent) && ndPercent > 0
        ? { value: nightShift, why: `The contract has a ${ndPercent}% night differential; the shift ${nightShift ? 'has' : 'has no'} hours between 10 PM and 6 AM PH time.` }
        : { value: false, why: 'The contract has no night differential.' },
    incrementalWage: !contract
      ? { value: null, why: 'The account has no contract: choose one.' }
      : iwi
        ? { value: /^y/i.test(iwi), why: `The contract says ${/^y/i.test(iwi) ? 'Yes' : 'No'}.` }
        : { value: false, why: 'The contract has no incremental wage increase.' },
  }
}

// ── Changes ───────────────────────────────────────────────────────

const label = (ra: { ticket: { ticketNumber: number }; request: { lineNo: number }; candidate: { vaName: string } }) => `${subTicketCode(ra.ticket.ticketNumber, ra.request.lineNo)} · ${ra.candidate.vaName}`
const yn = (v: boolean | null) => (v == null ? null : v ? 'Yes' : 'No')
const T = { bond: 'Training or Performance Bond', nd: 'Night Differential', iwi: 'Incremental Wage Increase', notes: 'Notes' } as const

async function loadForChange(id: string) {
  return prisma.rateAgreement.findUnique({
    where: { id },
    include: { ticket: { select: { id: true, ticketNumber: true, phase: true, customerId: true } }, request: { select: { lineNo: true } }, candidate: { select: { id: true, vaName: true, stage: true } } },
  })
}

function closedProblem(ra: NonNullable<Awaited<ReturnType<typeof loadForChange>>>): string | null {
  if (ra.status === 'CANCELLED') return 'This Rate Agreement was cancelled.'
  if (ra.ticket.phase === 'CLOSED_LOST') return 'This service request is closed.'
  return null
}

// An HR Manager assigns it to an HR Specialist (or clears it).
export async function assignRateAgreement(actor: Actor, id: string, email: string | null): Promise<Result> {
  if (!canAssignRa(actor)) return { ok: false, error: 'Only an HR Manager can assign Rate Agreements.' }
  const ra = await loadForChange(id)
  if (!ra) return { ok: false, error: 'That Rate Agreement no longer exists.' }
  const problem = closedProblem(ra)
  if (problem) return { ok: false, error: problem }
  const to = email?.trim().toLowerCase() || null
  if (to && !(await prisma.accessUser.count({ where: { email: to, isActive: true, role: { in: ['HR_SPECIALIST', 'HR_MANAGER'] } } }))) return { ok: false, error: 'Pick an HR Specialist with access.' }
  if (to === ra.assignedToEmail) return { ok: true, data: null }
  const names = await staffNames([to ?? '', ra.assignedToEmail ?? ''])
  await prisma.$transaction(async (tx) => {
    await tx.rateAgreement.update({ where: { id }, data: { assignedToEmail: to, assignedByEmail: actor.email.toLowerCase(), assignedAt: new Date() } })
    await logActivity(tx, actor, {
      entityType: 'RateAgreement',
      entityId: id,
      entityLabel: label(ra),
      customerId: ra.ticket.customerId,
      action: 'ASSIGN',
      field: 'assignedTo',
      oldValue: ra.assignedToEmail ? (names.get(ra.assignedToEmail) ?? ra.assignedToEmail) : null,
      newValue: to ? (names.get(to) ?? to) : null,
    })
  }, TX)
  return { ok: true, data: null }
}

// HR saves the terms; `prepare` also marks it Prepared by HR (the "Confirm
// Rate Agreement" button). Changing the terms after Payroll acknowledged
// them sends it back to Payroll (as the legacy CMS reset Accounting's check).
export async function saveRaTerms(actor: Actor, id: string, terms: { bond: RaBond; nightDifferential: boolean; incrementalWage: boolean; notes: string }, prepare: boolean): Promise<Result<{ status: RaStatus; reopened: boolean }>> {
  const ra = await loadForChange(id)
  if (!ra) return { ok: false, error: 'That Rate Agreement no longer exists.' }
  const problem = closedProblem(ra)
  if (problem) return { ok: false, error: problem }
  if (!mayWorkRa(actor, ra)) return { ok: false, error: ra.assignedToEmail ? 'This Rate Agreement is assigned to another HR Specialist.' : 'An HR Manager assigns this Rate Agreement first.' }
  const status = ra.status as RaStatus
  if (raTermsLocked(status)) return { ok: false, error: 'It was already sent to the VA, so the terms can’t change.' }
  if (prepare && status !== 'WAITING') return { ok: false, error: 'It’s already prepared.' }
  if (ra.candidate.stage !== 'RATE_AGREEMENT') return { ok: false, error: `${ra.candidate.vaName} isn’t in Rate Agreement any more.` }

  // Logged under the names HR sees on the page.
  const before = { [T.bond]: ra.bond ? RA_BOND_LABELS[ra.bond as RaBond] : null, [T.nd]: yn(ra.nightDifferential), [T.iwi]: yn(ra.incrementalWage), [T.notes]: ra.notes ?? null }
  const after = { [T.bond]: RA_BOND_LABELS[terms.bond], [T.nd]: yn(terms.nightDifferential), [T.iwi]: yn(terms.incrementalWage), [T.notes]: terms.notes || null }
  const changes = fieldChanges({ entityType: 'RateAgreement', entityId: id, entityLabel: label(ra), customerId: ra.ticket.customerId }, before, after)
  const reopened = changes.some((c) => c.field !== T.notes) && status === 'PAYROLL_ACKNOWLEDGED'
  const next: RaStatus = prepare ? 'PREPARED' : reopened ? 'SCHEDULE_CONFIRMED' : status
  const now = new Date()
  const me = actor.email.toLowerCase()

  await prisma.$transaction(async (tx) => {
    await tx.rateAgreement.update({
      where: { id },
      data: {
        bond: terms.bond,
        nightDifferential: terms.nightDifferential,
        incrementalWage: terms.incrementalWage,
        notes: terms.notes || null,
        ...(next !== status ? { status: next, statusChangedAt: now } : {}),
        ...(prepare ? { preparedAt: now, preparedByEmail: me } : {}),
        ...(reopened ? { payrollAckAt: null, payrollAckByEmail: null } : {}),
      },
    })
    await logActivity(tx, actor, changes)
    if (next !== status)
      await logActivity(tx, actor, {
        entityType: 'RateAgreement',
        entityId: id,
        entityLabel: label(ra),
        customerId: ra.ticket.customerId,
        action: 'UPDATE',
        field: 'status',
        oldValue: RA_STATUS_LABELS[status],
        newValue: RA_STATUS_LABELS[next],
        notes: reopened ? 'Terms changed after Payroll acknowledged them: back to Payroll' : undefined,
      })
  }, TX)
  return { ok: true, data: { status: next, reopened } }
}

// The next step: Schedule confirmation by CS, Acknowledgement by Payroll,
// Sent to VA (with the day it was sent) or VA Acknowledged.
export async function advanceRateAgreement(actor: Actor, id: string, to: RaStatus, sentOn: string): Promise<Result<{ ticketId: string }>> {
  const ra = await loadForChange(id)
  if (!ra) return { ok: false, error: 'That Rate Agreement no longer exists.' }
  const problem = closedProblem(ra)
  if (problem) return { ok: false, error: problem }
  const status = ra.status as RaStatus
  if (to === 'PREPARED') return { ok: false, error: 'Use Confirm Rate Agreement to mark it prepared.' }
  if (nextRaStep(status) !== to) return { ok: false, error: `It’s at ${RA_STATUS_LABELS[status]}, so that step doesn’t apply.` }
  const allowed = to === 'SCHEDULE_CONFIRMED' ? await mayConfirmSchedule(actor, ra, ra.ticket.customerId) : mayWorkRa(actor, ra)
  if (!allowed) return { ok: false, error: ra.assignedToEmail ? 'Only the HR Specialist it’s assigned to (or an HR Manager) can do that.' : 'An HR Manager assigns this Rate Agreement first.' }
  if (ra.candidate.stage !== 'RATE_AGREEMENT') return { ok: false, error: `${ra.candidate.vaName} isn’t in Rate Agreement any more.` }
  if (to === 'SENT_TO_VA') {
    if (!sentOn) return { ok: false, error: 'Pick the date the Rate Agreement was sent.' }
    if (sentOn > manilaToday()) return { ok: false, error: 'The sent date can’t be in the future.' }
  }
  const now = new Date()
  const me = actor.email.toLowerCase()
  const stamp: Prisma.RateAgreementUpdateInput =
    to === 'SCHEDULE_CONFIRMED'
      ? { scheduleConfirmedAt: now, scheduleConfirmedByEmail: me }
      : to === 'PAYROLL_ACKNOWLEDGED'
        ? { payrollAckAt: now, payrollAckByEmail: me }
        : to === 'SENT_TO_VA'
          ? { sentOn: dateOnly(sentOn), sentByEmail: me }
          : { vaAckAt: now, vaAckByEmail: me }

  await prisma.$transaction(async (tx: Tx) => {
    await tx.rateAgreement.update({ where: { id }, data: { status: to, statusChangedAt: now, ...stamp } })
    await logActivity(tx, actor, {
      entityType: 'RateAgreement',
      entityId: id,
      entityLabel: label(ra),
      customerId: ra.ticket.customerId,
      action: 'UPDATE',
      field: 'status',
      oldValue: RA_STATUS_LABELS[status],
      newValue: RA_STATUS_LABELS[to],
      notes: to === 'SENT_TO_VA' ? `Sent on ${sentOn}` : undefined,
    })
    if (to === 'VA_ACKNOWLEDGED') await rateAgreementAcknowledged(tx, actor, ra.candidate.id)
  }, TX)
  return { ok: true, data: { ticketId: ra.ticket.id } }
}

// For a page: may this person open this agreement? A CS Specialist only for
// their own customers.
export async function mayReadRa(actor: Actor, customerId: string) {
  return actor.role !== 'CUSTOMER_SPECIALIST' || (await assertCustomerInScope(actor, customerId))
}

export type { RaTerms }
