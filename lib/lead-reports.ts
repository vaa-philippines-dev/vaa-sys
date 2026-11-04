import { prisma } from '@/lib/prisma'
import { staffNames } from '@/lib/workforce'
import { dateOnly, dayString, manilaStartOf, manilaToday } from '@/lib/customer-fields'
import { REQUEST_GROUPS, REQUEST_GROUP_LABELS, SCHEDULE_LABELS, SCHEDULE_TYPES } from '@/lib/onboarding-fields'

// Lead Management's reports (/leads/reports). Server-only: reads Prisma.
//
// Every day here is a Manila calendar day, and a range covers whole days:
// from the start of `from` to the end of `to`. Three sections:
// - Funnel: the leads added in the range, followed to today through each
//   onboarding step (a lead counts at a step only if it reached every step
//   before it, so the funnel never widens).
// - Leads over time: what happened in each week or month of the range.
// - VA demand: the VA requests on forms submitted in the range.

const DAY = 86_400_000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// ── Range ─────────────────────────────────────────────────────────

export const RANGE_PRESETS = { '30d': 'Last 30 days', '90d': 'Last 90 days', year: 'This year' } as const
export type RangePreset = keyof typeof RANGE_PRESETS
export type ReportRange = { from: string; to: string; preset: RangePreset | null; unit: 'week' | 'month' }

function addDays(day: string, n: number) {
  return dayString(new Date(dateOnly(day).getTime() + n * DAY))
}

function isDay(s: string | undefined): s is string {
  return !!s && DAY_RE.test(s) && dayString(dateOnly(s)) === s
}

function presetFrom(preset: RangePreset, today: string) {
  if (preset === '30d') return addDays(today, -29)
  if (preset === '90d') return addDays(today, -89)
  return `${today.slice(0, 4)}-01-01`
}

// Weeks for up to about four months, months beyond that, so a chart never
// has more than ~18 weekly bars.
function unitFor(from: string, to: string): 'week' | 'month' {
  return (dateOnly(to).getTime() - dateOnly(from).getTime()) / DAY + 1 <= 124 ? 'week' : 'month'
}

// From the page's search params. Anything unreadable falls back to the last
// 90 days; days after today are cut to today; a reversed range is swapped.
export function parseRange(params: { range?: string; from?: string; to?: string }, now = new Date()): ReportRange {
  const today = manilaToday(now)
  if (params.range && params.range in RANGE_PRESETS) {
    const preset = params.range as RangePreset
    const from = presetFrom(preset, today)
    return { from, to: today, preset, unit: unitFor(from, today) }
  }
  if (isDay(params.from) && isDay(params.to)) {
    let [from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from]
    if (to > today) to = today
    if (from > to) from = to
    return { from, to, preset: null, unit: unitFor(from, to) }
  }
  const from = presetFrom('90d', today)
  return { from, to: today, preset: '90d', unit: unitFor(from, today) }
}

function rangeBounds(range: ReportRange) {
  return { start: manilaStartOf(range.from), end: manilaStartOf(addDays(range.to, 1)) }
}

// ── Buckets (weeks start on Monday) ───────────────────────────────

function bucketOf(day: string, unit: ReportRange['unit']) {
  if (unit === 'month') return `${day.slice(0, 7)}-01`
  const offset = (dateOnly(day).getUTCDay() + 6) % 7
  return addDays(day, -offset)
}

