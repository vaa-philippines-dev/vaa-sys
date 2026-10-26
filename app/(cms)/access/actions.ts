'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { findStaffUser, getActor } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { listServiceDepartments } from '@/lib/workforce'
import { ACCESS_ROLES, DEPARTMENT_ROLES, grantableRoles, ROLE_LABELS, type AccessRole } from '@/lib/access-fields'
import type { ActionResult } from '@/lib/customer-fields'

const NO_ACCESS = "You don't have permission to change access."

const addSchema = z.object({
  email: z.email('Enter a valid email.').trim().toLowerCase(),
  role: z.enum(ACCESS_ROLES),
  departmentId: z.string().trim().max(60).default(''),
})

// A Service Manager needs one of Workforce's service departments; no other
// role keeps one.
async function departmentFor(role: AccessRole, departmentId: string): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (!DEPARTMENT_ROLES.includes(role)) return { ok: true, id: null }
  if (!departmentId) return { ok: false, error: `Pick the ${ROLE_LABELS[role]}'s department.` }
  const departments = await listServiceDepartments()
  if (!departments.some((d) => d.id === departmentId)) return { ok: false, error: 'Pick a department from the list.' }
  return { ok: true, id: departmentId }
}

export async function addAccessUser(input: { email: string; role: string; departmentId?: string }): Promise<ActionResult<{ name: string }>> {
  const actor = await getActor('access')
  if (!actor) return { ok: false, error: NO_ACCESS }

  const parsed = addSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { email, role } = parsed.data
  if (!grantableRoles(actor.role).includes(role)) {
    return { ok: false, error: `You can't give the ${ROLE_LABELS[role]} role.` }
  }
  const department = await departmentFor(role, parsed.data.departmentId)
  if (!department.ok) return department

  // vaa-sys only admits people who already have a VAA Workforce account.
  const staff = await findStaffUser(email)
  if (!staff) return { ok: false, error: `${email} has no VAA Workforce account. Ask an admin to create one there first.` }
  if (!staff.isActive) return { ok: false, error: `${email}'s VAA Workforce account is disabled.` }

  const existing = await prisma.accessUser.findUnique({ where: { email } })
  if (existing && !grantableRoles(actor.role).includes(existing.role)) {
    return { ok: false, error: `${email} already has the ${ROLE_LABELS[existing.role]} role, which you can't change.` }
  }

  await prisma.$transaction(async (tx) => {
    const row = await tx.accessUser.upsert({
      where: { email },
      create: { email, role, departmentId: department.id, addedByEmail: actor.email },
      update: { role, departmentId: department.id, isActive: true, addedByEmail: actor.email },
    })
    await logActivity(tx, actor, {
      entityType: 'Access',
      entityId: row.id,
      entityLabel: email,
      action: existing ? 'UPDATE' : 'CREATE',
      field: 'role',
      oldValue: existing ? `${existing.role}${existing.isActive ? '' : ' (removed)'}` : null,
      newValue: role,
    })
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

  await prisma.$transaction(async (tx) => {
    await tx.accessUser.update({ where: { id }, data: { isActive } })
    await logActivity(tx, actor, { entityType: 'Access', entityId: id, entityLabel: row.email, action: 'UPDATE', field: 'isActive', oldValue: row.isActive, newValue: isActive })
  })
  revalidatePath('/access')
  return { ok: true, data: null }
}

export async function changeAccessRole(id: string, role: AccessRole, departmentId = ''): Promise<ActionResult> {
  const actor = await getActor('access')
  if (!actor) return { ok: false, error: NO_ACCESS }

  const row = await prisma.accessUser.findUnique({ where: { id } })
  if (!row) return { ok: false, error: 'That person is no longer on the list.' }
  const grantable = grantableRoles(actor.role)
  if (!grantable.includes(row.role) || !grantable.includes(role)) {
    return { ok: false, error: "You can't make that change." }
  }
  const department = await departmentFor(role, departmentId || (row.role === role ? (row.departmentId ?? '') : ''))
  if (!department.ok) return department

  await prisma.$transaction(async (tx) => {
    await tx.accessUser.update({ where: { id }, data: { role, departmentId: department.id } })
    await logActivity(tx, actor, [
      ...(row.role !== role ? [{ entityType: 'Access', entityId: id, entityLabel: row.email, action: 'UPDATE', field: 'role', oldValue: row.role, newValue: role }] : []),
      ...(row.departmentId !== department.id
        ? [{ entityType: 'Access', entityId: id, entityLabel: row.email, action: 'UPDATE', field: 'departmentId', oldValue: row.departmentId, newValue: department.id }]
        : []),
    ])
  })
  revalidatePath('/access')
  return { ok: true, data: null }
}
