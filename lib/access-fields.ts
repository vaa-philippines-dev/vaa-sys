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
  CS_MANAGER: 'All customers and accounts, approvals, CS Specialists, contracts, the activity log and lead reports. Adds or removes Customer Specialists. Runs any customer’s service requests and closes them as lost.',
  CUSTOMER_SPECIALIST: 'Their own customers and accounts, plus customers they are covering. Opens their service requests, sets a VA request’s department if needed, and holds the kick-off and VA connection calls.',
  LEAD_MANAGER: 'Lead Management, including contracts, initial bills and lead reports. Can view customers and the Accounting System.',
  SERVICE_MANAGER: 'Views customers and accounts. On every VA request in their department (no one assigns them): assigns the main and buffer VAs, moves prepared VAs to Rate Agreement, and marks a VA started.',
  HR_SPECIALIST: 'The Rate Agreements assigned to them: sets the terms (bonds, night differential, incremental wage increase) and records each step until the VA acknowledges it. Sees only service requests that reached Rate Agreement.',
  HR_MANAGER: 'All Rate Agreements: assigns each to an HR Specialist and can work on any of them. Sees only service requests that reached Rate Agreement.',
  ACCOUNTING: 'The Accounting System: bills, payments, Foregone Revenue, rates and fees. Views customers, accounts and contracts.',
  RECRUITMENT_SPECIALIST: 'Recruitment stages of service requests, arriving with a later module.',
  TRAINING_MANAGER: 'Training stages of service requests, arriving with a later module.',
  EXECUTIVE: 'Views customers, accounts, contracts, the activity log and lead reports.',
  EXECUTIVE_SUPPORT: 'Views customers, accounts, contracts, the activity log and lead reports. Checks schedule changes made while a service request is open, before the VA can start.',
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
  if (role === 'ACCOUNTING') return '/accounting'
  if (can(role, 'customers', 'read')) return '/customers'
  // HR's view of Customer Management is the Rate Agreements (Nov 6, 2026).
  if (role === 'HR_SPECIALIST' || role === 'HR_MANAGER') return '/rate-agreements'
  if (can(role, 'serviceRequests', 'read')) return '/service-requests'
  // Roles whose own pages arrive with later modules.
  return '/waiting'
}