function nextBucket(key: string, unit: ReportRange['unit']) {
  if (unit === 'week') return addDays(key, 7)
  const d = dateOnly(key)
  return dayString(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
}

const weekLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

function bucketLabel(key: string, unit: ReportRange['unit']) {
  return unit === 'week' ? weekLabel.format(dateOnly(key)) : monthLabel.format(dateOnly(key))
}

// ── Report ────────────────────────────────────────────────────────

export const FUNNEL_STEPS = [
  { key: 'added', label: 'Leads added' },
  { key: 'linkSent', label: 'Link sent' },
  { key: 'opened', label: 'Form opened' },
  { key: 'submitted', label: 'Form submitted' },
  { key: 'active', label: 'Became Active' },
] as const

export type FunnelStep = {
  key: (typeof FUNNEL_STEPS)[number]['key']
  label: string
  count: number
  // Share of the leads added, and of the step before (null for the first).
  pctOfAdded: number | null
  pctOfPrevious: number | null
  // Median days from the step before, over the leads that reached both.
  medianDays: number | null
}

export type PeriodRow = {
  key: string
  label: string
  newLeads: number
  linksSent: number
  formsSubmitted: number
  // Links that ran out unused before a new link replaced them.
  linksExpired: number
}

export type AdderRow = { email: string; name: string; added: number; submitted: number; active: number }
export type DemandRow = { label: string; vas: number }

export type LeadReport = {
  funnel: FunnelStep[]
  // Leads made Active in Customer Management without a submitted form; they
  // are left out of the funnel's last step.
  activeWithoutForm: number
  periods: PeriodRow[]
  adders: AdderRow[]
  demand: {
    vas: number
    forms: number
    customers: number
    byService: DemandRow[]
    bySchedule: DemandRow[]
    byGroup: DemandRow[]
    byRegion: DemandRow[]
  }
}

function earliest(dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((min, d) => (d && (!min || d < min) ? d : min), null)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

function sortedRows(map: Map<string, number>): DemandRow[] {
  return [...map].map(([label, vas]) => ({ label, vas })).sort((a, b) => b.vas - a.vas || a.label.localeCompare(b.label))
}

// Fixed categories keep their own order (and show zeros), so the same row
// is always in the same place.
function fixedRows<K extends string>(keys: readonly K[], labels: Record<K, string>, map: Map<string, number>): DemandRow[] {
  return keys.map((k) => ({ label: labels[k], vas: map.get(k) ?? 0 }))
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by)
}

export async function leadReport(range: ReportRange, now = new Date()): Promise<LeadReport> {
  const { start, end } = rangeBounds(range)
  const expiredBefore = end < now ? end : now

  const [leads, links, requests] = await Promise.all([
    prisma.customer.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: {
        createdAt: true,
        createdByEmail: true,
        onboardingLinks: { select: { createdAt: true, openedAt: true, submittedAt: true } },
        statusLogs: { where: { toStatus: 'ACTIVE' }, orderBy: { changedAt: 'asc' }, take: 1, select: { changedAt: true, effectiveDate: true } },
      },
    }),
    prisma.onboardingLink.findMany({
      where: {
        OR: [
          { createdAt: { gte: start, lt: end } },
          { submittedAt: { gte: start, lt: end } },
          { expiresAt: { gte: start, lt: expiredBefore }, submittedAt: null },
        ],
      },
      select: { createdAt: true, submittedAt: true, expiresAt: true, revokedAt: true },
    }),
    prisma.ticketRequest.findMany({
      where: { ticket: { submission: { is: { submittedAt: { gte: start, lt: end } } } } },
      select: {
        service: true,
        numberOfVas: true,
        scheduleType: true,
        requestGroup: true,
        ticket: { select: { id: true, customerId: true, account: { select: { contacts: { where: { kind: 'PRIMARY' }, select: { region: true } } } } } },
      },
    }),
  ])

  // Funnel: each lead's first time at each step.
  const timelines = leads.map((l) => {
    const log = l.statusLogs[0]
    return [
      l.createdAt,
      earliest(l.onboardingLinks.map((k) => k.createdAt)),
      earliest(l.onboardingLinks.map((k) => k.openedAt)),
      earliest(l.onboardingLinks.map((k) => k.submittedAt)),
      log ? (log.effectiveDate ?? log.changedAt) : null,
    ]
  })
  const reached = (t: (Date | null)[], step: number) => t.slice(0, step + 1).every(Boolean)
  const funnel: FunnelStep[] = FUNNEL_STEPS.map((s, i) => {
    const at = timelines.filter((t) => reached(t, i))
    const prev = i === 0 ? null : timelines.filter((t) => reached(t, i - 1)).length
    // A backdated status can land before the step before it; count that as 0 days.
    const days = i === 0 ? [] : at.map((t) => Math.max(0, (t[i]!.getTime() - t[i - 1]!.getTime()) / DAY))
    return {
      key: s.key,
      label: s.label,
      count: at.length,
      pctOfAdded: i === 0 ? null : pct(at.length, leads.length),
      pctOfPrevious: prev === null ? null : pct(at.length, prev),
      medianDays: median(days),
    }
  })
  const activeWithoutForm = timelines.filter((t) => t[4] && !t[3]).length

  // Leads over time.
  const periods = new Map<string, PeriodRow>()
  for (let key = bucketOf(range.from, range.unit); key <= range.to; key = nextBucket(key, range.unit)) {
    periods.set(key, { key, label: bucketLabel(key, range.unit), newLeads: 0, linksSent: 0, formsSubmitted: 0, linksExpired: 0 })
  }
  const inRange = (d: Date | null) => !!d && d >= start && d < end
  const period = (d: Date) => periods.get(bucketOf(manilaToday(d), range.unit))
  for (const l of leads) period(l.createdAt)!.newLeads++
  for (const k of links) {
    if (inRange(k.createdAt)) period(k.createdAt)!.linksSent++
    if (inRange(k.submittedAt)) period(k.submittedAt!)!.formsSubmitted++
    const ranOut = !k.submittedAt && k.expiresAt >= start && k.expiresAt < expiredBefore && (!k.revokedAt || k.revokedAt >= k.expiresAt)
    if (ranOut) period(k.expiresAt)!.linksExpired++
  }

  // Who added the leads, and how far theirs got.
  const byAdder = new Map<string, Omit<AdderRow, 'name'>>()
  leads.forEach((l, i) => {
    const email = l.createdByEmail.toLowerCase()
    const row = byAdder.get(email) ?? { email, added: 0, submitted: 0, active: 0 }
    row.added++
    if (reached(timelines[i], 3)) row.submitted++
    if (reached(timelines[i], 4)) row.active++
    byAdder.set(email, row)
  })
  const names = await staffNames([...byAdder.keys()])
  const adders = [...byAdder.values()].map((r) => ({ ...r, name: names.get(r.email) ?? r.email })).sort((a, b) => b.added - a.added || a.name.localeCompare(b.name))

  // VA demand.
  const service = new Map<string, number>()
  const schedule = new Map<string, number>()
  const group = new Map<string, number>()
  const region = new Map<string, number>()
  for (const r of requests) {
    bump(service, r.service, r.numberOfVas)
    bump(schedule, r.scheduleType, r.numberOfVas)
    bump(group, r.requestGroup, r.numberOfVas)
    bump(region, r.ticket.account.contacts[0]?.region || 'Not given', r.numberOfVas)
  }

  return {
    funnel,
    activeWithoutForm,
    periods: [...periods.values()],
    adders,
    demand: {
      vas: requests.reduce((n, r) => n + r.numberOfVas, 0),
      forms: new Set(requests.map((r) => r.ticket.id)).size,
      customers: new Set(requests.map((r) => r.ticket.customerId)).size,
      byService: sortedRows(service),
      bySchedule: fixedRows(SCHEDULE_TYPES, SCHEDULE_LABELS, schedule),
      byGroup: fixedRows(REQUEST_GROUPS, REQUEST_GROUP_LABELS, group),
      byRegion: sortedRows(region),
    },
  }
}
