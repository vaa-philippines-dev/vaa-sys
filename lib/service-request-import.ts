import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'
import { buildTemplate, parseDay, readSheet, type ReadRow } from '@/lib/import-sheet'
import { listServices } from '@/lib/workforce'
import { departmentForService, departmentInfo } from '@/lib/request-departments'
import { requestRow } from '@/lib/ticket-rows'
import {
  REQUEST_GROUPS,
  REQUEST_GROUP_LABELS,
  SCHEDULES_IN_GROUP,
  SCHEDULE_GROUP_LABELS,
  SCHEDULE_LABELS,
  SERVICE_OFFERINGS,
  WORK_DAYS,
  isDaily,
  isTimeZone,
  shiftHours,
  subTicketCode,
  timeZoneOptions,
  workDaysOf,
  zoneTimeToPht,
  type DayHours,
  type RequestGroup,
  type ScheduleType,
  type VaRequest,
} from '@/lib/onboarding-fields'
import { SR_PHASES, SR_PHASE_LABELS, SR_TYPES, SR_TYPE_LABELS, srCode, type SrPhase, type SrType } from '@/lib/service-request-fields'
import {
  SERVICE_MAP_KEY,
  SR_IMPORT_COLUMNS,
  SR_IMPORT_DATE_KEYS,
  SR_IMPORT_DAY_KEYS,
  SR_IMPORT_MAX_BYTES,
  SR_IMPORT_MAX_ROWS,
  SR_IMPORT_SAMPLE,
  SR_IMPORT_SAMPLE_ACCOUNT,
  mappingKey,
  type ServiceMapping,
  type SrImportCheck,
  type SrImportKey,
  type UnmappedService,
} from '@/lib/service-request-import-fields'

// Server-only: the Service Requests import (Nov 6, 2026), for tickets the
// old system had (the New tickets of old accounts included) and any added
// in bulk. Admins only (permissions: serviceRequestImport).
//
// - One row is one VA request on a ticket for an existing account, found by
//   its Account ID (the customer is the account's).
// - Ticket and Sub-ticket IDs: a row can give the ticket's number
//   (TKT-000123) and its VA request's (TKT-000123-01), e.g. the old
//   system's. Rows with the same Ticket ID make one ticket, so they must
//   agree on the account, the request type and the phase. A blank Ticket ID
//   is a new ticket with the next number. A ticket already in the system is
//   skipped, so a file can be imported again after fixing some of its rows.
// - Service names from other systems ("Amazon VA") are mapped to a service
//   (and optionally a department) on the import page; the mappings are kept
//   in app_settings for later imports.
// - Rows with a problem (no service, no department, an unmapped service,
//   anything else) are held back with the rest of their ticket, so a ticket
//   is never imported in part. The other rows import, and the held ones can
//   be downloaded as a template with a Problem column, fixed and imported.

type Row = ReadRow<SrImportKey>
type Result<T = null> = { ok: true; data: T } | { ok: false; error: string }

// ── Service mappings ──────────────────────────────────────────────

export async function getServiceMappings(): Promise<ServiceMapping[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: SERVICE_MAP_KEY } }).catch(() => null)
  const value = (row?.value ?? {}) as Record<string, ServiceMapping>
  return Object.values(value)
    .filter((m) => m && typeof m.from === 'string' && typeof m.service === 'string')
    .sort((a, b) => a.from.localeCompare(b.from))
}

async function writeMappings(list: ServiceMapping[], email: string) {
  const value = Object.fromEntries(list.map((m) => [mappingKey(m.from), m])) as unknown as Prisma.InputJsonValue
  await prisma.appSetting.upsert({ where: { key: SERVICE_MAP_KEY }, create: { key: SERVICE_MAP_KEY, value, updatedByEmail: email }, update: { value, updatedByEmail: email, updatedAt: new Date() } })
}

