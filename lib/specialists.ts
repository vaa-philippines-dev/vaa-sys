import { prisma } from '@/lib/prisma'
import { staffNames } from '@/lib/workforce'
import { dateOnly, dayString, manilaToday, type CustomerStatus } from '@/lib/customer-fields'

// Server-only: the CS team (Customer Specialists and CS Managers on the
// Access page) and their portfolios (legacy getCSSpecialistsWithData,
// CustomerTakeovers).

export const CS_TEAM_ROLES = ['CUSTOMER_SPECIALIST', 'CS_MANAGER'] as const

export async function isCsTeamMember(email: string): Promise<boolean> {
  const row = await prisma.accessUser.findUnique({ where: { email: email.toLowerCase() }, select: { role: true, isActive: true } })
  return !!row?.isActive && (CS_TEAM_ROLES as readonly string[]).includes(row.role)
}

export type TeamMember = { email: string; name: string; role: (typeof CS_TEAM_ROLES)[number] }

export async function listCsTeam(): Promise<TeamMember[]> {
  const rows = await prisma.accessUser.findMany({
    where: { isActive: true, role: { in: [...CS_TEAM_ROLES] } },
    select: { email: true, role: true },
    orderBy: { email: 'asc' },
  })
  const names = await staffNames(rows.map((r) => r.email))
  return rows
    .map((r) => ({ email: r.email, name: names.get(r.email) ?? r.email, role: r.role as TeamMember['role'] }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type TakeoverState = 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'CANCELLED'

export function takeoverState(t: { startDate: Date; endDate: Date; cancelledAt: Date | null }, today = manilaToday()): TakeoverState {
  if (t.cancelledAt) return 'CANCELLED'
  if (dayString(t.endDate) < today) return 'EXPIRED'
  if (dayString(t.startDate) > today) return 'UPCOMING'
  return 'ACTIVE'
}

// Everything the CS Specialists page shows: each team member's customers by
// status, the takeovers, and customers nobody owns.
export async function specialistsOverview() {
  const team = await listCsTeam()
  const today = manilaToday()
  const [customers, takeovers] = await Promise.all([
    prisma.customer.findMany({
      select: { id: true, name: true, customerCode: true, status: true, assignedSpecialistEmail: true },
      orderBy: { name: 'asc' },
    }),
    prisma.customerTakeover.findMany({
      // Recent history plus anything still running or upcoming.
      where: { OR: [{ endDate: { gte: dateOnly(today) } }, { createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } }] },
      orderBy: [{ startDate: 'desc' }],
      include: { customer: { select: { id: true, name: true, assignedSpecialistEmail: true } } },
    }),
  ])
  const names = await staffNames([...takeovers.map((t) => t.specialistEmail), ...customers.map((c) => c.assignedSpecialistEmail ?? '')])
  const teamEmails = new Set(team.map((m) => m.email))

  const portfolio = team.map((m) => {
    const own = customers.filter((c) => c.assignedSpecialistEmail === m.email)
    const byStatus = own.reduce<Partial<Record<CustomerStatus, number>>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {})
    const covering = takeovers.filter((t) => t.specialistEmail === m.email && takeoverState(t, today) === 'ACTIVE')
    return { ...m, customers: own, byStatus, covering: covering.length }
  })
  // Customers owned by someone who is no longer on the CS team count as
  // unassigned too, so they don't disappear.
  const unassigned = customers.filter((c) => !c.assignedSpecialistEmail || !teamEmails.has(c.assignedSpecialistEmail))

  return {
    team,
    portfolio,
    unassigned: unassigned.map((c) => ({ ...c, formerOwner: c.assignedSpecialistEmail ? (names.get(c.assignedSpecialistEmail) ?? c.assignedSpecialistEmail) : null })),
    takeovers: takeovers.map((t) => ({ ...t, state: takeoverState(t, today), specialistName: names.get(t.specialistEmail) ?? t.specialistEmail })),
    today,
  }
}
