import ExcelJS from 'exceljs'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { fieldChanges, logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'
import { findCustomerMatches, generateCustomerCode } from '@/lib/customers'
import { dateOnly, dayString, manilaStartOf, manilaToday } from '@/lib/customer-fields'
import { syncLeadPhase } from '@/lib/lead-phase'
import { LEAD_PHASES, PHASE_LABELS, REQUEST_TYPES, REQUEST_TYPE_LABELS, leadPhaseFor, type LeadPhase, type LeadRequestType } from '@/lib/lead-phase-fields'
import {
  IMPORT_COLUMNS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type ImportAction,
  type ImportColumnKey,
  type ImportPreview,
  type ImportRow,
  type ImportRowResult,
} from '@/lib/lead-import-fields'
import { listCsTeam } from '@/lib/specialists'

// Server-only: the Leads import (Nov 4, 2026). Admins download an Excel
// template whose Phase, Request type, CS Specialist and Contract columns are
// dropdowns of what is in the system, fill it in, and upload it (or a CSV
// saved from it). Each row adds a new lead (no Customer ID) or updates the
// lead with that ID.
//
// The phase is never stored as given: a lead's phase is what its facts add
// up to (lib/lead-phase-fields.ts). So the import sets the facts the chosen
// phase needs (Customer Intake done, contract sent, contract and payment
// confirmed, handoff done), with the dates in the row or the import date,
// clears the ones it doesn't, and lets syncLeadPhase move and log the phase.
// A fact the phase hasn't reached yet can't have a date.
//
// Uploads are checked twice: once for the preview, then again, from the same
// file, when the admin confirms; the second pass saves everything in one
// transaction or nothing.

type Tx = Prisma.TransactionClient

const DATE_COLUMNS: ImportColumnKey[] = ['dateAdded', 'contractSentOn', 'contractSignedOn', 'firstPaymentOn', 'handoffDoneOn']
const HEADER_OF = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.header])) as Record<ImportColumnKey, string>

// ── Dropdown lists ────────────────────────────────────────────────

async function importLists() {
  const [contracts, team] = await Promise.all([
    prisma.contract.findMany({ where: { isActive: true }, orderBy: { contractCode: 'asc' }, select: { id: true, contractCode: true, name: true } }),
    listCsTeam(),
  ])
  return { contracts, team }
}

const contractLabel = (c: { contractCode: string; name: string }) => `${c.contractCode} · ${c.name}`
const teamLabel = (m: { name: string; email: string }) => (m.name && m.name !== m.email ? `${m.name} <${m.email}>` : m.email)

// ── Template ──────────────────────────────────────────────────────

