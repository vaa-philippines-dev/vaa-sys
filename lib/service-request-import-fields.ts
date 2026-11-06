import type { SheetColumn } from '@/lib/import-sheet'

// Client-safe: the Service Requests import's columns (Nov 6, 2026;
// lib/service-request-import.ts). One row is one VA request (sub-ticket) on
// a ticket for an existing account, found by its Account ID. Rows with the
// same Ticket ID make one ticket. The focal person isn't imported: the
// ticket shows the account's focal contact.

export const SR_IMPORT_MAX_ROWS = 500
export const SR_IMPORT_MAX_BYTES = 900 * 1024

// The template's sample row, marked by its Account ID. Left in a file, it's skipped.
export const SR_IMPORT_SAMPLE_ACCOUNT = 'SAMPLE (delete this row)'

export const SR_IMPORT_COLUMNS = [
  { key: 'ticketId', header: 'Ticket ID', width: 14, note: 'TKT-000123 (or 123), e.g. the old system’s ticket number. Rows with the same Ticket ID make one ticket, so one ticket can have several services and departments. Blank = a new ticket with the next number, one per row. A ticket already in the system is skipped, so the file can be imported again.' },
  { key: 'subticketId', header: 'Sub-ticket ID', width: 16, note: 'TKT-000123-01 (or 01): this VA request’s number on the ticket. Blank = the next number on the ticket.' },
  { key: 'accountId', header: 'Account ID', width: 18, note: 'The account’s CLT_… code. Required: the customer is the account’s.' },
  { key: 'requestType', header: 'Request type', width: 14, note: 'New, Additional, Replacement or Reliever.' },
  { key: 'requestGroup', header: 'Request group', width: 14, note: 'Standard, Expert or Casual.' },
  { key: 'department', header: 'Department', width: 20, note: 'The VAA Workforce service department the VA comes from. Blank = the department mapped to the service, or the service’s own. Its Service Managers on Access act on the request.' },
  { key: 'service', header: 'Service', width: 30, note: 'The service, e.g. Amazon - Virtual Assistant. Other names (e.g. “Amazon VA”) are mapped to a service on the import page once, and the mapping is kept for later imports.' },
  { key: 'phase', header: 'Phase', width: 22, note: 'Where the ticket is. Blank = VA Assignment. From here on the phase follows the VAs assigned in the app.' },
  { key: 'timeZone', header: 'Client time zone', width: 24, note: 'IANA zone, e.g. America/New_York. Blank = the account’s time zone. Start and end times are in this zone.' },
  { key: 'scheduleType', header: 'Schedule type', width: 14, note: 'Regular or Project-based.' },
  { key: 'regularSchedule', header: 'Regular schedule', width: 20, note: 'For Regular: Daily, fixed time; Daily, flexible time; Weekly; or Monthly.' },
  { key: 'startTime', header: 'Start time', width: 11, note: 'Daily, fixed time: the start in the client’s time zone, e.g. 9:00 AM or 21:00.' },
  { key: 'endTime', header: 'End time', width: 11, note: 'Daily, fixed time: the end in the client’s time zone.' },
  { key: 'hoursPerDay', header: 'Hours per day', width: 10, note: 'Daily, flexible time: the hours a day. Fills Mon–Fri when the day columns are blank.' },
  { key: 'mon', header: 'Mon', width: 6, note: 'Daily schedules: hours on Monday. Blank Mon–Fri take the hours per day (or the shift); 0 is a day off; fill Sat or Sun to add them.' },
  { key: 'tue', header: 'Tue', width: 6, note: 'Hours on Tuesday.' },
  { key: 'wed', header: 'Wed', width: 6, note: 'Hours on Wednesday.' },
  { key: 'thu', header: 'Thu', width: 6, note: 'Hours on Thursday.' },
  { key: 'fri', header: 'Fri', width: 6, note: 'Hours on Friday.' },
  { key: 'sat', header: 'Sat', width: 6, note: 'Hours on Saturday.' },
  { key: 'sun', header: 'Sun', width: 6, note: 'Hours on Sunday.' },
  { key: 'hoursPerWeek', header: 'Hours per week', width: 10, note: 'Weekly: the hours a week.' },
  { key: 'hoursPerMonth', header: 'Hours per month', width: 10, note: 'Monthly: the hours a month.' },
  { key: 'projectHours', header: 'Project hours', width: 10, note: 'Project-based: the total hours.' },
  { key: 'additionalHours', header: 'Additional hours', width: 16, note: 'Optional, e.g. 1H Sat or Sun.' },
  { key: 'targetStartDate', header: 'Target start date', width: 14, note: 'YYYY-MM-DD or M/D/YYYY.' },
  { key: 'timeTracker', header: 'Time tracker', width: 10, note: 'Yes or No: will the VA work with a time tracker.' },
  { key: 'tasks', header: 'Tasks', width: 36, note: 'What the VA will do.' },
  { key: 'tools', header: 'Tools', width: 26, note: 'The tools the VA will use.' },
  { key: 'mustHaves', header: 'Must-haves or deal breakers', width: 36, note: 'Optional.' },
] as const satisfies readonly SheetColumn<string>[]

export type SrImportKey = (typeof SR_IMPORT_COLUMNS)[number]['key']
export const SR_IMPORT_DATE_KEYS: readonly SrImportKey[] = ['targetStartDate']
export const SR_IMPORT_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const satisfies readonly SrImportKey[]

// The template's sample row: one VA on a daily, fixed-time shift with a
// half-day Saturday.
export const SR_IMPORT_SAMPLE: Partial<Record<SrImportKey, string>> = {
  ticketId: 'TKT-000101',
  subticketId: 'TKT-000101-01',
  accountId: SR_IMPORT_SAMPLE_ACCOUNT,
  requestType: 'New',
  requestGroup: 'Standard',
  department: '',
  service: 'Amazon VA',
  phase: 'VA Assignment',
  timeZone: 'America/New_York',
  scheduleType: 'Regular',
  regularSchedule: 'Daily, fixed time',
  startTime: '9:00 AM',
  endTime: '5:00 PM',
  sat: '4',
  targetStartDate: '2026-12-01',
  timeTracker: 'Yes',
  tasks: 'Inventory updates, listing optimization, customer messages',
  tools: 'Seller Central, Helium 10, Google Sheets',
  mustHaves: 'Amazon FBA experience; available on US Eastern mornings',
}

// ── Service mappings ─────────────────────────────────────────────

// A service name from another system (e.g. "Amazon VA") and what it
// imports as: one of the services, and optionally the department (blank =
// the service's own). Kept in app_settings for every later import.
export type ServiceMapping = { from: string; service: string; departmentId: string | null }
export const SERVICE_MAP_KEY = 'service-request-import-services'
export const mappingKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

// A service name in a file that isn't a service or a saved mapping yet.
export type UnmappedService = { value: string; rows: number[] }

// What the import page shows after a check: the rows, and the service names
// to map first.
export type SrImportCheck = {
  fileName: string
  rows: {
    row: number
    action: 'create' | 'skip' | 'problem'
    account: string
    customer: string | null
    detail: string | null
    messages: string[]
  }[]
  counts: { create: number; skip: number; problem: number; tickets: number }
  unmapped: UnmappedService[]
}
