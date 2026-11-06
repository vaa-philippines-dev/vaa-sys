import { prisma } from '@/lib/prisma'
import { listServiceDepartments, listServices, staffNames, type WorkforceDepartment } from '@/lib/workforce'

// Server-only: each VA request's department and who acts on it (Nov 6,
// 2026). A request's department is its service's VAA Workforce service
// department: the Workforce service the onboarding service is linked to
// (service_profiles, from Departments & services), or the Workforce service
// of that name (imports), preferring the department named in the service
// ("Wholesale - Virtual Assistant" offers Amazon and Wholesale → Wholesale).
// The CS can change it on the ticket. Nobody assigns a manager: every active
// Service Manager of the department on Access can act on the request.

export type DepartmentInfo = { departments: WorkforceDepartment[]; byService: Map<string, string>; managers: Map<string, { email: string; name: string }[]> }

const lower = (s: string) => s.trim().toLowerCase()

export async function departmentInfo(): Promise<DepartmentInfo> {
  const [departments, services, profiles, managers] = await Promise.all([
    listServiceDepartments(),
    listServices(),
    prisma.serviceProfile.findMany({ where: { onboardingService: { not: null } }, select: { skillId: true, onboardingService: true } }),
    prisma.accessUser.findMany({ where: { role: 'SERVICE_MANAGER', isActive: true, departmentId: { not: null } }, select: { email: true, departmentId: true } }),
  ])
  const deptByName = new Map(departments.map((d) => [lower(d.name), d.id]))
  const pick = (serviceName: string, names: string[]) => {
    const named = lower(serviceName.split(' - ')[0])
    const ids = names.map((n) => deptByName.get(lower(n))).filter((x): x is string => !!x)
    return deptByName.get(named) && ids.includes(deptByName.get(named)!) ? deptByName.get(named)! : (ids[0] ?? deptByName.get(named) ?? null)
  }
  const byService = new Map<string, string>()
  const skillById = new Map(services.map((s) => [s.id, s]))
  for (const s of services) {
    const id = pick(s.name, s.departments)
    if (id) byService.set(lower(s.name), id)
  }
  for (const p of profiles) {
    const s = skillById.get(p.skillId)
    const id = s ? pick(p.onboardingService!, s.departments) : null
    if (id) byService.set(lower(p.onboardingService!), id)
  }
  const names = await staffNames(managers.map((m) => m.email))
  const byDept = new Map<string, { email: string; name: string }[]>()
  for (const m of managers) byDept.set(m.departmentId!, [...(byDept.get(m.departmentId!) ?? []), { email: m.email, name: names.get(m.email) ?? m.email }])
  return { departments, byService, managers: byDept }
}

// The department a service belongs to, or null when none matches.
export function departmentForService(info: DepartmentInfo, service: string): string | null {
  const known = info.byService.get(lower(service))
  if (known) return known
  const named = lower(service.split(' - ')[0])
  return info.departments.find((d) => lower(d.name) === named)?.id ?? null
}

// A request's department: its own, or its service's.
export const requestDepartment = (info: DepartmentInfo, r: { departmentId: string | null; service: string }) => r.departmentId ?? departmentForService(info, r.service)

// Whether someone is a Service Department Manager for a request: an active
// Service Manager of its department (admins can always act).
export const managesDepartment = (actor: { role: string; departmentId: string | null }, departmentId: string | null) =>
  actor.role === 'ADMIN' || (actor.role === 'SERVICE_MANAGER' && !!departmentId && actor.departmentId === departmentId)