// Adds or replaces mappings (by the name they map from).
export async function saveServiceMappings(actor: Actor, next: ServiceMapping[]): Promise<Result> {
  const { departments, serviceNames } = await lists()
  for (const m of next) {
    if (!m.from.trim()) return { ok: false, error: 'A mapping needs the name it maps from.' }
    if (!serviceNames.includes(m.service)) return { ok: false, error: `Pick a service for “${m.from}”.` }
    if (m.departmentId && !departments.some((d) => d.id === m.departmentId)) return { ok: false, error: `Pick a department from the list for “${m.from}”.` }
  }
  const current = await getServiceMappings()
  const byKey = new Map(current.map((m) => [mappingKey(m.from), m]))
  for (const m of next) byKey.set(mappingKey(m.from), { from: m.from.trim(), service: m.service, departmentId: m.departmentId || null })
  await writeMappings([...byKey.values()], actor.email.toLowerCase())
  await logActivity(
    prisma,
    actor,
    next.map((m) => ({
      entityType: 'Setting',
      entityId: SERVICE_MAP_KEY,
      entityLabel: 'Service request import: service mapping',
      action: 'UPDATE',
      field: m.from.trim(),
      oldValue: byKeyOld(current, m.from),
      newValue: `${m.service}${m.departmentId ? ` · ${departments.find((d) => d.id === m.departmentId)?.name}` : ''}`,
    }))
  )
  return { ok: true, data: null }
}
const byKeyOld = (list: ServiceMapping[], from: string) => list.find((m) => mappingKey(m.from) === mappingKey(from))?.service ?? null

export async function removeServiceMapping(actor: Actor, from: string): Promise<Result> {
  const current = await getServiceMappings()
  const left = current.filter((m) => mappingKey(m.from) !== mappingKey(from))
  if (left.length === current.length) return { ok: true, data: null }
  await writeMappings(left, actor.email.toLowerCase())
  await logActivity(prisma, actor, { entityType: 'Setting', entityId: SERVICE_MAP_KEY, entityLabel: 'Service request import: service mapping', action: 'DELETE', field: from, oldValue: byKeyOld(current, from) })
  return { ok: true, data: null }
}

// ── The template ──────────────────────────────────────────────────

async function lists() {
  const [info, services] = await Promise.all([departmentInfo(), listServices()])
  const serviceNames = [...new Set([...SERVICE_OFFERINGS, ...services.map((s) => s.name)])]
  return { info, departments: info.departments, serviceNames }
}

// The services and departments a mapping can pick, for the import page.
export async function mappingChoices() {
  const { departments, serviceNames } = await lists()
  return { services: serviceNames, departments: departments.map((d) => ({ id: d.id, name: d.name })) }
}

// The phases a ticket can be imported at (New is no longer a step).
const IMPORT_PHASES = SR_PHASES.filter((p) => p !== 'NEW')

async function templateOptions() {
  const [{ departments, serviceNames }, mappings] = await Promise.all([lists(), getServiceMappings()])
  return {
    sheet: 'Service requests',
    columns: SR_IMPORT_COLUMNS,
    lists: [
      { key: 'requestType' as const, title: 'Request type', values: SR_TYPES.map((t) => SR_TYPE_LABELS[t]) },
      { key: 'requestGroup' as const, title: 'Request group', values: REQUEST_GROUPS.map((g) => REQUEST_GROUP_LABELS[g]) },
      { key: 'department' as const, title: 'Department', values: departments.map((d) => d.name), warnOnly: true },
      // The services, then the names already mapped; others can be typed and mapped on the page.
      { key: 'service' as const, title: 'Service', values: [...serviceNames, ...mappings.map((m) => m.from)], warnOnly: true },
      { key: 'phase' as const, title: 'Phase', values: IMPORT_PHASES.map((p) => SR_PHASE_LABELS[p]) },
      { key: 'scheduleType' as const, title: 'Schedule type', values: Object.values(SCHEDULE_GROUP_LABELS) },
      { key: 'regularSchedule' as const, title: 'Regular schedule', values: SCHEDULES_IN_GROUP.REGULAR.map((s) => SCHEDULE_LABELS[s]) },
      { key: 'timeTracker' as const, title: 'Time tracker', values: ['Yes', 'No'] },
      { key: 'timeZone' as const, title: 'Client time zone', values: timeZoneOptions().map((t) => t.value) },
    ],
    dateKeys: SR_IMPORT_DATE_KEYS,
    maxRows: SR_IMPORT_MAX_ROWS,
    help: [
      'VAA Systems: Service Requests import',
      'One row per VA request (sub-ticket) on an existing account, found by its Account ID. Rows with the same Ticket ID make one ticket.',
      `Row 2 is a sample (Account ID “${SR_IMPORT_SAMPLE_ACCOUNT}”): write over it or delete it. Left in, it is skipped.`,
      'Required: Account ID, Request type, Request group, Service, Schedule type, Target start date. A department left blank is the service’s.',
      'Service names from other systems (e.g. “Amazon VA”) are fine: the import page asks you to map each new one to a service once, and keeps the mapping.',
      'Rows with a problem are held back with the rest of their ticket; the others are imported. Download the held rows from the import page (they come with a Problem column), fix them and import that file.',
      'A ticket already in the system is skipped, so importing a file again only adds what is missing.',
      'The focal person isn’t imported: each ticket shows its account’s focal contact.',
      'Daily schedules: Mon–Fri take the hours per day (or the shift) unless their column says otherwise; 0 is a day off; fill Sat or Sun to add those days.',
    ],
  }
}

