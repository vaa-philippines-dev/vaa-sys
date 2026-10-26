// Client-safe: roles, what each area allows, and where each role lands.
// The Prisma/session side lives in lib/auth.ts.

export const ACCESS_ROLES = ['ADMIN', 'CS_MANAGER', 'CUSTOMER_SPECIALIST', 'LEAD_MANAGER'] as const
export type AccessRole = (typeof ACCESS_ROLES)[number]

export const ROLE_LABELS: Record<AccessRole, string> = {
  ADMIN: 'Admin',
  CS_MANAGER: 'Customer Success Manager',
  CUSTOMER_SPECIALIST: 'Customer Specialist',
  LEAD_MANAGER: 'Lead Manager',
}

export const ROLE_DESCRIPTIONS: Record<AccessRole, string> = {
  ADMIN: 'Everything, including access.',
  CS_MANAGER: 'Customer Management, and adds or removes Customer Specialists.',
  CUSTOMER_SPECIALIST: 'Customer Management.',
  LEAD_MANAGER: 'Lead Management. Can view customers.',
}

export type Area = 'customers' | 'customerStatus' | 'leads' | 'access' | 'settings'

const AREA_ROLES: Record<Area, readonly AccessRole[]> = {
  customers: ['ADMIN', 'CS_MANAGER', 'CUSTOMER_SPECIALIST', 'LEAD_MANAGER'],
  customerStatus: ['ADMIN', 'CS_MANAGER', 'CUSTOMER_SPECIALIST'],
  leads: ['ADMIN', 'LEAD_MANAGER'],
  access: ['ADMIN', 'CS_MANAGER'],
  // General settings, e.g. the onboarding form's work hour minimums.
  settings: ['ADMIN'],
}

export function canUse(role: AccessRole | null | undefined, area: Area): boolean {
  return !!role && AREA_ROLES[area].includes(role)
}

// Which roles a person may grant on the Access page.
export function grantableRoles(role: AccessRole | null | undefined): AccessRole[] {
  if (role === 'ADMIN') return [...ACCESS_ROLES]
  if (role === 'CS_MANAGER') return ['CUSTOMER_SPECIALIST']
  return []
}

// Where someone lands after signing in. Admins get the area picker.
export function homeFor(role: AccessRole): string {
  if (role === 'ADMIN') return '/'
  if (role === 'LEAD_MANAGER') return '/leads'
  return '/customers'
}
