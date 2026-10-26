import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { customerScopeKind } from '@/lib/permissions'
import { dateOnly, manilaToday } from '@/lib/customer-fields'
import type { Actor } from '@/lib/auth'

// Which customers a person may see and act on. The one rule for reads
// (customerScopeWhere) and for every Server Action that takes a customer or
// account id (assertCustomerInScope / assertAccountInScope).
//
// - CS Specialist: customers assigned to them, plus customers they cover
//   through an active takeover (legacy CustomerTakeovers).
// - Everyone else who can read customers: all of them.
//   MODULE 2: a Service Manager should narrow to customers with requests or
//   connections in their department (Actor.departmentId) once those exist.

export async function activeTakeoverCustomerIds(email: string, now = new Date()): Promise<string[]> {
  const today = dateOnly(manilaToday(now))
  const rows = await prisma.customerTakeover.findMany({
    where: { specialistEmail: email.toLowerCase(), cancelledAt: null, startDate: { lte: today }, endDate: { gte: today } },
    select: { customerId: true },
  })
  return [...new Set(rows.map((r) => r.customerId))]
}

// null = no restriction.
export async function customerScopeWhere(user: Actor): Promise<Prisma.CustomerWhereInput | null> {
  if (customerScopeKind(user.role) === 'all') return null
  const email = user.email.toLowerCase()
  const covering = await activeTakeoverCustomerIds(email)
  return { OR: [{ assignedSpecialistEmail: email }, ...(covering.length ? [{ id: { in: covering } }] : [])] }
}

export async function assertCustomerInScope(user: Actor, customerId: string): Promise<boolean> {
  const scope = await customerScopeWhere(user)
  if (!scope) return true
  return (await prisma.customer.count({ where: { AND: [{ id: customerId }, scope] } })) > 0
}

export async function assertAccountInScope(user: Actor, accountId: string): Promise<boolean> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { customerId: true } })
  return !!account && assertCustomerInScope(user, account.customerId)
}

// Same rule for the activity log: a scoped person only sees rows filed
// under their customers.
export async function activityScopeWhere(user: Actor): Promise<Prisma.ActivityLogWhereInput | null> {
  const scope = await customerScopeWhere(user)
  if (!scope) return null
  const ids = (await prisma.customer.findMany({ where: scope, select: { id: true } })).map((c) => c.id)
  return { customerId: { in: ids } }
}
