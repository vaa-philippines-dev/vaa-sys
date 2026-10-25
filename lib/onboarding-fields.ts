import { z } from 'zod'

// Client-safe: the customer onboarding form from the Oct 21 meeting with
// Ian. Part 1 is the account profile (contacts, company, invoicing, payment);
// Part 2 is the VA requests, which become sub-tickets. Option lists are
// drafts until Ian's current Google form arrives — change them here and the
// form follows.

export const REGIONS = [
  'United States',
  'Canada',
  'United Kingdom',
  'Israel',
  'Rest of Europe',
  'Middle East',
  'Asia Pacific',
  'Other',
] as const
export type Region = (typeof REGIONS)[number]

// The customer's own time zone, for context. Working hours are always
// entered in Philippine time.
export const TIME_ZONES = [
  { value: 'America/New_York', label: 'US Eastern (New York)' },
  { value: 'America/Chicago', label: 'US Central (Chicago)' },
  { value: 'America/Denver', label: 'US Mountain (Denver)' },
  { value: 'America/Los_Angeles', label: 'US Pacific (Los Angeles)' },
  { value: 'Europe/London', label: 'UK (London)' },
  { value: 'Europe/Berlin', label: 'Central Europe (Berlin, Paris)' },
  { value: 'Asia/Jerusalem', label: 'Israel' },
  { value: 'Asia/Dubai', label: 'Gulf (Dubai)' },
  { value: 'Australia/Sydney', label: 'Australia (Sydney)' },
  { value: 'Asia/Manila', label: 'Philippines' },
  { value: 'Other', label: 'Other' },
] as const
export const TIME_ZONE_LABELS: Record<string, string> = Object.fromEntries(TIME_ZONES.map((t) => [t.value, t.label]))

export const PAYMENT_METHODS = ['NIS_BANK_TRANSFER', 'PAYONEER', 'WISE', 'CREDIT_CARD'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  NIS_BANK_TRANSFER: 'Bank transfer in NIS',
  PAYONEER: 'Payoneer',
  WISE: 'Wise',
  CREDIT_CARD: 'Credit card',
}
// NIS bank transfer is only offered to customers in Israel.
export function paymentMethodsFor(region: string): PaymentMethod[] {
  return region === 'Israel' ? [...PAYMENT_METHODS] : PAYMENT_METHODS.filter((m) => m !== 'NIS_BANK_TRANSFER')
}

export const INVOICE_SOURCES = ['PRIMARY', 'SECONDARY', 'OTHER'] as const
export type InvoiceSource = (typeof INVOICE_SOURCES)[number]

export const PLATFORMS = ['Amazon', 'Walmart', 'Shopify', 'eBay', 'TikTok Shop', 'Etsy', 'Other'] as const

export const SCHEDULE_TYPES = ['WEEKLY_FLEXIBLE', 'DAILY_FLEXIBLE', 'DAILY_FIXED'] as const
export type ScheduleType = (typeof SCHEDULE_TYPES)[number]
export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  WEEKLY_FLEXIBLE: 'Weekly flexible',
  DAILY_FLEXIBLE: 'Daily flexible',
  DAILY_FIXED: 'Daily fixed',
}
export const SCHEDULE_HINTS: Record<ScheduleType, string> = {
  WEEKLY_FLEXIBLE: 'A set number of hours a week (e.g. 40), worked any time.',
  DAILY_FLEXIBLE: 'A set number of hours a day (e.g. 8), worked any time that day.',
  DAILY_FIXED: 'Set start and end times every work day, in Philippine time.',
}

export const WORK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const REQUEST_GROUPS = ['REGULAR', 'EXPERT', 'CASUAL'] as const
export type RequestGroup = (typeof REQUEST_GROUPS)[number]
export const REQUEST_GROUP_LABELS: Record<RequestGroup, string> = { REGULAR: 'Regular', EXPERT: 'Expert', CASUAL: 'Casual' }

// Used only when the service list can't be read from va-management.
export const FALLBACK_SERVICES = ['Amazon', 'Creatives', 'Executive Assistant', 'PPC', 'Social Media', 'Walmart', 'Wholesale']

// ── Philippine-time shift maths ──────────────────────────────────

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Length of a fixed shift in hours; an end before the start runs past midnight.
export function shiftHours(start: string, end: string): number {
  const s = toMinutes(start)
  let e = toMinutes(end)
  if (e <= s) e += 24 * 60
  return (e - s) / 60
}

