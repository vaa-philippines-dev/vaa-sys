import { prisma } from '@/lib/prisma'

// Read-only links to VAA Workforce (va-management) data, always raw SQL —
// never Prisma models (see the top of prisma/schema.prisma). The only writes
// to Workforce (service departments and services' job descriptions) are in
// lib/workforce-org.ts.
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

// A person on VAA Workforce's Staff list (public.staff_records), by work
// email. Someone promoted or transferred has several rows there, the old
// ones marked TRANSFERRED or END OF CONTRACT, so a person is active when any
// of their rows is: an active general status (ACTIVE, ON HOLD) and not an
// ended employment status. Otherwise they have left (EOC), and endedOn is
// their latest end-of-contract date.
export type StaffMember = StaffName & { active: boolean; position: string | null; department: string | null; endedOn: Date | null; status: string | null }

const ENDED_EMPLOYMENT = ['END OF CONTRACT', 'RESIGNED', 'TERMINATED', 'BLACKLISTED']
const ACTIVE_GENERAL = ['ACTIVE', 'ON HOLD']

// Either everyone with a mailbox on `domain`, or the given emails.
function staffQuery(where: 'domain' | 'emails', value: string | string[]) {
  const pattern = where === 'domain' ? `%${value as string}` : null
  const emails = where === 'emails' ? (value as string[]) : []
  return prisma.$queryRaw<StaffMember[]>`
    WITH rows AS (
      SELECT lower(trim(work_email)) AS email,
             trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) AS name,
             position, department, eoc_date, employment_status, general_status,
             (upper(coalesce(general_status, '')) = ANY(${ACTIVE_GENERAL}) AND NOT upper(coalesce(employment_status, '')) = ANY(${ENDED_EMPLOYMENT})) AS active,
             created_at
      FROM public.staff_records
      WHERE coalesce(trim(work_email), '') <> ''
        AND (lower(trim(work_email)) LIKE ${pattern ?? ''} OR lower(trim(work_email)) = ANY(${emails}::text[]))
    )
    SELECT DISTINCT ON (email)
           email, name, active, position, department,
           (SELECT max(r2.eoc_date) FROM rows r2 WHERE r2.email = rows.email) AS "endedOn",
           coalesce(nullif(general_status, ''), employment_status) AS status
    FROM rows
    ORDER BY email, active DESC, created_at DESC`
}

// Everyone on Workforce's Staff list with a company mailbox, for the Access
// page's name picker: active staff first, then those who have left (shown,
// but they can't be given access).
export async function listStaff(domain: string): Promise<StaffMember[]> {
  const rows = await staffQuery('domain', domain).catch(() => [] as StaffMember[])
  return rows.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
}

// The Staff list's view of some work emails (lowercase keys). Emails not on
// it are missing from the map: no staff record says they left.
export async function staffStatus(emails: string[]): Promise<Map<string, StaffMember>> {
  const list = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))]
  if (list.length === 0) return new Map()
  const rows = await staffQuery('emails', list).catch(() => [] as StaffMember[])
  return new Map(rows.map((r) => [r.email, r]))
}

// A VA's 201 file and payout summary links on their Workforce profile
// (public.va_profiles), for the Rate Agreement. The 201 file falls back to
// the 201 folders when only those are filled in.
export type VaFileLinks = { file201: string | null; file201Label: string; payoutSummary: string | null }

export async function vaFileLinks(vaProfileId: string): Promise<VaFileLinks> {
  const rows = await prisma.$queryRaw<{ file: string | null; folder: string | null; dept: string | null; payout: string | null }[]>`
    SELECT nullif(trim(file_201_link), '') AS file, nullif(trim(folder_201_link), '') AS folder,
           nullif(trim(dept_201_folder_link), '') AS dept, nullif(trim(payout_summary_link), '') AS payout
    FROM public.va_profiles WHERE id = ${vaProfileId}`.catch(() => [])
  const r = rows[0]
  const file201 = r?.file ?? r?.folder ?? r?.dept ?? null
  return { file201, file201Label: r?.file ? '201 file' : r?.folder ? '201 folder' : r?.dept ? 'Department 201 folder' : '201 file', payoutSummary: r?.payout ?? null }
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
