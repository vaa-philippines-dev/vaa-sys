import { prisma } from '@/lib/prisma'

// Read-only links to VAA Workforce (va-management) data, always raw SQL —
// never Prisma models (see the top of prisma/schema.prisma).
//
// Departments and services are Workforce's, not copied into vaa_sys:
// - a department is a client-facing service department in
//   public.departments (level SERVICE, active, under the "Service" level
//   record; same rule as va-management's SERVICE_DEPARTMENT_WHERE)
// - a service is a public.skills row ("Service" in Workforce's UI), linked
//   to the departments that offer it through public.department_skills.

export type WorkforceDepartment = { id: string; name: string }
export type WorkforceService = { id: string; name: string; departments: string[] }
export type StaffName = { email: string; name: string }

export async function listServiceDepartments(): Promise<WorkforceDepartment[]> {
  return prisma.$queryRaw<WorkforceDepartment[]>`
    SELECT id, name
    FROM public.departments
    WHERE level::text = 'SERVICE' AND status::text = 'ACTIVE' AND parent_id IS NOT NULL
    ORDER BY sort_order, name`.catch(() => [])
}

export async function listServices(): Promise<WorkforceService[]> {
  return prisma.$queryRaw<WorkforceService[]>`
    SELECT s.id, s.name,
           coalesce(array_agg(d.name ORDER BY d.sort_order, d.name) FILTER (WHERE d.id IS NOT NULL), ARRAY[]::text[]) AS departments
    FROM public.skills s
    LEFT JOIN public.department_skills ds ON ds.skill_id = s.id
    LEFT JOIN public.departments d ON d.id = ds.department_id AND d.status::text = 'ACTIVE'
    WHERE s.is_active
    GROUP BY s.id, s.name
    ORDER BY s.name`.catch(() => [])
}

export async function departmentNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.$queryRaw<WorkforceDepartment[]>`
    SELECT id, name FROM public.departments WHERE id = ANY(${ids})`.catch(() => [])
  return new Map(rows.map((r) => [r.id, r.name]))
}

// Full names for a set of work emails (lowercase keys).
export async function staffNames(emails: string[]): Promise<Map<string, string>> {
  const list = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))]
  if (list.length === 0) return new Map()
  const rows = await prisma.$queryRaw<StaffName[]>`
    SELECT lower(email) AS email, trim(first_name || ' ' || last_name) AS name
    FROM public.users WHERE lower(email) = ANY(${list})`.catch(() => [])
  return new Map(rows.map((r) => [r.email, r.name || r.email]))
}