export async function buildServiceRequestTemplate(): Promise<Buffer> {
  return buildTemplate({ ...(await templateOptions()), sample: SR_IMPORT_SAMPLE })
}

export async function readServiceRequestFile(file: File): Promise<{ rows: Row[] } | { error: string }> {
  return readSheet(file, {
    sheet: 'Service requests',
    columns: SR_IMPORT_COLUMNS,
    dateKeys: SR_IMPORT_DATE_KEYS,
    required: ['accountId', 'requestType', 'requestGroup', 'service', 'scheduleType', 'targetStartDate'],
    maxRows: SR_IMPORT_MAX_ROWS,
    maxBytes: SR_IMPORT_MAX_BYTES,
  })
}

// ── Checking rows ─────────────────────────────────────────────────

export type SrRowPlan = {
  kind: 'create' | 'skip' | 'problem'
  row: number
  values: Row['values']
  account: string
  customer: string | null
  detail: string | null
  messages: string[]
  data?: {
    customerId: string
    accountId: string
    type: SrType
    phase: SrPhase
    group: RequestGroup
    departmentId: string
    request: VaRequest
    // The Ticket ID's number, or null for a new ticket with the next number.
    ticketNumber: number | null
    // The Sub-ticket ID's number, when given; then the line it gets.
    line: number | null
    lineNo: number
  }
}

const lower = (s: string) => s.trim().toLowerCase()
const byLabel = <K extends string>(keys: readonly K[], labels: Record<K, string>, raw: string, extra: Record<string, K> = {}): K | null => {
  const v = lower(raw).replace(/[\s_-]+/g, ' ')
  if (!v) return null
  return keys.find((k) => lower(labels[k]).replace(/[\s_-]+/g, ' ') === v || lower(k).replace(/_/g, ' ') === v) ?? extra[v] ?? null
}

// '' → null; a number of hours → it; anything else → NaN.
const hoursOf = (raw: string) => {
  const s = raw.trim().replace(/h(ours?|rs?)?$/i, '').trim()
  return s === '' ? null : Number(s)
}

