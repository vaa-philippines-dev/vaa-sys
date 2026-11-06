import type { AccessRole } from '@/lib/access-fields'

// Client-safe: the one place that says which role may do what in vaa-sys.
// Every page and Server Action checks this map (through can() here, or
// requireCan()/getActorFor() in lib/auth.ts); the UI only hides what the
// server would refuse anyway.
//
// Modelled on the legacy CMS's PermissionsService.js _permDefaultFor (module
// × role create/read/update/delete) and NAV_ROLE_DEFAULT in scripts-core.html
// (which pages each role sees). Later modules extend MODULES and the grid
// below instead of writing role lists inline.
//
// Differences from the legacy defaults, on purpose:
// - Unknown actions are refused (legacy let any unknown action through).
// - Service Manager reads customers and accounts but doesn't edit them
//   (legacy gave C/R/U, but their pages are requests and connections).
// - Lead Manager keeps reading customers, as before this module.
// - Admins never need a CS Manager's review of their own status changes.

export const MODULES = [
  // Module 1: Customers & Accounts and the foundation.
  'customers',
  'accounts',
  'csSpecialists',
  'approvals',
  'contracts',
  'settings',
  'activityLogs',
  'access',
  'leads',
  // Lead Management's reports (/leads/reports): read-only figures on leads,
  // onboarding and the VAs requested.
  'leadReports',
  // The Leads Excel template and upload (/leads/import): adds and updates
  // leads at any phase. Admins only.
  'leadImport',
  // The Customers Excel template and upload (/customers/import): adds and
  // updates customers, statuses included. Admins only.
  'customerImport',
  // Test leads (lib/test-leads.ts): add a lead with a sample onboarding form.
  // Admins only. Deleting any lead is leads → delete (also admins only).
  'testLeads',
  // Lead Management's User access page (/leads/access), the same list as
  // Customer Management's Access page. Admins only; CS Managers keep their
  // own team on /access.
  'userAccess',
  // Lead Management's Departments & services page (/leads/departments):
  // VAA Workforce's service departments and services, edited in place
  // (lib/workforce-org.ts). Admins only, since every Workforce page uses them.
  // The services' confidential rates aren't a role grant: they're per person
  // (lib/rates.ts), and those people can open the page for them.
  'workforceOrg',
  // Later modules. Defaults follow the legacy grid; each module confirms
  // them when it is built.
  'serviceRequests',
  'vaConnections',
  'vaDatabase',
  'vaRates',
  'concerns',
  'meetings',
  'followUps',
  'playbook',
  // The Accounting System (/accounting): bills, payments, Foregone Revenue,
  // and the rates and fees a bill starts from (update). The Lead Manager
  // prepares a lead's initial bill as a leads update instead.
  'billing',
  'reports',
] as const
export type Module = (typeof MODULES)[number]

export type Action = 'read' | 'create' | 'update' | 'delete'

type Grant = Partial<Record<Action, true>>
const R: Grant = { read: true }
const RU: Grant = { read: true, update: true }
const CRU: Grant = { read: true, create: true, update: true }
const CRUD: Grant = { read: true, create: true, update: true, delete: true }

