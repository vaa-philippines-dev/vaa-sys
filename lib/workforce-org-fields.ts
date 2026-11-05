import { z } from 'zod'

// Client-safe: labels and form schemas for Lead Management's Departments &
// services page (/leads/departments). It shows VAA Workforce's service
// departments and services (asked for on Nov 5, 2026; it showed every
// department and the positions before). vaa-sys writes to Workforce only
// here: public.departments (service level) and public.skills.job_description
// (lib/workforce-org.ts). The rest of a service's details are vaa-sys's own
// (vaa_sys.service_profiles), and its two rates are confidential
// (lib/rates.ts).

export const DEPARTMENT_LEVELS = ['EXECUTIVE', 'MANAGEMENT', 'SERVICE'] as const
export type DepartmentLevel = (typeof DEPARTMENT_LEVELS)[number]

// Workforce's statuses. Merging and splitting a department are done in
// Workforce (they move people and history), so here a department is only
// switched between Active and Inactive; a merged or split one is read-only.
export const DEPARTMENT_STATUSES = ['ACTIVE', 'MERGED', 'SPLIT', 'INACTIVE'] as const
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number]
export const EDITABLE_STATUSES = ['ACTIVE', 'INACTIVE'] as const
export const DEPARTMENT_STATUS_LABELS: Record<DepartmentStatus, string> = {
  ACTIVE: 'Active',
  MERGED: 'Merged',
  SPLIT: 'Split',
  INACTIVE: 'Inactive',
}

export type OrgDepartment = {
  id: string
  name: string
  shortName: string | null
  acronym: string | null
  description: string | null
  parentId: string | null
  level: DepartmentLevel | null
  status: DepartmentStatus
  sortOrder: number
  headName: string | null
  mergedIntoName: string | null
  serviceCount: number
  memberCount: number
  updatedAt: string
}

// A rate as the page receives it: a number for someone allowed to see it,
// otherwise left out of the page entirely (never sent to the browser).
export type RateCell = { value: number | null; problem: 'locked' | 'other-key' | 'unreadable' | null }

export type OrgService = {
  id: string
  name: string
  category: string
  isActive: boolean
  departmentIds: string[]
  jobDescription: string | null
  contractId: string | null
  onboardingService: string | null
  // Only for people who can see the rates (lib/rates.ts).
  rates?: { standard: RateCell; vaBase: RateCell; updatedAt: string | null; updatedBy: string | null }
}

export type ContractOption = { id: string; label: string }

const text = (max: number) => z.string().trim().max(max)

// Service departments only: the level is always Service.
export const departmentSchema = z.object({
  name: text(120).min(1, 'Enter the department’s name.'),
  shortName: text(60),
  acronym: text(20),
  description: text(1000),
  parentId: z.string().nullable(),
  status: z.enum(EDITABLE_STATUSES),
  sortOrder: z.number({ message: 'Enter a number for the order.' }).int('Use a whole number for the order.').min(0).max(9999),
})
export type DepartmentInput = z.infer<typeof departmentSchema>

export const serviceDetailsSchema = z.object({
  // Markdown (bold, italics, headings, lists), saved as Workforce's own
  // job description, which stays readable as plain text.
  jobDescription: text(20000),
  contractId: z.string().nullable(),
  onboardingService: z.string().nullable(),
})
export type ServiceDetailsInput = z.infer<typeof serviceDetailsSchema>

const rate = z
  .number({ message: 'Enter the rate as a number.' })
  .min(0, 'A rate can’t be negative.')
  .max(10000, 'That rate looks too high.')
  .nullable()
export const serviceRatesSchema = z.object({ standard: rate, vaBase: rate })
export type ServiceRatesInput = z.infer<typeof serviceRatesSchema>

export const RATE_PROBLEMS: Record<NonNullable<RateCell['problem']>, string> = {
  locked: 'Locked: the rates key isn’t set on this server',
  'other-key': 'Saved with a different rates key',
  unreadable: 'Can’t be read',
}

// The department and its parents, top first: "Service › Amazon".
export function departmentPath(id: string | null, byId: Map<string, Pick<OrgDepartment, 'name' | 'parentId'>>): string {
  const names: string[] = []
  const seen = new Set<string>()
  for (let cur = id; cur && !seen.has(cur); cur = byId.get(cur)?.parentId ?? null) {
    seen.add(cur)
    const d = byId.get(cur)
    if (d) names.unshift(d.name)
  }
  return names.join(' › ')
}
