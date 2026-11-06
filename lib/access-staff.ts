import { prisma } from '@/lib/prisma'
import { staffStatus, type StaffMember } from '@/lib/workforce'
import type { AccessRole } from '@/lib/access-fields'

// Server-only: people who still have access to VAA Systems but have left
// VAA in VAA Workforce (Nov 6, 2026): their Staff list record ended (EOC,
// resigned, removed) or their Workforce account is disabled. Access isn't
// removed by itself; the Access page and its nav item say so, and whoever
// manages access removes them.

export type LeftWithAccess = { id: string; email: string; role: AccessRole; name: string; endedOn: Date | null; reason: string }

export async function accessPeopleWhoLeft(): Promise<LeftWithAccess[]> {
  const rows = await prisma.accessUser.findMany({ where: { isActive: true }, select: { id: true, email: true, role: true } })
  if (rows.length === 0) return []
  const emails = rows.map((r) => r.email)
  const [staff, disabled] = await Promise.all([
    staffStatus(emails),
    prisma.$queryRaw<{ email: string }[]>`SELECT lower(email) AS email FROM public.users WHERE lower(email) = ANY(${emails}) AND NOT is_active`.catch(() => []),
  ])
  const off = new Set(disabled.map((d) => d.email))
  return rows.flatMap((r) => {
    const s: StaffMember | undefined = staff.get(r.email)
    if (s && !s.active) return [{ id: r.id, email: r.email, role: r.role as AccessRole, name: s.name || r.email, endedOn: s.endedOn, reason: staffReason(s) }]
    if (off.has(r.email)) return [{ id: r.id, email: r.email, role: r.role as AccessRole, name: s?.name || r.email, endedOn: null, reason: 'VAA Workforce account disabled' }]
    return []
  })
}

// "End of contract" / "Resigned" / "Removed", from the Staff list's words.
export function staffReason(s: Pick<StaffMember, 'status'>): string {
  const status = (s.status ?? '').toUpperCase()
  if (status === 'RESIGNED') return 'Resigned'
  if (status === 'REMOVED' || status === 'INACTIVE') return 'End of contract'
  if (status === 'TRANSFERRED') return 'Transferred out'
  if (status === 'BLACKLISTED') return 'Blacklisted'
  return 'End of contract'
}
