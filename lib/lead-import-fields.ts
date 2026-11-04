// Client-safe: the Leads import template's columns and what an upload's
// preview reports. The template and the rules are in lib/lead-import.ts.

export const IMPORT_COLUMNS = [
  { key: 'customerId', header: 'Customer ID', width: 20, note: 'Leave blank to add a new lead. Fill in a CUST_… ID to update that lead.' },
  { key: 'name', header: 'Customer name', width: 28, note: 'Required for a new lead. When updating, blank keeps the current name.' },
  { key: 'email', header: 'Email', width: 30, note: 'Optional. When updating, blank keeps the current email.' },
  { key: 'phase', header: 'Phase', width: 32, note: 'Pick from the list. Required for a new lead; when updating, blank keeps the current phase.' },
  { key: 'requestType', header: 'Request type', width: 18, note: 'Regular Request or Special Request. Blank: Regular for a new lead, unchanged when updating.' },
  { key: 'dateAdded', header: 'Date added', width: 14, note: 'New leads only, for older records (YYYY-MM-DD). Blank: today.' },
  { key: 'csSpecialist', header: 'CS Specialist', width: 30, note: 'Optional. Pick the CS Specialist or CS Manager who owns the customer.' },
  { key: 'contract', header: 'Contract', width: 34, note: 'Optional. Pick the contract that applies (from Contracts).' },
  { key: 'contractSentOn', header: 'Contract sent on', width: 16, note: 'From Contract & Payment Confirmation on (any time for a Special Request). Blank: the import date.' },
  { key: 'contractSignedOn', header: 'Contract signed on', width: 18, note: 'Once the contract and payment are confirmed. Blank: the import date.' },
  { key: 'firstPaymentOn', header: 'First payment on', width: 16, note: 'Once the contract and payment are confirmed. Blank: the import date.' },
  { key: 'handoffDoneOn', header: 'Handoff done on', width: 16, note: 'Once the CS team has onboarded the customer. Blank: the import date.' },
] as const

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]['key']
export type ImportRow = Record<ImportColumnKey, string>

export const IMPORT_MAX_ROWS = 500
export const IMPORT_MAX_BYTES = 900 * 1024

export type ImportAction = 'create' | 'update' | 'skip' | 'error'

// One row of the upload, as the preview shows it.
export type ImportRowResult = {
  row: number
  action: ImportAction
  name: string
  customerCode: string | null
  phase: string | null
  messages: string[]
}

export type ImportPreview = {
  fileName: string
  rows: ImportRowResult[]
  counts: Record<ImportAction, number>
}
