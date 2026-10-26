// Client-safe: roles, what each area allows, and where each role lands.
// The capability map itself is lib/permissions.ts; the Prisma/session side
// lives in lib/auth.ts.
import { can } from '@/lib/permissions'

export const ACCESS_ROLES = [
  'ADMIN',
  'CS_MANAGER',
  'CUSTOMER_SPECIALIST',
  'LEAD_MANAGER',
  'SERVICE_MANAGER',
  'HR_SPECIALIST',
  'HR_MANAGER',
  'ACCOUNTING',
  'RECRUITMENT_SPECIALIST',
  'TRAINING_MANAGER',
  'EXECUTIVE',
  'EXECUTIVE_SUPPORT',
] as const
export type AccessRole = (typeof ACCESS_ROLES)[number]

export const ROLE_LABELS: Record<AccessRole, string> = {
  ADMIN: 'Admin',
  CS_MANAGER: 'Customer Success Manager',
  CUSTOMER_SPECIALIST: 'Customer Specialist',
  LEAD_MANAGER: 'Lead Manager',
  SERVICE_MANAGER: 'Service Manager',
  HR_SPECIALIST: 'HR Specialist',
  HR_MANAGER: 'HR Manager',
  ACCOUNTING: 'Accounting',
  RECRUITMENT_SPECIALIST: 'Recruitment Specialist',
  TRAINING_MANAGER: 'Training Manager',
  EXECUTIVE: 'Executive',
  EXECUTIVE_SUPPORT: 'Executive Support',
}

export const ROLE_DESCRIPTIONS: Record<AccessRole, string> = {
  ADMIN: 'Everything, including access and settings.',
  CS_MANAGER: 'All customers and accounts, approvals, CS Specialists, contracts and the activity log. Adds or removes Customer Specialists.',
  CUSTOMER_SPECIALIST: 'Their own customers and accounts, plus customers they are covering.',
  LEAD_MANAGER: 'Lead Management. Can view customers.',
  SERVICE_MANAGER: 'Views customers and accounts. Service requests and VA connections for their department arrive with later modules.',
  HR_SPECIALIST: 'VA rates and HR work, arriving with later modules.',
  HR_MANAGER: 'VA rates and HR work, arriving with later modules.',
  ACCOUNTING: 'Views customers, accounts and contracts. Billing arrives with a later module.',
  RECRUITMENT_SPECIALIST: 'Recruitment stages of service requests, arriving with a later module.',
  TRAINING_MANAGER: 'Training stages of service requests, arriving with a later module.',
  EXECUTIVE: 'Views customers, accounts, contracts and the activity log.',
  EXECUTIVE_SUPPORT: 'Views customers, accounts, contracts and the activity log.',
}

// Roles tied to one Workforce service department.
export const DEPARTMENT_ROLES: AccessRole[] = ['SERVICE_MANAGER']

// The older area names pages already use, mapped onto the capability map.
export type Area = 'customers' | 'customerStatus' | 'leads' | 'access'

export function canUse(role: AccessRole | null | undefined, area: Area): boolean {
  if (area === 'customers') return can(role, 'customers', 'read')
  if (area === 'customerStatus') return can(role, 'customers', 'update')
  if (area === 'leads') return can(role, 'leads', 'read')
  return can(role, 'access', 'read')
}

// Which roles a person may grant on the Access page. CS Managers only
// manage their own team.
export function grantableRoles(role: AccessRole | null | undefined): AccessRole[] {
  if (role === 'ADMIN') return [...ACCESS_ROLES]
  if (role === 'CS_MANAGER') return ['CUSTOMER_SPECIALIST']
  return []
}

// Where someone lands after signing in. Admins get the area picker.
export function homeFor(role: AccessRole): string {
  if (role === 'ADMIN') return '/'
  if (role === 'LEAD_MANAGER') return '/leads'
  if (can(role, 'customers', 'read')) return '/customers'
  // Roles whose own pages arrive with later modules.
  return '/waiting'
}