export async function buildImportTemplate(): Promise<Buffer> {
  const { contracts, team } = await importLists()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'vaa-sys'
  wb.created = new Date()

  const ws = wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }))
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDE7' } }
  IMPORT_COLUMNS.forEach((c, i) => {
    header.getCell(i + 1).note = c.note
  })

  // The lists the dropdowns read, on a hidden sheet.
  const lists = wb.addWorksheet('Lists', { state: 'hidden' })
  const listColumns: { key: ImportColumnKey; title: string; values: string[] }[] = [
    { key: 'phase', title: 'Phase', values: LEAD_PHASES.map((p) => PHASE_LABELS[p]) },
    { key: 'requestType', title: 'Request type', values: REQUEST_TYPES.map((t) => REQUEST_TYPE_LABELS[t]) },
    { key: 'csSpecialist', title: 'CS Specialist', values: team.map(teamLabel) },
    { key: 'contract', title: 'Contract', values: contracts.map(contractLabel) },
  ]
  listColumns.forEach((l, i) => {
    const col = i + 1
    lists.getCell(1, col).value = l.title
    l.values.forEach((v, j) => (lists.getCell(j + 2, col).value = v))
  })

  for (const [i, l] of listColumns.entries()) {
    if (l.values.length === 0) continue
    const letter = String.fromCharCode(65 + i)
    const range = `Lists!$${letter}$2:$${letter}$${l.values.length + 1}`
    const col = IMPORT_COLUMNS.findIndex((c) => c.key === l.key) + 1
    for (let r = 2; r <= IMPORT_MAX_ROWS + 1; r++) {
      ws.getCell(r, col).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [range],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: `Pick a ${l.title.toLowerCase()}`,
        error: `Choose a ${l.title.toLowerCase()} from the list.`,
      }
    }
  }
  for (const key of DATE_COLUMNS) {
    ws.getColumn(key).numFmt = 'yyyy-mm-dd'
  }

  const help = wb.addWorksheet('How to use')
  help.getColumn(1).width = 110
  ;[
    'VAA Systems: Leads import template',
    '',
    'Fill in one row per lead on the Leads sheet, then upload the file on Lead Management → Import. You see a preview before anything is saved.',
    'No Customer ID: a new lead is added, with a generated Customer ID. With a Customer ID: that lead is updated, and blank cells keep what it has.',
    'Put each lead on one row: the same Customer ID or new-lead name on two rows is an error.',
    'Phase is a dropdown of the phases in the system. The import records the steps that phase needs (contract sent, contract and payment confirmed,',
    'handoff done) with the dates in the row, or the import date when a date is blank. A step the phase hasn\'t reached can\'t have a date.',
    'A Special Request skips Contract & Billing Initiation: it goes to Customer Success Handoff, then Contract & Payment Confirmation.',
    'Dates are Philippine calendar days (YYYY-MM-DD) and can\'t be in the future. Up to 500 rows per file.',
    'A new lead whose name is already in vaa-sys or the legacy CMS is skipped; put its Customer ID to update it instead.',
    '',
    'Columns:',
    ...IMPORT_COLUMNS.map((c) => `• ${c.header}: ${c.note}`),
  ].forEach((line, i) => (help.getCell(i + 1, 1).value = line))
  help.getRow(1).font = { bold: true, size: 13 }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ── Reading an upload ─────────────────────────────────────────────

type ReadRow = { row: number; values: ImportRow }

function headerKey(text: string): ImportColumnKey | null {
  const t = text.trim().toLowerCase().replace(/\s*\*$/, '')
  return IMPORT_COLUMNS.find((c) => c.header.toLowerCase() === t || c.key.toLowerCase() === t)?.key ?? null
}

// Excel stores dates as day counts from 1899-12-30.
function excelSerialDay(n: number) {
  return dayString(new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000))
}

function cellString(cell: ExcelJS.Cell, isDate: boolean): string {
  const v = cell.value
  if (v instanceof Date) return dayString(v)
  if (isDate && typeof v === 'number') return excelSerialDay(v)
  if (v && typeof v === 'object' && 'result' in v) {
    const r = (v as { result?: unknown }).result
    if (r instanceof Date) return dayString(r)
    if (isDate && typeof r === 'number') return excelSerialDay(r)
  }
  return (cell.text ?? '').trim()
}

// RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function toRows(headers: (ImportColumnKey | null)[], data: { row: number; cells: string[] }[]): ReadRow[] {
  return data
    .map(({ row, cells }) => {
      const values = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, ''])) as ImportRow
      headers.forEach((key, i) => {
        if (key) values[key] = (cells[i] ?? '').trim()
      })
      return { row, values }
    })
    .filter((r) => Object.values(r.values).some((v) => v !== ''))
}