// "9:00 AM", "9 am", "21:00", "09:00:00" → "09:00"; '' → null; else 'bad'.
function timeOf(raw: string): string | null | 'bad' {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(s)
  if (!m) return 'bad'
  let h = Number(m[1])
  const min = Number(m[2] ?? '0')
  const ampm = m[3]?.[0]
  if (ampm) {
    if (h < 1 || h > 12) return 'bad'
    h = (h % 12) + (ampm === 'p' ? 12 : 0)
  }
  if (h > 23 || min > 59) return 'bad'
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// "TKT-000123", "TKT123", "123" → 123; '' → null; anything else → NaN.
function ticketNumberOf(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const m = /^(?:tkt[-\s]?)?0*(\d{1,9})$/i.exec(s)
  return m ? Number(m[1]) : NaN
}

// "TKT-000123-01" → { ticket: 123, line: 1 }; "01" → { ticket: null, line: 1 }.
function subTicketOf(raw: string): { ticket: number | null; line: number } | null | 'bad' {
  const s = raw.trim()
  if (!s) return null
  const m = /^(?:(?:tkt[-\s]?)?0*(\d{1,9})-)?0*(\d{1,3})$/i.exec(s)
  if (!m || Number(m[2]) < 1) return 'bad'
  return { ticket: m[1] ? Number(m[1]) : null, line: Number(m[2]) }
}

export async function planServiceRequestImport(rows: Row[]): Promise<{ plans: SrRowPlan[]; unmapped: UnmappedService[] }> {
  const [{ info, departments, serviceNames }, mappings] = await Promise.all([lists(), getServiceMappings()])
  const deptByName = new Map(departments.map((d) => [lower(d.name), d]))
  const serviceByName = new Map(serviceNames.map((s) => [lower(s), s]))
  const mappingOf = new Map(mappings.map((m) => [mappingKey(m.from), m]))
  const unmapped = new Map<string, UnmappedService>()

  const codes = [...new Set(rows.map((r) => r.values.accountId.trim().toUpperCase()).filter(Boolean))]
  const accounts = codes.length
    ? await prisma.account.findMany({
        where: { accountCode: { in: codes } },
        select: { id: true, accountCode: true, name: true, timeZone: true, customerId: true, customer: { select: { name: true } }, _count: { select: { tickets: { where: { type: 'NEW' } } } } },
      })
    : []
  const accountByCode = new Map(accounts.map((a) => [a.accountCode.toUpperCase(), a]))
  // Tickets already in the system are skipped.
  const given = [
    ...new Set(
      rows
        .flatMap((r) => {
          const s = subTicketOf(r.values.subticketId)
          return [ticketNumberOf(r.values.ticketId), s && s !== 'bad' ? s.ticket : null]
        })
        .filter((n): n is number => n != null && !Number.isNaN(n))
    ),
  ]
  const taken = new Set(given.length ? (await prisma.ticket.findMany({ where: { ticketNumber: { in: given } }, select: { ticketNumber: true } })).map((t) => t.ticketNumber) : [])

  const plans = rows.map(({ row, values: v }): SrRowPlan => {
    const errors: string[] = []
    const notes: string[] = []
    const code = v.accountId.trim().toUpperCase()
    const a = accountByCode.get(code)
    const base = { row, values: v, account: a ? `${a.name} · ${a.accountCode}` : code || '(no account)', customer: a?.customer.name ?? null }
    const out = (kind: SrRowPlan['kind'], detail: string | null): SrRowPlan => ({ ...base, kind, detail, messages: [...errors, ...notes] })

    // The template's sample row, left in.
    if (lower(v.accountId) === lower(SR_IMPORT_SAMPLE_ACCOUNT)) {
      notes.push('The template’s sample row: skipped.')
      return out('skip', null)
    }

    // The Ticket and Sub-ticket IDs.
    let ticketNumber = ticketNumberOf(v.ticketId)
    const sub = subTicketOf(v.subticketId)
    if (Number.isNaN(ticketNumber)) errors.push(`Ticket ID “${v.ticketId.trim()}” isn’t a ticket number like TKT-000123.`)
    if (sub === 'bad') errors.push(`Sub-ticket ID “${v.subticketId.trim()}” isn’t like TKT-000123-01.`)
    else if (sub?.ticket != null) {
      if (ticketNumber == null) ticketNumber = sub.ticket
      else if (!Number.isNaN(ticketNumber) && ticketNumber !== sub.ticket) errors.push(`Sub-ticket ID ${v.subticketId.trim()} isn’t on ticket ${srCode(ticketNumber)}.`)
    }
    if (sub && sub !== 'bad' && ticketNumber == null) errors.push('A Sub-ticket ID needs the Ticket ID.')
    if (ticketNumber != null && !Number.isNaN(ticketNumber) && taken.has(ticketNumber)) {
      notes.push(`${srCode(ticketNumber)} is already in the system: skipped.`)
      return out('skip', null)
    }
    const line = sub && sub !== 'bad' ? sub.line : null

    // The account (and so the customer).
    if (!code) errors.push('Enter the Account ID.')
    else if (!a) errors.push(`No account has the ID ${code}.`)

    // The ticket.
    const type = byLabel(SR_TYPES, SR_TYPE_LABELS, v.requestType)
    if (!type) errors.push('Request type must be New, Additional, Replacement or Reliever.')
    if (type === 'NEW' && a && a._count.tickets > 0) notes.push('This account already has a New ticket; this adds another.')
    const group = byLabel(REQUEST_GROUPS, REQUEST_GROUP_LABELS, v.requestGroup, { regular: 'REGULAR' })
    if (!group) errors.push('Request group must be Standard, Expert or Casual.')
    // Blank or "New" is VA Assignment: New is no longer a step.
    const phase = v.phase.trim() ? byLabel(SR_PHASES, SR_PHASE_LABELS, v.phase, { 'closed won': 'CLOSED_WON', 'closed lost': 'CLOSED_LOST', won: 'CLOSED_WON', lost: 'CLOSED_LOST', new: 'VA_ASSIGNMENT' }) : 'VA_ASSIGNMENT'
    if (!phase) errors.push(`Phase “${v.phase.trim()}” isn’t one of the phases in the list.`)

    // The service: one of the services, or a name mapped to one.
    const rawService = v.service.trim()
    const mapping = rawService ? mappingOf.get(mappingKey(rawService)) : undefined
    const service = rawService ? (serviceByName.get(lower(rawService)) ?? mapping?.service ?? null) : null
    if (!rawService) errors.push('No service.')
    else if (!service) {
      errors.push(`“${rawService}” isn’t mapped to a service yet: map it above, then check again.`)
      const u = unmapped.get(mappingKey(rawService)) ?? { value: rawService, rows: [] }
      u.rows.push(row)
      unmapped.set(mappingKey(rawService), u)
    } else if (mapping && !serviceByName.has(lower(rawService))) notes.push(`“${rawService}” imports as ${service}.`)

    // The department: the column, else the mapping's, else the service's.
    let departmentId: string | null = null
    if (v.department.trim()) {
      const d = deptByName.get(lower(v.department))
      if (!d) errors.push(`“${v.department.trim()}” isn’t a VAA Workforce service department.`)
      else departmentId = d.id
    } else if (mapping?.departmentId) departmentId = mapping.departmentId
    else if (service) departmentId = departmentForService(info, service)
    // (An unmapped service is reported above: its mapping may bring the department.)
    if (!departmentId && !v.department.trim()) {
      if (service) errors.push(`No department, and ${service} has none: enter the department, or map the service to one.`)
      else if (!rawService) errors.push('No department.')
    }
    if (departmentId && !info.managers.get(departmentId)?.length && phase !== 'CLOSED_WON' && phase !== 'CLOSED_LOST')
      notes.push(`No Service Department Manager for ${departments.find((d) => d.id === departmentId)?.name} on Access yet.`)

    // The schedule.
    const start = parseDay(v.targetStartDate)
    if (start === null) errors.push('Enter the target start date.')
    else if (start === 'bad') errors.push('Target start date must be YYYY-MM-DD or M/D/YYYY.')
    const zone = v.timeZone.trim()
    if (zone && !isTimeZone(zone)) errors.push(`“${zone}” isn’t a time zone. Use one like America/New_York.`)

    const kind = lower(v.scheduleType).replace(/[\s_-]+/g, ' ')
    let scheduleType: ScheduleType | null = null
    if (kind === 'project based' || kind === 'project') scheduleType = 'PROJECT'
    else if (kind === 'regular') {
      const reg = lower(v.regularSchedule).replace(/[\s_,-]+/g, ' ')
      const found = SCHEDULES_IN_GROUP.REGULAR.find((s) => lower(SCHEDULE_LABELS[s]).replace(/[\s_,-]+/g, ' ') === reg)
      scheduleType =
        found ??
        (reg === 'daily fixed' ? 'DAILY_FIXED' : reg === 'daily flexible' ? 'DAILY_FLEXIBLE' : reg === 'daily' ? (v.startTime.trim() ? 'DAILY_FIXED' : 'DAILY_FLEXIBLE') : reg === 'weekly' ? 'WEEKLY_FLEXIBLE' : null)
      if (!scheduleType) errors.push('Regular schedule must be Daily, fixed time; Daily, flexible time; Weekly; or Monthly.')
    } else errors.push('Schedule type must be Regular or Project-based.')

    const hoursPerDayRaw = hoursOf(v.hoursPerDay)
    const hoursPerWeek = hoursOf(v.hoursPerWeek)
    const hoursPerMonth = hoursOf(v.hoursPerMonth)
    const projectHours = hoursOf(v.projectHours)
    for (const [label, h, max] of [
      ['Hours per day', hoursPerDayRaw, 24],
      ['Hours per week', hoursPerWeek, 168],
      ['Hours per month', hoursPerMonth, 744],
      ['Project hours', projectHours, 10000],
    ] as const)
      if (h != null && (Number.isNaN(h) || h <= 0 || h > max)) errors.push(`${label} must be a number of hours above 0 and up to ${max}.`)
    // The day columns typed in (blank = not given; 0 = a day off).
    const typedDays: DayHours = SR_IMPORT_DAY_KEYS.map((k) => hoursOf(v[k]))
    if (typedDays.some((h) => h != null && (Number.isNaN(h) || h < 0 || h > 24))) errors.push('Mon to Sun must be hours from 0 to 24.')
    let days: DayHours | null = null

    let startPht = ''
    let endPht = ''
    let perDay: number | null = hoursPerDayRaw
    const tz = zone || a?.timeZone || null
    if (scheduleType === 'DAILY_FIXED') {
      const s = timeOf(v.startTime)
      const e = timeOf(v.endTime)
      if (!s || !e || s === 'bad' || e === 'bad') errors.push('Daily, fixed time needs a start and end time, e.g. 9:00 AM and 6:00 PM.')
      else if (start && start !== 'bad') {
        startPht = tz ? zoneTimeToPht(s, tz, start) : s
        endPht = tz ? zoneTimeToPht(e, tz, start) : e
        perDay = shiftHours(startPht, endPht)
        if (!tz) notes.push('No time zone on the row or the account: the times are taken as Philippine time.')
      }
    }
    // Daily: Mon–Fri start at the hours a day (or the shift), as the forms
    // fill them; a day column typed in replaces that day, Sat and Sun too.
    const anyTyped = typedDays.some((h) => h != null)
    if (scheduleType === 'DAILY_FLEXIBLE' && perDay == null) perDay = typedDays.find((h) => h != null && h > 0) ?? null
    if (scheduleType === 'DAILY_FLEXIBLE' && perDay == null) errors.push('Daily, flexible time needs the hours per day, or the hours in Mon to Sun.')
    if (scheduleType === 'WEEKLY_FLEXIBLE' && hoursPerWeek == null) errors.push('Weekly needs the hours per week.')
    if (scheduleType === 'MONTHLY' && hoursPerMonth == null) errors.push('Monthly needs the hours per month.')
    if (scheduleType === 'PROJECT' && projectHours == null) errors.push('Project-based needs the project hours.')
    if (isDaily(scheduleType) && (perDay != null || anyTyped)) days = WORK_DAYS.map((_, i) => (typedDays[i] != null ? typedDays[i] : i < 5 ? perDay : null))
    if (isDaily(scheduleType) && days && workDaysOf(days).length === 0) errors.push('A daily schedule needs hours on at least one day.')

    const tracker = lower(v.timeTracker)
    if (tracker && !['yes', 'no', 'y', 'n', 'true', 'false'].includes(tracker)) errors.push('Time tracker must be Yes or No.')

    const detail = [type ? SR_TYPE_LABELS[type] : v.requestType.trim() || null, service ?? (rawService || null), phase ? SR_PHASE_LABELS[phase] : null].filter(Boolean).join(' · ')
    if (errors.length || !a || !type || !group || !phase || !service || !departmentId || !scheduleType || !start || start === 'bad' || Number.isNaN(ticketNumber)) return out('problem', detail)

    const request: VaRequest = {
      service: service as VaRequest['service'],
      numberOfVas: 1,
      targetStartDate: start,
      scheduleType,
      hoursPerDay: scheduleType === 'DAILY_FLEXIBLE' ? perDay : null,
      hoursPerWeek: scheduleType === 'WEEKLY_FLEXIBLE' ? hoursPerWeek : null,
      hoursPerMonth: scheduleType === 'MONTHLY' ? hoursPerMonth : null,
      projectHours: scheduleType === 'PROJECT' ? projectHours : null,
      startTimePht: startPht,
      endTimePht: endPht,
      workDays: days ? workDaysOf(days) : [],
      dayHours: isDaily(scheduleType) ? days : null,
      additionalHours: v.additionalHours.trim().slice(0, 200),
      taskTracker: tracker ? ['yes', 'y', 'true'].includes(tracker) : null,
      tasks: v.tasks.trim().slice(0, 2000),
      tools: v.tools.trim().slice(0, 1000),
      timeZone: zone,
      mustHaves: v.mustHaves.trim().slice(0, 2000),
    }
    return { ...out('create', detail), data: { customerId: a.customerId, accountId: a.id, type, phase, group, departmentId, request, ticketNumber, line, lineNo: line ?? 0 } }
  })

  // Rows with the same Ticket ID make one ticket: they must agree on the
  // account, the request type and the phase, and their sub-tickets can't
  // repeat.
  const problem = (p: SrRowPlan, message: string) => {
    p.kind = 'problem'
    p.messages = [message, ...p.messages]
  }
  const groups = new Map<number, SrRowPlan[]>()
  for (const p of plans) {
    const n = p.data?.ticketNumber ?? (p.kind === 'problem' ? ticketOfRow(p) : null)
    if (n != null) groups.set(n, [...(groups.get(n) ?? []), p])
  }
  for (const [n, group] of groups) {
    const ok = group.filter((p) => p.kind === 'create')
    const first = ok[0]?.data
    for (const p of ok.slice(1)) {
      const d = p.data!
      if (d.accountId !== first!.accountId) problem(p, `${srCode(n)} is on another account in row ${ok[0].row}.`)
      else if (d.type !== first!.type) problem(p, `${srCode(n)} is a ${SR_TYPE_LABELS[first!.type]} ticket in row ${ok[0].row}.`)
      else if (d.phase !== first!.phase) problem(p, `${srCode(n)} is at ${SR_PHASE_LABELS[first!.phase]} in row ${ok[0].row}: give its rows the same phase.`)
    }
    const used = new Set<number>()
    for (const p of group) {
      const l = p.data?.line
      if (l == null) continue
      if (used.has(l)) problem(p, `${subTicketCode(n, l)} is on two rows.`)
      used.add(l)
    }
    // A ticket is imported whole: one row with a problem holds back the rest.
    const held = group.filter((p) => p.kind === 'problem').map((p) => p.row)
    if (held.length)
      for (const p of group) if (p.kind === 'create') problem(p, `Held back with row${held.length === 1 ? '' : 's'} ${held.join(', ')} of ${srCode(n)}, which ${held.length === 1 ? 'has a problem' : 'have problems'}: a ticket is imported whole.`)
    // Each VA's line: its Sub-ticket ID's, or the next free one.
    let next = 1
    for (const p of group) {
      if (p.kind !== 'create') continue
      const d = p.data!
      if (d.line != null) d.lineNo = d.line
      else {
        while (used.has(next)) next++
        used.add(next)
        d.lineNo = next
      }
    }
  }
  for (const p of plans) {
    const d = p.data
    if (!d || p.kind !== 'create') continue
    if (d.ticketNumber == null) d.lineNo = 1
    p.detail = `${d.ticketNumber != null ? subTicketCode(d.ticketNumber, d.lineNo) : 'Next ticket number'} · ${p.detail}`
  }
  return { plans, unmapped: [...unmapped.values()] }
}

// The ticket a problem row names, so it holds back its ticket's other rows.
function ticketOfRow(p: SrRowPlan): number | null {
  const n = ticketNumberOf(p.values.ticketId)
  if (n != null && !Number.isNaN(n)) return n
  const s = subTicketOf(p.values.subticketId)
  return s && s !== 'bad' ? s.ticket : null
}

const ticketKey = (p: SrRowPlan) => (p.data!.ticketNumber != null ? `n${p.data!.ticketNumber}` : `row${p.row}`)

export function serviceRequestCheckOf(fileName: string, plans: SrRowPlan[], unmapped: UnmappedService[]): SrImportCheck {
  const count = (k: SrRowPlan['kind']) => plans.filter((p) => p.kind === k).length
  return {
    fileName,
    rows: plans.map((p) => ({ row: p.row, action: p.kind, account: p.account, customer: p.customer, detail: p.detail, messages: p.messages })),
    counts: { create: count('create'), skip: count('skip'), problem: count('problem'), tickets: new Set(plans.filter((p) => p.kind === 'create').map(ticketKey)).size },
    unmapped,
  }
}

// The rows held back, as a template to fix and import again.
export async function problemRowsWorkbook(plans: SrRowPlan[]): Promise<Buffer> {
  return buildTemplate({ ...(await templateOptions()), rows: plans.filter((p) => p.kind === 'problem').map((p) => ({ values: p.values, problem: p.messages.join(' ') })) })
}

// ── Saving ────────────────────────────────────────────────────────

// Saves the rows ready to import (one ticket per Ticket ID, one per row
// without), all together; the rows with problems are left out.
export async function applyServiceRequestImport(plans: SrRowPlan[], actor: Actor, fileName: string): Promise<{ tickets: number; requests: number; skipped: number; problems: number }> {
  const creates = plans.filter((p) => p.kind === 'create' && p.data)
  const tickets = new Map<string, SrRowPlan[]>()
  for (const p of creates) tickets.set(ticketKey(p), [...(tickets.get(ticketKey(p)) ?? []), p])
  const me = actor.email.toLowerCase()
  const now = new Date()
  if (tickets.size)
    await prisma.$transaction(
      async (tx) => {
        for (const group of tickets.values()) {
          const d = group[0].data!
          const closed = d.phase === 'CLOSED_WON' || d.phase === 'CLOSED_LOST'
          const t = await tx.ticket.create({
            data: {
              ...(d.ticketNumber != null ? { ticketNumber: d.ticketNumber } : {}),
              customerId: d.customerId,
              accountId: d.accountId,
              type: d.type,
              phase: d.phase,
              phaseChangedAt: now,
              ...(closed ? { closedAt: now, closedByEmail: me, closedReason: d.phase === 'CLOSED_LOST' ? `Imported from ${fileName}` : null } : {}),
              createdByEmail: me,
              requests: {
                create: [...group]
                  .sort((a, b) => a.data!.lineNo - b.data!.lineNo)
                  .map((p) => ({ ...requestRow(p.data!.request, p.data!.lineNo), departmentId: p.data!.departmentId, requestGroup: p.data!.group, requestGroupSetBy: me })),
              },
            },
            select: { id: true, ticketNumber: true },
          })
          await logActivity(tx, actor, {
            entityType: 'ServiceRequest',
            entityId: t.id,
            entityLabel: srCode(t.ticketNumber),
            customerId: d.customerId,
            action: 'CREATE',
            newValue: `${SR_TYPE_LABELS[d.type]} service request, ${SR_PHASE_LABELS[d.phase]}`,
            notes: `Imported from ${fileName} (row${group.length > 1 ? 's' : ''} ${group.map((p) => p.row).join(', ')})`,
          })
        }
        // Tickets given their own number leave the numbering behind them, so
        // the next ticket made in the app takes the number after the highest.
        if (creates.some((p) => p.data!.ticketNumber != null))
          await tx.$queryRaw`SELECT setval(pg_get_serial_sequence('"vaa_sys"."tickets"', 'ticket_number'), (SELECT max(ticket_number) FROM "vaa_sys"."tickets"))`
      },
      { maxWait: 10_000, timeout: 180_000 }
    )
  return { tickets: tickets.size, requests: creates.length, skipped: plans.filter((p) => p.kind === 'skip').length, problems: plans.filter((p) => p.kind === 'problem').length }
}