// Hours of a fixed shift inside the Philippine night-differential window,
// 10:00 PM to 6:00 AM.
export function nightDifferentialHours(start: string, end: string): number {
  const s = toMinutes(start)
  let e = toMinutes(end)
  if (e <= s) e += 24 * 60
  const windows = [
    [0, 6 * 60],
    [22 * 60, 30 * 60],
    [46 * 60, 54 * 60],
  ]
  const overlap = windows.reduce((sum, [ws, we]) => sum + Math.max(0, Math.min(e, we) - Math.max(s, ws)), 0)
  return overlap / 60
}

// ── Validation ───────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max)
const required = (label: string, max = 200) => text(max).min(1, `Enter ${label}.`)
const isEmail = (v: string) => z.email().safeParse(v).success
const PHONE_RE = /^\+?[0-9 ()-]{7,}$/
const TIME_RE = /^\d{2}:\d{2}$/

export const part1Schema = z
  .object({
    primary: z.object({
      firstName: required('the primary contact’s first name'),
      lastName: required('the primary contact’s last name'),
      role: required('the primary contact’s role, e.g. Owner'),
      email: text(200).refine(isEmail, 'Enter the primary contact’s email.'),
      whatsapp: text(40).refine((v) => PHONE_RE.test(v), 'Enter the primary contact’s WhatsApp number with country code, e.g. +1 555 123 4567.'),
      region: z.enum(REGIONS, 'Choose where the primary contact lives.'),
    }),
    company: z.object({
      companyName: required('the company name'),
      dbaName: text(200),
      website: text(300),
      timeZone: text(60),
    }),
    hasSecondary: z.boolean(),
    secondary: z.object({
      firstName: text(200),
      lastName: text(200),
      role: text(200),
      email: text(200),
      whatsapp: text(40),
    }),
    focalContact: z.enum(['PRIMARY', 'SECONDARY']),
    invoice: z.object({
      source: z.enum(INVOICE_SOURCES),
      name: text(200),
      email: text(200),
    }),
    payment: z.object({
      method: z.enum(PAYMENT_METHODS, 'Choose how you’ll pay.'),
      billingCountry: text(100),
    }),
  })
  .superRefine((v, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    if (v.hasSecondary) {
      if (!v.secondary.firstName) issue(['secondary', 'firstName'], 'Enter the secondary contact’s first name, or remove the secondary contact.')
      if (!v.secondary.lastName) issue(['secondary', 'lastName'], 'Enter the secondary contact’s last name.')
      if (!isEmail(v.secondary.email)) issue(['secondary', 'email'], 'Enter the secondary contact’s email.')
      if (v.secondary.whatsapp && !PHONE_RE.test(v.secondary.whatsapp)) issue(['secondary', 'whatsapp'], 'Enter the secondary contact’s WhatsApp number with country code.')
    } else {
      if (v.focalContact === 'SECONDARY') issue(['focalContact'], 'Add a secondary contact, or choose the primary contact as the main person.')
      if (v.invoice.source === 'SECONDARY') issue(['invoice', 'source'], 'Add a secondary contact, or choose who invoices go to.')
    }
    if (v.invoice.source === 'OTHER') {
      if (!v.invoice.name) issue(['invoice', 'name'], 'Enter the name of the person invoices go to.')
      if (!isEmail(v.invoice.email)) issue(['invoice', 'email'], 'Enter the email invoices go to.')
    }
    if (v.company.website && !/^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(v.company.website)) issue(['company', 'website'], 'Enter the website as an address, e.g. https://example.com.')
    if (!paymentMethodsFor(v.primary.region).includes(v.payment.method)) issue(['payment', 'method'], 'Bank transfer in NIS is only for customers in Israel. Choose another payment method.')
  })

const optionalNumber = z.number().nullable()

