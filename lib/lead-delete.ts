import { prisma } from '@/lib/prisma'
import { logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'

// Server-only: deleting a lead for good (admins, from the lead's page;
// asked for on Nov 4, 2026). Everything hanging off the customer cascades:
// onboarding links and the form, accounts with their contacts and tickets,
// status and phase logs, notes, takeovers, and bills. The activity log keeps
// its rows, plus one saying who deleted it.
//
// Guards on a real lead: it must still be a lead (Pending and not yet
// onboarded, the same test as Lead Management's list), since /leads/<id>
// opens any customer and a customer must never be deleted this way; its
// name must be typed back (the page asks); and one with payments recorded in
// the Accounting System is refused, so money received never disappears with
// it. Test leads skip these.
export const isStillLead = (c: { status: string; leadPhase: string }) => c.status === 'PENDING' && c.leadPhase !== 'NEW_CUSTOMER_ONBOARDED'

export async function deleteLead(actor: Actor, customerId: string, typedName: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const lead = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true, customerCode: true, isTest: true, status: true, leadPhase: true, _count: { select: { payments: true, accounts: true } } },
  })
  if (!lead) return { ok: false, error: 'That lead no longer exists.' }
  if (!lead.isTest) {
    if (!isStillLead(lead)) return { ok: false, error: `${lead.name} is a customer now, not a lead, so it can’t be deleted.` }
    if (typedName.trim().toLowerCase() !== lead.name.trim().toLowerCase()) return { ok: false, error: 'Type the lead’s name exactly to confirm.' }
    if (lead._count.payments > 0)
      return { ok: false, error: `${lead.name} has payments recorded in the Accounting System, so it can’t be deleted. Ask Accounting to remove them first if they were a mistake.` }
  }
  await prisma.$transaction(async (tx) => {
    await tx.customer.delete({ where: { id: customerId } })
    await logActivity(tx, actor, {
      entityType: 'Customer',
      entityId: customerId,
      entityLabel: `${lead.name} (${lead.customerCode})`,
      customerId,
      action: 'DELETE',
      oldValue: lead.status,
      notes: lead.isTest ? 'Test lead deleted' : `Lead deleted for good (${lead._count.accounts} account${lead._count.accounts === 1 ? '' : 's'})`,
    })
  })
  return { ok: true, name: lead.name }
}
