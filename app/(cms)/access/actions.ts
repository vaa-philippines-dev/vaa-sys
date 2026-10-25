'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { findStaffUser, getActor } from '@/lib/auth'
import { ACCESS_ROLES, grantableRoles, ROLE_LABELS, type AccessRole } from '@/lib/access-fields'
import type { ActionResult } from '@/lib/customer-fields'

const NO_ACCESS = "You don't have permission to change access."

const addSchema = z.object({
  email: z.email('Enter a valid email.').trim().toLowerCase(),
  role: z.enum(ACCESS_ROLES),
})

export async function addAccessUser(input: { email: string; role: string }): Promise<ActionResult<{ name: string }>> {
  const actor = await getActor('access')
  if (!actor) return { ok: false, error: NO_ACCESS }

  const parsed = addSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { email, role } = parsed.data
  if (!grantableRoles(actor.role).includes(role)) {
    return { ok: false, error: `You can't give the ${ROLE_LABELS[role]} role.` }
  }

  // vaa-sys only admits people who already have a VAA Workforce account.
  const staff = await findStaffUser(email)
  if (!staff) return { ok: false, error: `${email} has no VAA Workforce account. Ask an admin to create one there first.` }
  if (!staff.isActive) return { ok: false, error: `${email}'s VAA Workforce account is disabled.` }

  const existing = await prisma.accessUser.findUnique({ where: { email } })
  if (existing && !grantableRoles(actor.role).includes(existing.role)) {
    return { ok: false, error: `${email} already has the ${ROLE_LABELS[existing.role]} role, which you can't change.` }
  }

  await prisma.accessUser.upsert({
    where: { email },
    create: { email, role, addedByEmail: actor.email },
    update: { role, isActive: true, addedByEmail: actor.email },
  })
  revalidatePath('/access')
  return { ok: true, data: { name: [staff.firstName, staff.lastName].filter(Boolean).join(' ') || email } }
}

export async function setAccessActive(id: string, isActive: boolean): Promise<ActionResult> {
  const actor = await getActor('access')
  if (!actor) return { ok: false, error: NO_ACCESS }

  const row = await prisma.accessUser.findUnique({ where: { id } })
  if (!row) return { ok: false, error: 'That person is no longer on the list.' }
  if (!grantableRoles(actor.role).includes(row.role)) {
    return { ok: false, error: `You can't change someone with the ${ROLE_LABELS[row.role]} role.` }
  }
  if (row.email === actor.email.toLowerCase() && !isActive) {
    return { ok: false, error: "You can't remove your own access." }
  }

  await prisma.accessUser.update({ where: { id }, data: { isActive } })
  revalidatePath('/access')
  return { ok: true, data: null }
}

export async function changeAccessRole(id: string, role: AccessRole): Promise<ActionResult> {
  const actor = await getActor('access')
  if (!actor) return { ok: false, error: NO_ACCESS }

  const row = await prisma.accessUser.findUnique({ where: { id } })
  if (!row) return { ok: false, error: 'That person is no longer on the list.' }
  const grantable = grantableRoles(actor.role)
  if (!grantable.includes(row.role) || !grantable.includes(role)) {
    return { ok: false, error: "You can't make that change." }
  }

  await prisma.accessUser.update({ where: { id }, data: { role } })
  revalidatePath('/access')
  return { ok: true, data: null }
}
