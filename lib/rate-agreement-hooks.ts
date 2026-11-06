import type { Prisma } from '@/src/generated/prisma/client'
import { logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'
import { subTicketCode } from '@/lib/onboarding-fields'

// Server-only: what the service request steps (lib/service-requests.ts) do
// to Rate Agreements, inside their own transaction. Kept apart from
// lib/rate-agreements.ts, which calls back into the service requests.

type Tx = Prisma.TransactionClient

// The Service Department Manager moved a VA to Rate Agreement: it waits for
// HR. A VA who comes back to it (withdrawn, then put forward again) starts a
// fresh one, keeping the HR Specialist it was assigned to.
export async function openRateAgreement(tx: Tx, actor: Actor, c: { id: string; ticketId: string; requestId: string; vaName: string; customerId: string }, label: string) {
  const now = new Date()
  const fresh = {
    status: 'WAITING' as const,
    statusChangedAt: now,
    bond: null,
    nightDifferential: null,
    incrementalWage: null,
    preparedAt: null,
    preparedByEmail: null,
    scheduleConfirmedAt: null,
    scheduleConfirmedByEmail: null,
    payrollAckAt: null,
    payrollAckByEmail: null,
    sentOn: null,
    sentByEmail: null,
    vaAckAt: null,
    vaAckByEmail: null,
    cancelledAt: null,
    cancelledReason: null,
  }
  const ra = await tx.rateAgreement.upsert({
    where: { candidateId: c.id },
    create: { ticketId: c.ticketId, requestId: c.requestId, candidateId: c.id, ...fresh },
    update: fresh,
    select: { id: true },
  })
  await logActivity(tx, actor, { entityType: 'RateAgreement', entityId: ra.id, entityLabel: `${label} · ${c.vaName}`, customerId: c.customerId, action: 'CREATE', newValue: 'Waiting for HR' })
}

// A ticket closed as lost, a VA withdrawn or declined, or another VA started:
// their Rate Agreements are cancelled. A started VA's own agreement stays.
export async function cancelRateAgreements(tx: Tx, actor: Actor, where: Prisma.RateAgreementWhereInput, reason: string) {
  const open = await tx.rateAgreement.findMany({
    where: { AND: [where, { status: { not: 'CANCELLED' } }, { candidate: { stage: { not: 'STARTED' } } }] },
    select: { id: true, candidate: { select: { vaName: true } }, request: { select: { lineNo: true } }, ticket: { select: { customerId: true, ticketNumber: true } } },
  })
  if (open.length === 0) return
  const now = new Date()
  await tx.rateAgreement.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { status: 'CANCELLED', statusChangedAt: now, cancelledAt: now, cancelledReason: reason } })
  await logActivity(
    tx,
    actor,
    open.map((r) => ({ entityType: 'RateAgreement', entityId: r.id, entityLabel: `${subTicketCode(r.ticket.ticketNumber, r.request.lineNo)} · ${r.candidate.vaName}`, customerId: r.ticket.customerId, action: 'CANCELLED', field: 'status', newValue: 'Cancelled', notes: reason }))
  )
}