// Roles missing from a module's entry get nothing there. ADMIN is not
// listed: admins can do everything (checked in can()).
const GRID: Record<Module, Partial<Record<AccessRole, Grant>>> = {
  customers: {
    CS_MANAGER: CRUD,
    CUSTOMER_SPECIALIST: CRU,
    SERVICE_MANAGER: R,
    ACCOUNTING: R,
    EXECUTIVE: R,
    EXECUTIVE_SUPPORT: R,
    LEAD_MANAGER: R,
  },
  accounts: {
    CS_MANAGER: CRUD,
    CUSTOMER_SPECIALIST: CRU,
    SERVICE_MANAGER: R,
    ACCOUNTING: R,
    EXECUTIVE: R,
    EXECUTIVE_SUPPORT: R,
  },
  // Read: see the team and their portfolios. Update: assign, transfer,
  // takeovers.
  csSpecialists: { CS_MANAGER: CRUD, CUSTOMER_SPECIALIST: R },
  // Confirm or cancel a pending status change.
  approvals: { CS_MANAGER: CRUD },
  // Contract templates, one database for both areas (Customer Management's
  // /contracts and Lead Management's /leads/contracts). Picking an account's
  // contract is an accounts update, or a leads update for a lead's account
  // in Contract & Billing Initiation.
  contracts: { CS_MANAGER: CRUD, LEAD_MANAGER: CRU, CUSTOMER_SPECIALIST: R, ACCOUNTING: R, EXECUTIVE: R, EXECUTIVE_SUPPORT: R },
  settings: {},
  activityLogs: { CS_MANAGER: R, EXECUTIVE: R, EXECUTIVE_SUPPORT: R },
  // CS Managers only grant the Customer Specialist role (grantableRoles).
  access: { CS_MANAGER: CRU },
  // No delete for anyone but admins: deleting a lead removes it for good.
  leads: { LEAD_MANAGER: CRU },
  // The Lead Manager, plus the managers who follow the pipeline. Read only:
  // the reports never change anything.
  leadReports: { LEAD_MANAGER: R, CS_MANAGER: R, EXECUTIVE: R, EXECUTIVE_SUPPORT: R },
  leadImport: {},
  customerImport: {},
  testLeads: {},
  userAccess: {},
  workforceOrg: {},

  // Service Requests (/service-requests, Nov 5, 2026). Who may take each
  // step is checked in lib/service-requests.ts: the customer's CS, the
  // ticket's Service Department Manager, HR for the Rate Agreement.
  serviceRequests: {
    CS_MANAGER: CRUD,
    CUSTOMER_SPECIALIST: CRU,
    SERVICE_MANAGER: CRUD,
    HR_SPECIALIST: RU,
    HR_MANAGER: RU,
    RECRUITMENT_SPECIALIST: R,
    TRAINING_MANAGER: R,
    ACCOUNTING: R,
    EXECUTIVE: R,
    EXECUTIVE_SUPPORT: R,
  },
  vaConnections: {
    CS_MANAGER: CRUD,
    CUSTOMER_SPECIALIST: CRU,
    SERVICE_MANAGER: CRUD,
    HR_SPECIALIST: CRU,
    HR_MANAGER: CRUD,
    RECRUITMENT_SPECIALIST: CRU,
    TRAINING_MANAGER: CRU,
    ACCOUNTING: R,
    EXECUTIVE: R,
    EXECUTIVE_SUPPORT: R,
  },
  vaDatabase: {
    CS_MANAGER: CRUD,
    CUSTOMER_SPECIALIST: CRU,
    SERVICE_MANAGER: CRUD,
    HR_SPECIALIST: CRU,
    HR_MANAGER: CRUD,
    RECRUITMENT_SPECIALIST: CRU,
    TRAINING_MANAGER: CRU,
    ACCOUNTING: R,
    EXECUTIVE: R,
    EXECUTIVE_SUPPORT: R,
  },
  // Who may see VA rates at all (legacy _canSeeVARate). Rates are stripped
  // from every other role's data on the server.
  vaRates: { CS_MANAGER: R, HR_SPECIALIST: CRU, HR_MANAGER: CRUD, ACCOUNTING: CRU },
  concerns: {
    CS_MANAGER: CRUD,
    CUSTOMER_SPECIALIST: CRU,
    SERVICE_MANAGER: CRUD,
    HR_SPECIALIST: R,
    HR_MANAGER: R,
    ACCOUNTING: R,
    EXECUTIVE: R,
    EXECUTIVE_SUPPORT: R,
  },
  meetings: { CS_MANAGER: CRUD, CUSTOMER_SPECIALIST: CRU, SERVICE_MANAGER: CRUD, EXECUTIVE: R, EXECUTIVE_SUPPORT: R },
  followUps: { CS_MANAGER: CRUD, CUSTOMER_SPECIALIST: CRUD },
  playbook: { CS_MANAGER: CRUD, CUSTOMER_SPECIALIST: CRU, EXECUTIVE: R, EXECUTIVE_SUPPORT: R },
  // The Lead Manager reads it to follow a lead's bill after sending it.
  billing: { ACCOUNTING: CRUD, CS_MANAGER: R, LEAD_MANAGER: R, EXECUTIVE: R, EXECUTIVE_SUPPORT: R },
  reports: { CS_MANAGER: R, SERVICE_MANAGER: R, HR_MANAGER: R, EXECUTIVE: R, EXECUTIVE_SUPPORT: R },
}

export function can(role: AccessRole | null | undefined, module: Module, action: Action = 'read'): boolean {
  if (!role) return false
  if (role === 'ADMIN') return true
  return GRID[module][role]?.[action] === true
}

// CS Managers (and admins) review other people's pauses, terminations and
// cancellations; their own apply without review.
export function needsStatusReview(role: AccessRole): boolean {
  return !can(role, 'approvals', 'update')
}

// Whose customers a role sees. 'own' = assigned to them plus active
// takeovers (CS Specialist); everyone else with customers.read sees all.
export function customerScopeKind(role: AccessRole): 'all' | 'own' {
  return role === 'CUSTOMER_SPECIALIST' ? 'own' : 'all'
}