export async function readImportFile(file: File): Promise<{ rows: ReadRow[] } | { error: string }> {
  if (file.size === 0) return { error: 'The file is empty.' }
  if (file.size > IMPORT_MAX_BYTES) return { error: 'The file is too big. Split it into files of up to 500 rows.' }
  const name = file.name.toLowerCase()

  let headers: (ImportColumnKey | null)[]
  let data: { row: number; cells: string[] }[]
  if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(await file.arrayBuffer())
    } catch {
      return { error: 'That file couldn’t be read as an Excel workbook.' }
    }
    const ws = wb.getWorksheet('Leads') ?? wb.worksheets[0]
    if (!ws) return { error: 'The workbook has no sheets.' }
    const head = ws.getRow(1)
    headers = Array.from({ length: Math.max(head.cellCount, IMPORT_COLUMNS.length) }, (_, i) => headerKey(head.getCell(i + 1).text ?? ''))
    data = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      data.push({ row: r, cells: headers.map((key, i) => cellString(row.getCell(i + 1), !!key && DATE_COLUMNS.includes(key))) })
    }
  } else if (name.endsWith('.csv')) {
    const table = parseCsv(await file.text())
    if (table.length === 0) return { error: 'The file is empty.' }
    headers = table[0].map(headerKey)
    data = table.slice(1).map((cells, i) => ({ row: i + 2, cells }))
  } else {
    return { error: 'Upload the Excel template (.xlsx) or a CSV saved from it.' }
  }

  for (const required of ['name', 'phase'] as const) {
    if (!headers.includes(required)) return { error: `The “${HEADER_OF[required]}” column is missing. Start from the downloaded template.` }
  }
  const rows = toRows(headers, data)
  if (rows.length === 0) return { error: 'The file has no rows to import.' }
  if (rows.length > IMPORT_MAX_ROWS) return { error: `The file has ${rows.length} rows; the most is ${IMPORT_MAX_ROWS}. Split it into smaller files.` }
  return { rows }
}

// ── Checking rows ─────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// '' → null; YYYY-MM-DD or M/D/YYYY → YYYY-MM-DD; anything else → 'bad'.
function parseDay(raw: string): string | null | 'bad' {
  const s = raw.trim()
  if (!s) return null
  let day = s
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (us) day = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  if (!DAY_RE.test(day) || dayString(dateOnly(day)) !== day) return 'bad'
  return day
}

const PHASE_BY_TEXT = new Map<string, LeadPhase>(LEAD_PHASES.flatMap((p) => [[PHASE_LABELS[p].toLowerCase(), p] as const, [p.toLowerCase(), p] as const]))
const TYPE_BY_TEXT = new Map<string, LeadRequestType>([
  ['regular request', 'REGULAR'],
  ['regular', 'REGULAR'],
  ['special request', 'SPECIAL'],
  ['special', 'SPECIAL'],
])

type Need = 'yes' | 'no' | 'optional'
type Steps = { intake: Need; sent: Need; confirmed: Need; handoff: Need }

// What each phase needs, in each order (lib/lead-phase-fields.ts).
function stepsFor(phase: LeadPhase, type: LeadRequestType): Steps | null {
  if (type === 'SPECIAL') {
    if (phase === 'CUSTOMER_INTAKE') return { intake: 'no', sent: 'no', confirmed: 'no', handoff: 'no' }
    if (phase === 'CONTRACT_BILLING_INITIATION') return null
    if (phase === 'CUSTOMER_SUCCESS_HANDOFF') return { intake: 'yes', sent: 'optional', confirmed: 'optional', handoff: 'no' }
    if (phase === 'CONTRACT_PAYMENT_CONFIRMATION') return { intake: 'yes', sent: 'optional', confirmed: 'no', handoff: 'yes' }
    return { intake: 'yes', sent: 'yes', confirmed: 'yes', handoff: 'yes' }
  }
  const order = LEAD_PHASES.indexOf(phase)
  const at = (i: number): Need => (order >= i ? 'yes' : 'no')
  return { intake: at(1), sent: at(2), confirmed: at(3), handoff: at(4) }
}

type Existing = Awaited<ReturnType<typeof loadExisting>>[number]

async function loadExisting(codes: string[]) {
  if (codes.length === 0) return []
  return prisma.customer.findMany({
    where: { customerCode: { in: codes } },
    select: {
      id: true,
      customerCode: true,
      name: true,
      email: true,
      requestType: true,
      assignedSpecialistEmail: true,
      intakeCompletedAt: true,
      contractId: true,
      contractSentAt: true,
      contractSentByEmail: true,
      contractSentId: true,
      contractSignedOn: true,
      contractConfirmedAt: true,
      contractConfirmedByEmail: true,
      paymentDate: true,
      noPaymentYet: true,
      handoffCompletedAt: true,
      handoffCompletedByEmail: true,
      _count: { select: { submissions: true } },
      submissions: { orderBy: { submittedAt: 'desc' }, take: 1, select: { account: { select: { id: true, name: true, accountCode: true, contractId: true } } } },
    },
  })
}

