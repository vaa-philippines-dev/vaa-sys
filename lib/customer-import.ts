import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { fieldChanges, logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'
import { findCustomerMatches, generateCustomerCode } from '@/lib/customers'
import { REASON_REQUIRED, STATUS_LABELS, dateOnly, isTerminal, manilaStartOf, manilaToday, type CustomerStatus } from '@/lib/customer-fields'
import { buildTemplate, emailFromLabel, parseDay, readSheet, teamLabel, type ReadRow } from '@/lib/import-sheet'
import { CUSTOMER_IMPORT_COLUMNS, CUSTOMER_IMPORT_MAX_BYTES, CUSTOMER_IMPORT_MAX_ROWS, type CustomerImportKey } from '@/lib/customer-import-fields'
import type { ImportAction, ImportPreview, ImportRowResult } from '@/lib/lead-import-fields'
import { listCsTeam } from '@/lib/specialists'
import { StatusError, changeCustomerStatus } from '@/lib/status'

// Server-only: the Customers import (Customer Management, admins only; asked
// for on Nov 5, 2026). The same flow as the Leads import (lib/lead-import.ts):
// download the Excel template, whose Status, Termination reason and CS
// Specialist columns are dropdowns of what's in the system, fill it in and
// upload it. A row without a Customer ID adds a customer; a row with one
// updates that customer.
//
// Statuses follow the status form's rules:
// - A new customer is created in its status, with a status log row saying
//   so (backdated with Status since).
// - A changed status on an existing customer goes through lib/status.ts like
//   any other change, so its accounts follow (Paused, Cancelled, Terminated)
//   and the status log and activity log are written the same way.
// - Pending is a lead's status, so leads stay with Lead Management's import:
//   a new row can't be Pending, and a lead's status isn't changed here.
//
// Uploads are checked twice, once for the preview and again from the same
// file on import; the second pass saves everything in one transaction or
// nothing.

type Tx = Prisma.TransactionClient
type Row = ReadRow<CustomerImportKey>

const DATE_KEYS = ['statusSince', 'firstPaymentOn', 'dateAdded'] as const satisfies readonly CustomerImportKey[]
const HEADER_OF = Object.fromEntries(CUSTOMER_IMPORT_COLUMNS.map((c) => [c.key, c.header])) as Record<CustomerImportKey, string>
const IMPORT_STATUSES: CustomerStatus[] = ['ACTIVE', 'PAUSED', 'INACTIVE', 'CANCELLED', 'TERMINATED']
const STATUS_BY_TEXT = new Map<string, CustomerStatus>(
  (Object.keys(STATUS_LABELS) as CustomerStatus[]).flatMap((s) => [[STATUS_LABELS[s].toLowerCase(), s] as const, [s.toLowerCase(), s] as const])
)

async function importLists() {
  const [team, reasons] = await Promise.all([
    listCsTeam(),
    prisma.settingOption.findMany({ where: { category: 'TerminationReason', isActive: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: { id: true, label: true, value: true } }),
  ])
  return { team, reasons }
}

// ── Template ──────────────────────────────────────────────────────

export async function buildCustomerTemplate(): Promise<Buffer> {
  const { team, reasons } = await importLists()
  return buildTemplate({
    sheet: 'Customers',
    columns: CUSTOMER_IMPORT_COLUMNS,
    lists: [
      { key: 'status', title: 'Status', values: IMPORT_STATUSES.map((s) => STATUS_LABELS[s]) },
      { key: 'terminationReason', title: 'Termination reason', values: reasons.map((r) => r.label) },
      { key: 'csSpecialist', title: 'CS Specialist', values: team.map(teamLabel) },
    ],
    dateKeys: DATE_KEYS,
    maxRows: CUSTOMER_IMPORT_MAX_ROWS,
    help: [
      'VAA Systems: Customers import template',
      '',
      'Fill in one row per customer on the Customers sheet, then upload the file on Customer Management → Customers → Import. You see a preview before anything is saved.',
      'No Customer ID: a new customer is added, with a generated Customer ID. With a Customer ID: that customer is updated, and blank cells keep what it has.',
      'Put each customer on one row: the same Customer ID or new-customer name on two rows is an error.',
      'Status is Active, Paused, Inactive, Cancelled or Terminated. Paused, Cancelled and Terminated need a Status reason, as on the status form.',
      'Changing an existing customer’s status works like the status form: Paused pauses its Active accounts, and Cancelled or Terminated applies to its accounts too.',
      'Leads (Pending, still in Lead Management) are imported with Lead Management → Import instead, and their status isn’t changed here.',
      'Dates are Philippine calendar days (YYYY-MM-DD) and can’t be in the future. Up to 500 rows per file.',
      'A new customer whose name is already in vaa-sys or the legacy CMS is skipped; put its Customer ID to update it instead.',
    ],
  })
}

export async function readCustomerFile(file: File): Promise<{ rows: Row[] } | { error: string }> {
  return readSheet(file, {
    sheet: 'Customers',
    columns: CUSTOMER_IMPORT_COLUMNS,
    dateKeys: DATE_KEYS,
    required: ['name', 'status'],
    maxRows: CUSTOMER_IMPORT_MAX_ROWS,
    maxBytes: CUSTOMER_IMPORT_MAX_BYTES,
  })
}

// ── Checking rows ─────────────────────────────────────────────────

async function loadExisting(codes: string[]) {
  if (codes.length === 0) return []
  return prisma.customer.findMany({
    where: { customerCode: { in: codes } },
    select: {
      id: true,
      customerCode: true,
      name: true,
      email: true,
      status: true,
      notes: true,
      assignedSpecialistEmail: true,
      paymentDate: true,
      noPaymentYet: true,
      reviewAction: true,
      leadPhase: true,
      createdAt: true,
    },
  })
}
type Existing = Awaited<ReturnType<typeof loadExisting>>[number]

type RowPlan = {
  result: ImportRowResult
  kind: ImportAction
  existing: Existing | null
  name: string | null
  email: string | null
  notes: string | null
  csSpecialist: string | null
  firstPayment: string | null
  dateAdded: string | null
  // A new customer's status, or an existing customer's status change.
  status: CustomerStatus | null
  statusSince: string | null
  statusReason: string
  terminationReasonId: string | null
}

export async function planCustomerImport(rows: Row[], now = new Date()): Promise<RowPlan[]> {
  const today = manilaToday(now)
  const codes = [...new Set(rows.map((r) => r.values.customerId.trim().toUpperCase()).filter(Boolean))]
  const [{ team, reasons }, existingRows] = await Promise.all([importLists(), loadExisting(codes)])
  const byCode = new Map(existingRows.map((c) => [c.customerCode.toUpperCase(), c]))
  const teamEmails = new Set(team.map((m) => m.email.toLowerCase()))
  const reasonByText = new Map(reasons.flatMap((r) => [[r.label.toLowerCase(), r.id] as const, [r.value.toLowerCase(), r.id] as const]))
  const namesInFile = new Map<string, number>()
  const codesInFile = new Map<string, number>()
  const lookups: { index: number; name: string; key: string }[] = []

  const plans: RowPlan[] = []
  for (const { row, values: v } of rows) {
    const errors: string[] = []
    const notes: string[] = []

    const code = v.customerId.trim().toUpperCase()
    const existing = code ? (byCode.get(code) ?? null) : null
    if (code && !existing) errors.push(`No customer has the ID ${code}.`)
    if (code) {
      const first = codesInFile.get(code)
      if (first) errors.push(`This Customer ID is already on row ${first} of this file. Put all the changes for a customer on one row.`)
      else codesInFile.set(code, row)
    }
    const isNew = !code
    // Still in Lead Management: Pending and not yet onboarded.
    const isLead = !!existing && existing.status === 'PENDING' && existing.leadPhase !== 'NEW_CUSTOMER_ONBOARDED'

    const name = v.name.trim() || null
    if (isNew && !name) errors.push('Customer name is required for a new customer.')
    if (name && name.length > 200) errors.push('Customer name is longer than 200 characters.')

    const email = v.email.trim().toLowerCase() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`“${v.email}” isn’t an email address.`)

    const notesText = v.notes.trim() || null
    if (notesText && notesText.length > 2000) errors.push('Notes are longer than 2,000 characters.')

    const days = Object.fromEntries(DATE_KEYS.map((k) => [k, parseDay(v[k])])) as Record<(typeof DATE_KEYS)[number], string | null | 'bad'>
    for (const k of DATE_KEYS) {
      const d = days[k]
      if (d === 'bad') errors.push(`${HEADER_OF[k]} “${v[k]}” isn’t a date (use YYYY-MM-DD).`)
      else if (d && d > today) errors.push(`${HEADER_OF[k]} can’t be in the future.`)
    }
    const day = (k: (typeof DATE_KEYS)[number]) => {
      const d = days[k]
      return d && d !== 'bad' ? d : null
    }
    if (!isNew && v.dateAdded) errors.push('Date added is only for new customers.')

    let csSpecialist: string | null = null
    if (v.csSpecialist) {
      csSpecialist = emailFromLabel(v.csSpecialist)
      if (!teamEmails.has(csSpecialist)) errors.push(`${v.csSpecialist} isn’t an active CS Specialist or CS Manager.`)
    }

    // Status: a new customer's, or a change to an existing one.
    const given = v.status ? (STATUS_BY_TEXT.get(v.status.trim().toLowerCase()) ?? null) : null
    if (v.status && !given) errors.push(`Status “${v.status}” isn’t one of: ${IMPORT_STATUSES.map((s) => STATUS_LABELS[s]).join(', ')}.`)
    if (isNew && !v.status) errors.push('Status is required for a new customer.')
    if (given === 'PENDING') errors.push('Pending is a lead’s status. Add leads with Lead Management → Import.')

    let status: CustomerStatus | null = null
    if (given && given !== 'PENDING') {
      if (isNew) status = given
      else if (existing && given !== existing.status) {
        if (isLead) errors.push('This record is still a lead in Lead Management, so its status changes there.')
        else if (existing.reviewAction) errors.push('This customer has a status change waiting for a CS Manager’s review. Confirm or cancel it on the Approvals page first.')
        else status = given
      } else if (existing) notes.push(`Already ${STATUS_LABELS[given]}.`)
    }
    if ((day('statusSince') || v.statusReason.trim() || v.terminationReason) && !status && !errors.length && !isNew)
      notes.push('The status doesn’t change, so Status since, Status reason and Termination reason are left out.')

    const statusReason = v.statusReason.trim()
    if (statusReason.length > 1000) errors.push('Status reason is longer than 1,000 characters.')
    if (status && REASON_REQUIRED.includes(status) && !statusReason) errors.push(`Give a Status reason for ${STATUS_LABELS[status]}.`)

    let terminationReasonId: string | null = null
    if (v.terminationReason) {
      terminationReasonId = reasonByText.get(v.terminationReason.trim().toLowerCase()) ?? null
      if (!terminationReasonId) errors.push(`Termination reason “${v.terminationReason}” isn’t on the list in Settings.`)
      else if (status && !isTerminal(status)) errors.push('A Termination reason is only for Cancelled or Terminated.')
    }

    const statusSince = day('statusSince')
    if (isNew && statusSince && day('dateAdded') && statusSince < day('dateAdded')!) errors.push('Status since can’t be before Date added.')
    if (status && existing) {
      if (isTerminal(existing.status) && !isTerminal(status)) notes.push('Reactivates the customer. Its terminated or cancelled accounts stay as they are; reactivate them on each account’s page.')
      else if (status === 'PAUSED') notes.push('Its Active accounts are paused too.')
      else if (isTerminal(status)) notes.push(`Its accounts are ${STATUS_LABELS[status].toLowerCase()} too.`)
    }

    let kind: ImportAction = errors.length ? 'error' : isNew ? 'create' : 'update'
    if (isNew && name) {
      const key = name.toLowerCase()
      const first = namesInFile.get(key)
      if (first) {
        errors.push(`The same name is already on row ${first} of this file.`)
        kind = 'error'
      } else namesInFile.set(key, row)
      // Checked against vaa-sys and the legacy CMS after the loop, many at once.
      if (kind === 'create') lookups.push({ index: plans.length, name, key })
    }
    if (kind === 'update') notes.unshift(`Updates ${existing!.name}.`)

    plans.push({
      kind,
      existing,
      name,
      email,
      notes: notesText,
      csSpecialist,
      firstPayment: day('firstPaymentOn'),
      dateAdded: day('dateAdded'),
      status,
      statusSince,
      statusReason,
      terminationReasonId: status && isTerminal(status) ? terminationReasonId : null,
      result: {
        row,
        action: kind,
        name: name ?? existing?.name ?? '',
        customerCode: existing?.customerCode ?? null,
        detail: status ? (existing ? `${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[status]}` : STATUS_LABELS[status]) : null,
        messages: [...errors, ...notes],
      },
    })
  }

  // A new customer mustn't already exist, here or in the legacy CMS. The
  // lookups run ten at a time rather than one row after another, so a
  // 500-row file stays quick (review on PR #7).
  for (let i = 0; i < lookups.length; i += 10) {
    const batch = lookups.slice(i, i + 10)
    const found = await Promise.all(batch.map((l) => findCustomerMatches(l.name)))
    batch.forEach((l, j) => {
      const plan = plans[l.index]
      const matches = found[j]
      const exact = matches.find((m) => m.name.trim().toLowerCase() === l.key)
      if (exact) {
        plan.kind = 'skip'
        plan.result.action = 'skip'
        plan.result.messages.push(
          exact.source === 'vaa_sys'
            ? `Already in vaa-sys as ${exact.code}. Put that Customer ID in the row to update it.`
            : `Already in the legacy CMS as ${exact.code ?? 'a customer'}; not added.`
        )
      } else if (matches.length) plan.result.messages.push(`Similar names: ${matches.map((m) => m.name).join(', ')}.`)
    })
  }
  return plans
}

export function customerPreviewOf(fileName: string, plans: RowPlan[]): ImportPreview {
  const counts: Record<ImportAction, number> = { create: 0, update: 0, skip: 0, error: 0 }
  for (const p of plans) counts[p.kind]++
  return { fileName, rows: plans.map((p) => p.result), counts }
}

// ── Saving ────────────────────────────────────────────────────────

async function createCustomer(tx: Tx, actor: Actor, p: RowPlan, code: string, source: string, now: Date) {
  const createdAt = p.dateAdded ? manilaStartOf(p.dateAdded) : now
  const since = p.statusSince ? manilaStartOf(p.statusSince) : createdAt
  const status = p.status!
  const customer = await tx.customer.create({
    data: {
      customerCode: code,
      name: p.name!,
      email: p.email,
      notes: p.notes,
      status,
      statusChangedAt: since,
      assignedSpecialistEmail: p.csSpecialist,
      ...(p.firstPayment ? { paymentDate: dateOnly(p.firstPayment), noPaymentYet: false } : {}),
      // Created already terminated or cancelled counts as its one termination.
      ...(isTerminal(status) ? { terminationCount: 1 } : {}),
      createdById: actor.id,
      createdByEmail: actor.email.toLowerCase(),
      createdAt,
      statusLogs: {
        create: {
          fromStatus: null,
          toStatus: status,
          reason: p.statusReason || null,
          terminationReasonId: p.terminationReasonId,
          effectiveDate: since.getTime() === now.getTime() ? null : since,
          changedById: actor.id,
          changedByEmail: actor.email.toLowerCase(),
          changedAt: now,
        },
      },
    },
    select: { id: true },
  })
  await logActivity(tx, actor, { entityType: 'Customer', entityId: customer.id, entityLabel: p.name, customerId: customer.id, action: 'CREATE', newValue: `${p.name} (${STATUS_LABELS[status]})`, notes: source })
}

async function updateCustomer(tx: Tx, actor: Actor, p: RowPlan, source: string, now: Date) {
  const e = p.existing!
  const after = {
    name: p.name ?? e.name,
    email: p.email ?? e.email,
    notes: p.notes ?? e.notes,
    assignedSpecialistEmail: p.csSpecialist ?? e.assignedSpecialistEmail,
    paymentDate: p.firstPayment ? dateOnly(p.firstPayment) : e.paymentDate,
    noPaymentYet: p.firstPayment ? false : e.noPaymentYet,
  }
  const before = { name: e.name, email: e.email, notes: e.notes, assignedSpecialistEmail: e.assignedSpecialistEmail, paymentDate: e.paymentDate, noPaymentYet: e.noPaymentYet }
  const changes = fieldChanges({ entityType: 'Customer', entityId: e.id, entityLabel: e.name, customerId: e.id, notes: source }, before, after)
  if (changes.length) {
    await tx.customer.update({ where: { id: e.id }, data: after })
    await logActivity(tx, actor, changes)
  }
  if (p.status) {
    await changeCustomerStatus(
      tx,
      actor,
      e.id,
      { status: p.status, reason: p.statusReason ? `${p.statusReason} (${source})` : source, effectiveDate: p.statusSince ?? '', terminationReasonId: p.terminationReasonId ?? '', reactivateAccountIds: [] },
      now
    )
  }
}

// Saves every create and update row, or nothing. Rows with errors stop the
// whole import; skipped rows are left out.
export async function applyCustomerImport(plans: RowPlan[], actor: Actor, fileName: string, now = new Date()): Promise<{ created: number; updated: number; skipped: number } | { error: string }> {
  if (plans.some((p) => p.kind === 'error')) return { error: 'Some rows have problems. Fix them first.' }
  const creates = plans.filter((p) => p.kind === 'create')
  const updates = plans.filter((p) => p.kind === 'update')
  const codes: string[] = []
  for (let i = 0; i < creates.length; i++) {
    let code = await generateCustomerCode()
    while (codes.includes(code)) code = await generateCustomerCode()
    codes.push(code)
  }
  const source = `Imported from ${fileName}`

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const [i, p] of creates.entries()) await createCustomer(tx, actor, p, codes[i], source, now)
        for (const p of updates) await updateCustomer(tx, actor, p, source, now)
      },
      { maxWait: 10_000, timeout: 120_000 }
    )
  } catch (err) {
    // A status rule the preview couldn't see (lib/status.ts): nothing saved.
    if (err instanceof StatusError) return { error: `Nothing was imported: ${err.message}` }
    throw err
  }
  return { created: creates.length, updated: updates.length, skipped: plans.filter((p) => p.kind === 'skip').length }
}
