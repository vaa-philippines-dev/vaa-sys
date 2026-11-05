// Client-safe: the Customers import template's columns (asked for on Nov 5,
// 2026). The template and the rules are in lib/customer-import.ts; the
// preview uses the Leads import's shapes (lib/lead-import-fields.ts).

export const CUSTOMER_IMPORT_COLUMNS = [
  { key: 'customerId', header: 'Customer ID', width: 20, note: 'Leave blank to add a new customer. Fill in a CUST_… ID to update that customer.' },
  { key: 'name', header: 'Customer name', width: 28, note: 'Required for a new customer. When updating, blank keeps the current name.' },
  { key: 'email', header: 'Email', width: 30, note: 'Optional. When updating, blank keeps the current email.' },
  {
    key: 'status',
    header: 'Status',
    width: 16,
    note: 'Pick from the list. Required for a new customer; when updating, blank keeps the current status. Leads (Pending) go through Lead Management’s import instead.',
  },
  { key: 'statusSince', header: 'Status since', width: 14, note: 'When the status took effect (YYYY-MM-DD). Blank: the import date.' },
  { key: 'statusReason', header: 'Status reason', width: 34, note: 'Required for Paused, Cancelled and Terminated, as on the status form.' },
  { key: 'terminationReason', header: 'Termination reason', width: 28, note: 'Optional, for Cancelled and Terminated. Pick from the list (Settings → Termination reasons).' },
  { key: 'csSpecialist', header: 'CS Specialist', width: 30, note: 'Optional. Pick the CS Specialist or CS Manager who owns the customer.' },
  { key: 'firstPaymentOn', header: 'First payment on', width: 16, note: 'Optional (YYYY-MM-DD). Blank: no payment yet for a new customer, unchanged when updating.' },
  { key: 'dateAdded', header: 'Date added', width: 14, note: 'New customers only, for older records (YYYY-MM-DD). Blank: today.' },
  { key: 'notes', header: 'Notes', width: 40, note: 'Optional. When updating, a filled-in cell replaces the customer’s notes; blank keeps them.' },
] as const

export type CustomerImportKey = (typeof CUSTOMER_IMPORT_COLUMNS)[number]['key']

export const CUSTOMER_IMPORT_MAX_ROWS = 500
export const CUSTOMER_IMPORT_MAX_BYTES = 900 * 1024