// The facts a row writes on the customer (lib/lead-phase.ts reads them).
type Facts = {
  intakeCompletedAt: Date | null
  contractSentAt: Date | null
  contractSentByEmail: string | null
  contractSentId: string | null
  contractSignedOn: Date | null
  contractConfirmedAt: Date | null
  contractConfirmedByEmail: string | null
  handoffCompletedAt: Date | null
  handoffCompletedByEmail: string | null
  paymentDate?: Date
  noPaymentYet?: boolean
}

type RowPlan = {
  result: ImportRowResult
  kind: ImportAction
  existing: Existing | null
  name: string | null
  email: string | null
  requestType: LeadRequestType | null
  dateAdded: string | null
  csSpecialist: string | null
  contractId: string | null
  facts: Facts | null
}

export async function planImport(rows: ReadRow[], actor: Actor, now = new Date()): Promise<RowPlan[]> {
  const today = manilaToday(now)
  const codes = [...new Set(rows.map((r) => r.values.customerId.trim().toUpperCase()).filter(Boolean))]
  const [{ contracts, team }, existingRows] = await Promise.all([importLists(), loadExisting(codes)])
  const byCode = new Map(existingRows.map((c) => [c.customerCode.toUpperCase(), c]))
  const teamEmails = new Set(team.map((m) => m.email.toLowerCase()))
  const contractByCode = new Map(contracts.map((c) => [c.contractCode.toUpperCase(), c]))
  const contractByName = new Map(contracts.map((c) => [c.name.toLowerCase(), c]))
  const namesInFile = new Map<string, number>()
  const codesInFile = new Map<string, number>()
  const me = actor.email.toLowerCase()

  const plans: RowPlan[] = []
  for (const { row, values: v } of rows) {
    const errors: string[] = []
    const notes: string[] = []

    const code = v.customerId.trim().toUpperCase()
    const existing = code ? (byCode.get(code) ?? null) : null
    if (code && !existing) errors.push(`No customer has the ID ${code}.`)
    // Every row is checked against the lead as it is now, so a second row for
    // the same lead would be applied on top of the first from stale facts.
    if (code) {
      const first = codesInFile.get(code)
      if (first) errors.push(`This Customer ID is already on row ${first} of this file. Put all the changes for a lead on one row.`)
      else codesInFile.set(code, row)
    }
    const isNew = !code

    const name = v.name.trim() || null
    if (isNew && !name) errors.push('Customer name is required for a new lead.')
    if (name && name.length > 200) errors.push('Customer name is longer than 200 characters.')

    const email = v.email.trim().toLowerCase() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`“${v.email}” isn’t an email address.`)

    const phase = v.phase ? (PHASE_BY_TEXT.get(v.phase.trim().toLowerCase()) ?? null) : null
    if (v.phase && !phase) errors.push(`Phase “${v.phase}” isn’t one of: ${LEAD_PHASES.map((p) => PHASE_LABELS[p]).join(', ')}.`)
    if (isNew && !v.phase) errors.push('Phase is required for a new lead.')

    const requestType = v.requestType ? (TYPE_BY_TEXT.get(v.requestType.trim().toLowerCase()) ?? null) : null
    if (v.requestType && !requestType) errors.push(`Request type “${v.requestType}” isn’t Regular Request or Special Request.`)

    const days = Object.fromEntries(DATE_COLUMNS.map((k) => [k, parseDay(v[k])])) as Record<(typeof DATE_COLUMNS)[number], string | null | 'bad'>
    for (const k of DATE_COLUMNS) {
      const d = days[k]
      if (d === 'bad') errors.push(`${HEADER_OF[k]} “${v[k]}” isn’t a date (use YYYY-MM-DD).`)
      else if (d && d > today) errors.push(`${HEADER_OF[k]} can’t be in the future.`)
    }
    const day = (k: (typeof DATE_COLUMNS)[number]) => {
      const d = days[k]
      return d && d !== 'bad' ? d : null
    }
    if (!isNew && v.dateAdded) errors.push('Date added is only for new leads.')

    let csSpecialist: string | null = null
    if (v.csSpecialist) {
      const found = /<([^>]+)>/.exec(v.csSpecialist)?.[1] ?? v.csSpecialist
      csSpecialist = found.trim().toLowerCase()
      if (!teamEmails.has(csSpecialist)) errors.push(`${v.csSpecialist} isn’t an active CS Specialist or CS Manager.`)
    }

    let contractId: string | null = null
    if (v.contract) {
      const byCodeMatch = /CON-\d+/i.exec(v.contract)?.[0]
      const contract = (byCodeMatch && contractByCode.get(byCodeMatch.toUpperCase())) || contractByName.get(v.contract.trim().toLowerCase())
      if (contract) contractId = contract.id
      else errors.push(`Contract “${v.contract}” isn’t an active contract.`)
    }

    // The phase, as the facts that make it.
    let facts: Facts | null = null
    const stepDates = (['contractSentOn', 'contractSignedOn', 'firstPaymentOn', 'handoffDoneOn'] as const).filter((k) => v[k])
    if (!phase && stepDates.length && v.phase === '') errors.push('Fill in Phase when giving step dates.')
    const hasForm = (existing?._count.submissions ?? 0) > 0
    if (phase) {
      const type = requestType ?? existing?.requestType ?? 'REGULAR'
      const steps = stepsFor(phase, type)
      if (!steps) errors.push('A Special Request skips Contract & Billing Initiation. Pick Customer Success Handoff, or make it a Regular Request.')
      else if (phase === 'CUSTOMER_INTAKE' && hasForm) errors.push('This lead has submitted the onboarding form, so it can’t be back in Customer Intake.')
      else {
        const given = {
          sent: !!day('contractSentOn'),
          confirmed: !!(day('contractSignedOn') || day('firstPaymentOn')),
          handoff: !!day('handoffDoneOn'),
        }
        const decide = (need: Need, isGiven: boolean, label: string) => {
          if (need === 'no' && isGiven) errors.push(`${label} is filled in, but a lead in ${PHASE_LABELS[phase]} hasn’t reached that step.`)
          return need === 'yes' || (need === 'optional' && isGiven)
        }
        const handoff = decide(steps.handoff, given.handoff, HEADER_OF.handoffDoneOn)
        const confirmed = decide(steps.confirmed, given.confirmed, 'Contract signed on / First payment on')
        // The contract is confirmed only after it was sent.
        const sent = decide(steps.sent, given.sent, HEADER_OF.contractSentOn) || confirmed
        const intake = steps.intake === 'yes'

        const at = (d: string | null, kept: Date | null | undefined) => (d ? manilaStartOf(d) : (kept ?? now))
        const pickedContract = contractId ?? existing?.submissions[0]?.account?.contractId ?? existing?.contractId ?? null
        facts = {
          intakeCompletedAt: intake && !hasForm ? (existing?.intakeCompletedAt ?? now) : hasForm ? (existing?.intakeCompletedAt ?? null) : null,
          contractSentAt: sent ? at(day('contractSentOn'), existing?.contractSentAt) : null,
          contractSentByEmail: sent ? (existing?.contractSentAt && !day('contractSentOn') ? existing.contractSentByEmail : me) : null,
          contractSentId: sent ? (existing?.contractSentAt && !day('contractSentOn') && !contractId ? existing.contractSentId : pickedContract) : null,
          contractSignedOn: confirmed ? (day('contractSignedOn') ? dateOnly(day('contractSignedOn')!) : (existing?.contractSignedOn ?? dateOnly(today))) : null,
          contractConfirmedAt: confirmed ? (existing?.contractConfirmedAt ?? now) : null,
          contractConfirmedByEmail: confirmed ? (existing?.contractConfirmedAt ? existing.contractConfirmedByEmail : me) : null,
          handoffCompletedAt: handoff ? at(day('handoffDoneOn'), existing?.handoffCompletedAt) : null,
          handoffCompletedByEmail: handoff ? (existing?.handoffCompletedAt && !day('handoffDoneOn') ? existing.handoffCompletedByEmail : me) : null,
          ...(confirmed
            ? { paymentDate: day('firstPaymentOn') ? dateOnly(day('firstPaymentOn')!) : (existing?.paymentDate && !existing.noPaymentYet ? existing.paymentDate : dateOnly(today)), noPaymentYet: false }
            : {}),
        }
        const result = leadPhaseFor({
          formSubmitted: hasForm || !!facts.intakeCompletedAt,
          requestType: type,
          contractSent: !!facts.contractSentAt,
          contractConfirmed: !!facts.contractConfirmedAt,
          handoffCompleted: !!facts.handoffCompletedAt,
        })
        if (result !== phase) errors.push(`These steps add up to ${PHASE_LABELS[result]}, not ${PHASE_LABELS[phase]}.`)
        if (existing) {
          const cleared = [
            existing.contractSentAt && !facts.contractSentAt && 'contract sent',
            existing.contractConfirmedAt && !facts.contractConfirmedAt && 'contract and payment confirmed',
            existing.handoffCompletedAt && !facts.handoffCompletedAt && 'handoff done',
          ].filter(Boolean)
          if (cleared.length) notes.push(`Clears: ${cleared.join(', ')}.`)
        }
      }
    }

    // A new lead mustn't already exist, here or in the legacy CMS.
    let kind: ImportAction = errors.length ? 'error' : isNew ? 'create' : 'update'
    if (isNew && name) {
      const key = name.toLowerCase()
      const first = namesInFile.get(key)
      if (first) {
        errors.push(`The same name is already on row ${first} of this file.`)
        kind = 'error'
      } else namesInFile.set(key, row)
      if (kind === 'create') {
        const matches = await findCustomerMatches(name)
        const exact = matches.find((m) => m.name.trim().toLowerCase() === key)
        if (exact) {
          kind = 'skip'
          notes.push(
            exact.source === 'vaa_sys'
              ? `Already in vaa-sys as ${exact.code}. Put that Customer ID in the row to update it.`
              : `Already in the legacy CMS as ${exact.code ?? 'a customer'}; not added.`
          )
        } else if (matches.length) notes.push(`Similar names: ${matches.map((m) => m.name).join(', ')}.`)
      }
    }
    if (kind === 'update') notes.unshift(`Updates ${existing!.name}.`)

    plans.push({
      kind,
      existing,
      name,
      email,
      requestType,
      dateAdded: day('dateAdded'),
      csSpecialist,
      contractId,
      facts,
      result: {
        row,
        action: kind,
        name: name ?? existing?.name ?? '',
        customerCode: existing?.customerCode ?? null,
        phase: phase ? PHASE_LABELS[phase] : null,
        messages: [...errors, ...notes],
      },
    })
  }
  return plans
}

