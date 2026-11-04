import type { Prisma } from '@/src/generated/prisma/client'
import { logActivity, type ActivityActor } from '@/lib/activity'
import { PHASE_LABELS, leadPhaseFor, type LeadPhase } from '@/lib/lead-phase-fields'

// Server-only: the one place customers.lead_phase changes. Every action that
// changes a fact the phase depends on (form submitted, contract sent,
// request type, contract and payment confirmed, handoff) calls syncLeadPhase
// in the same transaction, which works the phase out again
// (lib/lead-phase-fields.ts) and logs the move.

type Tx = Prisma.TransactionClient

export async function syncLeadPhase(tx: Tx, actor: ActivityActor, customerId: string, note: string, now = new Date()): Promise<LeadPhase> {
  const c = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: {
      name: true,
      leadPhase: true,
      requestType: true,
      intakeCompletedAt: true,
      contractSentAt: true,
      contractConfirmedAt: true,
      handoffCompletedAt: true,
      _count: { select: { submissions: true } },
    },
  })
  const phase = leadPhaseFor({
    // An imported lead can be past Customer Intake without the form.
    formSubmitted: c._count.submissions > 0 || !!c.intakeCompletedAt,
    requestType: c.requestType,
    contractSent: !!c.contractSentAt,
    contractConfirmed: !!c.contractConfirmedAt,
    handoffCompleted: !!c.handoffCompletedAt,
  })
  if (phase === c.leadPhase) return phase

  await tx.customer.update({ where: { id: customerId }, data: { leadPhase: phase, leadPhaseChangedAt: now } })
  await tx.leadPhaseLog.create({
    data: { customerId, fromPhase: c.leadPhase, toPhase: phase, note, changedByEmail: actor.email.toLowerCase(), changedAt: now },
  })
  await logActivity(tx, actor, {
    entityType: 'Customer',
    entityId: customerId,
    entityLabel: c.name,
    customerId,
    action: 'PHASE_CHANGE',
    field: 'leadPhase',
    oldValue: PHASE_LABELS[c.leadPhase],
    newValue: PHASE_LABELS[phase],
    notes: note,
  })
  return phase
}
