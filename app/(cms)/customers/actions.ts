'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getActor } from '@/lib/auth'
import { statusChangeSchema, STATUS_LABELS, type ActionResult } from '@/lib/customer-fields'

// Changing a customer's status always writes a status log row in the same
// transaction, so the history can never miss a change.
export async function changeCustomerStatus(customerId: string, input: { status: string; reason: string }): Promise<ActionResult> {
  const actor = await getActor('customerStatus')
  if (!actor) return { ok: false, error: "You don't have permission to change a customer's status." }

  const parsed = statusChangeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { status, reason } = parsed.data

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { status: true } })
  if (!customer) return { ok: false, error: 'That customer no longer exists.' }
  if (customer.status === status) return { ok: false, error: `This customer is already ${STATUS_LABELS[status]}.` }

  const now = new Date()
  await prisma.$transaction([
    prisma.customer.update({ where: { id: customerId }, data: { status, statusChangedAt: now } }),
    prisma.customerStatusLog.create({
      data: {
        customerId,
        fromStatus: customer.status,
        toStatus: status,
        reason: reason || null,
        changedById: actor.id,
        changedByEmail: actor.email,
        changedAt: now,
      },
    }),
  ])

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/leads')
  return { ok: true, data: null }
}