export function previewOf(fileName: string, plans: RowPlan[]): ImportPreview {
  const counts: Record<ImportAction, number> = { create: 0, update: 0, skip: 0, error: 0 }
  for (const p of plans) counts[p.kind]++
  return { fileName, rows: plans.map((p) => p.result), counts }
}

// ── Saving ────────────────────────────────────────────────────────

async function createLead(tx: Tx, actor: Actor, p: RowPlan, code: string, source: string, now: Date) {
  const createdAt = p.dateAdded ? manilaStartOf(p.dateAdded) : now
  const customer = await tx.customer.create({
    data: {
      customerCode: code,
      name: p.name!,
      email: p.email,
      status: 'PENDING',
      requestType: p.requestType ?? 'REGULAR',
      assignedSpecialistEmail: p.csSpecialist,
      contractId: p.contractId,
      ...(p.facts ?? {}),
      createdById: actor.id,
      createdByEmail: actor.email.toLowerCase(),
      createdAt,
      statusLogs: { create: { fromStatus: null, toStatus: 'PENDING', changedById: actor.id, changedByEmail: actor.email.toLowerCase(), changedAt: createdAt } },
    },
    select: { id: true },
  })
  await logActivity(tx, actor, { entityType: 'Customer', entityId: customer.id, entityLabel: p.name, customerId: customer.id, action: 'CREATE', newValue: p.name, notes: source })
  await syncLeadPhase(tx, actor, customer.id, source, now)
}