export const vaRequestSchema = z
  .object({
    platform: z.enum(PLATFORMS, 'Choose the platform the VA will work on.'),
    service: required('the service', 100),
    numberOfVas: z.number('Enter how many VAs.').int('Use a whole number of VAs.').min(1, 'At least 1 VA.').max(50),
    scheduleType: z.enum(SCHEDULE_TYPES, 'Choose a schedule type.'),
    hoursPerWeek: optionalNumber,
    hoursPerDay: optionalNumber,
    startTimePht: text(5),
    endTimePht: text(5),
    workDays: z.array(z.enum(WORK_DAYS)).max(7),
    additionalHoursPerDay: optionalNumber,
    targetStartDate: text(10).refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Choose a target start date.'),
    tasks: required('the VA’s first tasks', 2000),
    tools: text(1000),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (r.scheduleType === 'WEEKLY_FLEXIBLE') {
      if (r.hoursPerWeek == null || Number.isNaN(r.hoursPerWeek) || r.hoursPerWeek < 1 || r.hoursPerWeek > 60) issue('hoursPerWeek', 'Enter hours per week, between 1 and 60.')
    } else {
      if (r.workDays.length === 0) issue('workDays', 'Choose the work days.')
    }
    if (r.scheduleType === 'DAILY_FLEXIBLE') {
      if (r.hoursPerDay == null || Number.isNaN(r.hoursPerDay) || r.hoursPerDay < 1 || r.hoursPerDay > 12) issue('hoursPerDay', 'Enter hours per day, between 1 and 12.')
    }
    if (r.scheduleType === 'DAILY_FIXED') {
      if (!TIME_RE.test(r.startTimePht) || !TIME_RE.test(r.endTimePht)) issue('startTimePht', 'Enter the start and end time in Philippine time.')
      else if (shiftHours(r.startTimePht, r.endTimePht) > 12) issue('endTimePht', 'A fixed shift can be at most 12 hours.')
    }
    if (r.additionalHoursPerDay != null && (Number.isNaN(r.additionalHoursPerDay) || r.additionalHoursPerDay < 0 || r.additionalHoursPerDay > 8)) {
      issue('additionalHoursPerDay', 'Additional hours must be between 0 and 8 a day.')
    }
  })

export const part2Schema = z.object({
  requests: z.array(vaRequestSchema).min(1, 'Add at least one VA request.').max(20),
})

export const onboardingSchema = z.object({ part1: part1Schema, part2: part2Schema })

export type Part1 = z.infer<typeof part1Schema>
export type VaRequest = z.infer<typeof vaRequestSchema>
export type OnboardingInput = z.infer<typeof onboardingSchema>

// Form state allows blanks the schema rejects, so the selects can start empty.
export type Part1Draft = Omit<Part1, 'primary' | 'payment'> & {
  primary: Omit<Part1['primary'], 'region'> & { region: Region | '' }
  payment: { method: PaymentMethod | ''; billingCountry: string }
}
export type VaRequestDraft = Omit<VaRequest, 'platform' | 'scheduleType'> & {
  platform: VaRequest['platform'] | ''
  scheduleType: ScheduleType | ''
}

export function emptyPart1(prefillEmail?: string | null): Part1Draft {
  return {
    primary: { firstName: '', lastName: '', role: '', email: prefillEmail ?? '', whatsapp: '', region: '' },
    company: { companyName: '', dbaName: '', website: '', timeZone: '' },
    hasSecondary: false,
    secondary: { firstName: '', lastName: '', role: '', email: '', whatsapp: '' },
    focalContact: 'PRIMARY',
    invoice: { source: 'PRIMARY', name: '', email: '' },
    payment: { method: '', billingCountry: '' },
  }
}

export function emptyVaRequest(): VaRequestDraft {
  return {
    platform: '',
    service: '',
    numberOfVas: 1,
    scheduleType: '',
    hoursPerWeek: null,
    hoursPerDay: null,
    startTimePht: '',
    endTimePht: '',
    workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    additionalHoursPerDay: null,
    targetStartDate: '',
    tasks: '',
    tools: '',
  }
}

export function firstIssue(error: z.ZodError, prefix = '') {
  const issue = error.issues[0]
  if (!issue) return 'Check the form and try again.'
  const index = issue.path.find((p) => typeof p === 'number')
  return typeof index === 'number' && prefix ? `${prefix} ${index + 1}: ${issue.message}` : issue.message
}

// How long an onboarding link stays valid.
export const LINK_VALID_DAYS = 14

// Display codes for tickets: TKT-000001 and its sub-tickets TKT-000001-01.
export function ticketCode(ticketNumber: number) {
  return `TKT-${String(ticketNumber).padStart(6, '0')}`
}
export function subTicketCode(ticketNumber: number, lineNo: number) {
  return `${ticketCode(ticketNumber)}-${String(lineNo).padStart(2, '0')}`
}
