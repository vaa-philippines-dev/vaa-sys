'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActorFor } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { isCsTeamMember } from '@/lib/specialists'
import { dateOnly, type ActionResult } from '@/lib/customer-fields'

const NO_ACCESS = "You don't have permission to manage the CS team's customers."

const ids = z.array(z.string().min(1).max(60)).min(1, 'Pick at least one customer.').max(500)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')

function refresh() {
  revalidatePath('/specialists')
  revalidatePath('/customers', 'layout')
}

const assignSchema = z.object({ customerIds: ids, toEmail: z.string().trim().toLowerCase(), note: z.string().trim().max(1000) })

// Reassign or transfer customers to a CS Specialist (or unassign, with an
// empty email). Logged as ASSIGN when the customer had nobody, TRANSFER
// otherwise, with the note.
export async function assignCustomers(input: z.input<typeof assignSchema>): Promise<ActionResult<{ count: number }>> {
  const actor = await getActorFor('csSpecialists', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = assignSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { customerIds, toEmail, note } = parsed.data
  if (toEmail && !(await isCsTeamMember(toEmail))) return { ok: false, error: `${toEmail} isn't an active Customer Specialist or CS Manager.` }

  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, assignedSpecialistEmail: true } })
  const moving = customers.filter((c) => (c.assignedSpecialistEmail ?? '') !== toEmail)

  await prisma.$transaction(async (tx) => {
    await tx.customer.updateMany({ where: { id: { in: moving.map((c) => c.id) } }, data: { assignedSpecialistEmail: toEmail || null } })
    await logActivity(
      tx,
      actor,
      moving.map((c) => ({
        entityType: 'Customer',
        entityId: c.id,
        entityLabel: c.name,
        customerId: c.id,
        action: c.assignedSpecialistEmail ? 'TRANSFER' : 'ASSIGN',
        field: 'assignedSpecialistEmail',
        oldValue: c.assignedSpecialistEmail,
        newValue: toEmail || null,
        notes: note || null,
      }))
    )
  })
  refresh()
  return { ok: true, data: { count: moving.length } }
}

const takeoverSchema = z
  .object({ customerIds: ids, specialistEmail: z.string().trim().toLowerCase().min(1, 'Pick who covers.'), startDate: day, endDate: day, reason: z.string().trim().max(1000) })
  .refine((v) => v.endDate >= v.startDate, { message: 'The end date must be on or after the start date.', path: ['endDate'] })

// A CS Specialist covers specific customers between two dates (legacy
// assignCustomerTakeover). They see and work those customers only while
// the takeover is running.
export async function createTakeover(input: z.input<typeof takeoverSchema>): Promise<ActionResult<{ count: number }>> {
  const actor = await getActorFor('csSpecialists', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = takeoverSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { customerIds, specialistEmail, startDate, endDate, reason } = parsed.data
  if (!(await isCsTeamMember(specialistEmail))) return { ok: false, error: `${specialistEmail} isn't an active Customer Specialist or CS Manager.` }

  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, assignedSpecialistEmail: true } })
  const covered = customers.filter((c) => c.assignedSpecialistEmail !== specialistEmail)
  if (covered.length === 0) return { ok: false, error: 'Those customers are already theirs.' }

  await prisma.$transaction(async (tx) => {
    await tx.customerTakeover.createMany({
      data: covered.map((c) => ({
        customerId: c.id,
        specialistEmail,
        startDate: dateOnly(startDate),
        endDate: dateOnly(endDate),
        reason: reason || null,
        createdByEmail: actor.email.toLowerCase(),
      })),
    })
    await logActivity(
      tx,
      actor,
      covered.map((c) => ({
        entityType: 'Customer',
        entityId: c.id,
        entityLabel: c.name,
        customerId: c.id,
        action: 'TAKEOVER',
        field: 'takeover',
        oldValue: c.assignedSpecialistEmail,
        newValue: `${specialistEmail} ${startDate} to ${endDate}`,
        notes: reason || null,
      }))
    )
  })
  refresh()
  return { ok: true, data: { count: covered.length } }
}

// Ends a takeover early. Kept (with who cancelled it) rather than deleted.
export async function cancelTakeover(id: string): Promise<ActionResult> {
  const actor = await getActorFor('csSpecialists', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const takeover = await prisma.customerTakeover.findUnique({ where: { id }, include: { customer: { select: { name: true } } } })
  if (!takeover || takeover.cancelledAt) return { ok: false, error: 'That takeover is no longer running.' }

  await prisma.$transaction(async (tx) => {
    await tx.customerTakeover.update({ where: { id }, data: { cancelledAt: new Date(), cancelledByEmail: actor.email.toLowerCase() } })
    await logActivity(tx, actor, {
      entityType: 'Customer',
      entityId: takeover.customerId,
      entityLabel: takeover.customer.name,
      customerId: takeover.customerId,
      action: 'TAKEOVER_CANCELLED',
      field: 'takeover',
      oldValue: takeover.specialistEmail,
    })
  })
  refresh()
  return { ok: true, data: null }
}