async function updateLead(tx: Tx, actor: Actor, p: RowPlan, source: string, now: Date) {
  const e = p.existing!
  const account = e.submissions[0]?.account ?? null
  const data: Prisma.CustomerUpdateInput = {
    ...(p.name ? { name: p.name } : {}),
    ...(p.email ? { email: p.email } : {}),
    ...(p.requestType ? { requestType: p.requestType } : {}),
    ...(p.csSpecialist ? { assignedSpecialistEmail: p.csSpecialist } : {}),
    ...(p.contractId && !account ? { contract: { connect: { id: p.contractId } } } : {}),
    ...(p.facts
      ? {
          intakeCompletedAt: p.facts.intakeCompletedAt,
          contractSentAt: p.facts.contractSentAt,
          contractSentByEmail: p.facts.contractSentByEmail,
          contractSent: p.facts.contractSentId ? { connect: { id: p.facts.contractSentId } } : { disconnect: true },
          contractSignedOn: p.facts.contractSignedOn,
          contractConfirmedAt: p.facts.contractConfirmedAt,
          contractConfirmedByEmail: p.facts.contractConfirmedByEmail,
          handoffCompletedAt: p.facts.handoffCompletedAt,
          handoffCompletedByEmail: p.facts.handoffCompletedByEmail,
          ...(p.facts.paymentDate ? { paymentDate: p.facts.paymentDate, noPaymentYet: false } : {}),
        }
      : {}),
  }
  await tx.customer.update({ where: { id: e.id }, data })
  if (p.contractId && account && account.contractId !== p.contractId) {
    await tx.account.update({ where: { id: account.id }, data: { contractId: p.contractId } })
    await logActivity(tx, actor, {
      entityType: 'Account',
      entityId: account.id,
      entityLabel: `${account.name} (${account.accountCode})`,
      customerId: e.id,
      action: 'CONTRACT_ASSIGNED',
      field: 'contractId',
      oldValue: account.contractId,
      newValue: p.contractId,
      notes: source,
    })
  }

  const before = {
    name: e.name,
    email: e.email,
    requestType: e.requestType,
    assignedSpecialistEmail: e.assignedSpecialistEmail,
    ...(account ? {} : { contractId: e.contractId }),
    contractSentAt: e.contractSentAt,
    contractConfirmedAt: e.contractConfirmedAt,
    handoffCompletedAt: e.handoffCompletedAt,
  }
  const after = {
    name: p.name ?? e.name,
    email: p.email ?? e.email,
    requestType: p.requestType ?? e.requestType,
    assignedSpecialistEmail: p.csSpecialist ?? e.assignedSpecialistEmail,
    ...(account ? {} : { contractId: p.contractId ?? e.contractId }),
    contractSentAt: p.facts ? p.facts.contractSentAt : e.contractSentAt,
    contractConfirmedAt: p.facts ? p.facts.contractConfirmedAt : e.contractConfirmedAt,
    handoffCompletedAt: p.facts ? p.facts.handoffCompletedAt : e.handoffCompletedAt,
  }
  await logActivity(tx, actor, fieldChanges({ entityType: 'Customer', entityId: e.id, entityLabel: e.name, customerId: e.id, notes: source }, before, after))
  await syncLeadPhase(tx, actor, e.id, source, now)
}

// Saves every create and update row, or nothing. Rows with errors stop the
// whole import; skipped rows are left out.
export async function applyImport(plans: RowPlan[], actor: Actor, fileName: string, now = new Date()): Promise<{ created: number; updated: number; skipped: number }> {
  if (plans.some((p) => p.kind === 'error')) throw new Error('rows-with-errors')
  const creates = plans.filter((p) => p.kind === 'create')
  const updates = plans.filter((p) => p.kind === 'update')
  const codes: string[] = []
  for (let i = 0; i < creates.length; i++) {
    let code = await generateCustomerCode()
    while (codes.includes(code)) code = await generateCustomerCode()
    codes.push(code)
  }
  const source = `Imported from ${fileName}`

  await prisma.$transaction(
    async (tx) => {
      for (const [i, p] of creates.entries()) await createLead(tx, actor, p, codes[i], source, now)
      for (const p of updates) await updateLead(tx, actor, p, source, now)
    },
    { maxWait: 10_000, timeout: 120_000 }
  )
  return { created: creates.length, updated: updates.length, skipped: plans.filter((p) => p.kind === 'skip').length }
}
