import { z } from 'zod'

// Client-safe: the customer onboarding form, asking the same questions as
// VAA's Google Form "CUSTOMER ONBOARDING FORM". Part 1 is the customer
// profile (contacts, company, platforms, invoicing, payment); Part 2 is the
// skill requirements, one VA request per service, which become sub-tickets;
// Part 3 is the optional VA personality preference, which can also be filled
// in later on the same link. Option lists marked "draft" are best guesses
// until the Google Form's own lists arrive — change them here and the form
// follows.

// Draft: the Google Form's "Region of Residence" options.
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

export const PAYMENT_METHODS = ['PAYONEER', 'WISE', 'ACH_TRANSFER', 'SWIFT_TRANSFER', 'CREDIT_CARD', 'NIS_BANK_TRANSFER', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  PAYONEER: 'Payoneer',
  WISE: 'Wise',
  ACH_TRANSFER: 'ACH transfer',
  SWIFT_TRANSFER: 'SWIFT transfer',
  CREDIT_CARD: 'Credit card',
  NIS_BANK_TRANSFER: 'NIS bank transfer',
  OTHER: 'Other',
}
// As in the Google Form: customers in Israel get the NIS section (Payoneer,
// Wise, NIS bank transfer); everyone else gets ACH, SWIFT and credit card.
export function paymentMethodsFor(region: string): PaymentMethod[] {
  return region === 'Israel'
    ? ['PAYONEER', 'WISE', 'NIS_BANK_TRANSFER', 'OTHER']
    : ['PAYONEER', 'WISE', 'ACH_TRANSFER', 'SWIFT_TRANSFER', 'CREDIT_CARD', 'OTHER']
}

export const INVOICE_SOURCES = ['PRIMARY', 'SECONDARY', 'OTHER'] as const
export type InvoiceSource = (typeof INVOICE_SOURCES)[number]

// "Which platforms will the VA work on?", for the whole account.
export const PLATFORMS = [
  'Amazon US',
  'Amazon EU / UK',
  'Amazon (other Marketplace)',
  'Walmart',
  'Shopify',
  'eBay',
  'Etsy',
  'Own Site',
  'Social Media (Facebook, Instagram, LinkedIn)',
  'TikTok Shop',
  'Other',
] as const
export type Platform = (typeof PLATFORMS)[number]

// Draft: the Google Form's FBA/FBM and seller-type options.
export const FULFILLMENT_TYPES = ['FBA', 'FBM', 'Both FBA and FBM', 'Not applicable'] as const
export const SELLER_TYPES = ['Private Label Seller', 'Reseller', 'Both', 'Not applicable'] as const

// "Work Hour Type". Weekly and daily flexible are hours worked any time;
// daily fixed has set Philippine-time start and end times; project is a
// total number of hours.
export const SCHEDULE_TYPES = ['DAILY_FIXED', 'DAILY_FLEXIBLE', 'WEEKLY_FLEXIBLE', 'PROJECT'] as const
export type ScheduleType = (typeof SCHEDULE_TYPES)[number]
export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  DAILY_FIXED: 'Daily, fixed time',
  DAILY_FLEXIBLE: 'Daily, flexible time',
  WEEKLY_FLEXIBLE: 'Weekly, flexible time',
  PROJECT: 'Project hours',
}
export const SCHEDULE_HINTS: Record<ScheduleType, string> = {
  DAILY_FIXED: 'Set start and end times every work day, in Philippine time.',
  DAILY_FLEXIBLE: 'A set number of hours a day (e.g. 5), worked any time that day.',
  WEEKLY_FLEXIBLE: 'A set number of hours a week (e.g. 40), worked any time.',
  PROJECT: 'A total number of hours for a project (e.g. 20).',
}

// The Google Form's limits: 3 to 9 hours a day, 15 to 45 hours a week.
export const MIN_HOURS_PER_DAY = 3
export const MAX_HOURS_PER_DAY = 9
export const MIN_HOURS_PER_WEEK = 15
export const MAX_HOURS_PER_WEEK = 45

export const WORK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const REQUEST_GROUPS = ['REGULAR', 'EXPERT', 'CASUAL'] as const
export type RequestGroup = (typeof REQUEST_GROUPS)[number]
export const REQUEST_GROUP_LABELS: Record<RequestGroup, string> = { REGULAR: 'Regular', EXPERT: 'Expert', CASUAL: 'Casual' }

// Used only when the service list can't be read from va-management.
export const FALLBACK_SERVICES = ['Amazon', 'Creatives', 'Executive Assistant', 'PPC', 'Social Media', 'Walmart', 'Wholesale']

// Part 3, VA personality preference. Placeholder questions until the Google
// Form's own arrive; the form and the lead page render whatever is listed.
type Part3Base = { id: string; label: string; hint?: string; required?: boolean }
export type Part3Question =
  | (Part3Base & { kind: 'text' })
  | (Part3Base & { kind: 'paragraph' })
  | (Part3Base & { kind: 'single'; options: readonly string[] })
  | (Part3Base & { kind: 'multi'; options: readonly string[] })

export const PART3_QUESTIONS: readonly Part3Question[] = [
  {
    id: 'communication',
    label: 'How would you like your VA to communicate with you?',
    kind: 'single',
    options: ['Frequent updates throughout the day', 'A daily summary', 'Only when something needs my attention'],
    required: true,
  },
  {
    id: 'workStyle',
    label: 'Which work style suits you best?',
    kind: 'single',
    options: ['Takes initiative and works independently', 'Follows clear instructions closely', 'A mix of both'],
    required: true,
  },
  {
    id: 'traits',
    label: 'Which traits matter most to you in a VA?',
    kind: 'multi',
    options: ['Detail-oriented', 'Proactive', 'Fast learner', 'Organized', 'Creative', 'Calm under pressure'],
  },
  { id: 'notes', label: 'Anything else about the VA you’d like us to know?', kind: 'paragraph' },
]

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

// A fixed Philippine-time shift shown in the customer's own time zone, e.g.
// ["3:00 PM", "8:00 PM"], so they can check it against their day. The end is
// the start plus the shift length, so both use the same date's offset.
export function phtShiftInZone(start: string, end: string, timeZone: string): [string, string] | null {
  if (!timeZone || timeZone === 'Other' || timeZone === 'Asia/Manila') return null
  const [h, m] = start.split(':').map(Number)
  const now = new Date()
  // Philippine time is UTC+8 all year.
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h - 8, m))
  const to = new Date(from.getTime() + shiftHours(start, end) * 3_600_000)
  try {
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    return [fmt(from), fmt(to)]
  } catch {
    return null
  }
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
      region: z.enum(REGIONS, 'Choose the primary contact’s region of residence.'),
    }),
    focalContact: z.enum(['PRIMARY', 'SECONDARY']),
    company: z.object({
      companyName: required('the company name'),
      dbaName: text(200),
      businessAddress: required('the company business address', 500),
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
    business: z.object({
      platforms: z.array(z.enum(PLATFORMS)).min(1, 'Choose at least one platform the VA will work on.'),
      platformOther: text(200),
      fulfillmentType: z.union([z.enum(FULFILLMENT_TYPES), z.literal('')]),
      sellerType: z.union([z.enum(SELLER_TYPES), z.literal('')]),
      otherInfo: text(2000),
    }),
    invoice: z.object({
      source: z.enum(INVOICE_SOURCES),
      firstName: text(200),
      lastName: text(200),
      role: text(200),
      email: text(200),
    }),
    payment: z.object({
      hasPayoneerOrWise: z.boolean('Tell us whether you have an active Payoneer or Wise account.'),
      method: z.enum(PAYMENT_METHODS, 'Choose a payment method.'),
      methodOther: text(200),
      billingCountry: text(200),
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
      if (v.focalContact === 'SECONDARY') issue(['focalContact'], 'Add the secondary contact, or make the primary contact the focal person.')
      if (v.invoice.source === 'SECONDARY') issue(['invoice', 'source'], 'Add a secondary contact, or choose who invoices go to.')
    }
    if (v.business.platforms.includes('Other') && !v.business.platformOther) issue(['business', 'platformOther'], 'Enter the other platform the VA will work on.')
    if (v.invoice.source === 'OTHER') {
      if (!v.invoice.firstName) issue(['invoice', 'firstName'], 'Enter the invoice contact’s first name.')
      if (!v.invoice.role) issue(['invoice', 'role'], 'Enter the invoice contact’s role.')
      if (!isEmail(v.invoice.email)) issue(['invoice', 'email'], 'Enter the invoice contact’s email.')
    }
    if (v.company.website && !/^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(v.company.website)) issue(['company', 'website'], 'Enter the website as an address, e.g. https://example.com.')
    if (!paymentMethodsFor(v.primary.region).includes(v.payment.method)) {
      issue(['payment', 'method'], v.payment.method === 'NIS_BANK_TRANSFER' ? 'NIS bank transfer is only for customers in Israel. Choose another payment method.' : 'Choose one of the payment methods listed.')
    }
    if (v.payment.method === 'OTHER' && !v.payment.methodOther) issue(['payment', 'methodOther'], 'Enter the payment method you’d like to use.')
    if (v.payment.method === 'CREDIT_CARD' && !v.payment.billingCountry) issue(['payment', 'billingCountry'], 'Enter your country and state of residence for credit card payment.')
  })

const optionalNumber = z.number().nullable()
const inRange = (v: number | null, min: number, max: number) => v != null && !Number.isNaN(v) && v >= min && v <= max

export const vaRequestSchema = z
  .object({
    service: required('the service offering', 100),
    numberOfVas: z.number('Enter how many VAs.').int('Use a whole number of VAs.').min(1, 'At least 1 VA.').max(50),
    targetStartDate: text(10).refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Choose a target start date.'),
    scheduleType: z.enum(SCHEDULE_TYPES, 'Choose a work hour type.'),
    hoursPerWeek: optionalNumber,
    hoursPerDay: optionalNumber,
    projectHours: optionalNumber,
    startTimePht: text(5),
    endTimePht: text(5),
    workDays: z.array(z.enum(WORK_DAYS)).max(7),
    additionalHours: text(200),
    tasks: required('the tasks/requests for your VA', 2000),
    tools: text(1000),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    const daily = r.scheduleType === 'DAILY_FIXED' || r.scheduleType === 'DAILY_FLEXIBLE'
    if (daily && r.workDays.length === 0) issue('workDays', 'Choose the work days.')
    let perDay: number | null = null
    if (r.scheduleType === 'DAILY_FLEXIBLE') {
      if (!inRange(r.hoursPerDay, MIN_HOURS_PER_DAY, MAX_HOURS_PER_DAY)) issue('hoursPerDay', `Enter hours per day, between ${MIN_HOURS_PER_DAY} and ${MAX_HOURS_PER_DAY}.`)
      else perDay = r.hoursPerDay
    }
    if (r.scheduleType === 'DAILY_FIXED') {
      if (!TIME_RE.test(r.startTimePht) || !TIME_RE.test(r.endTimePht)) issue('startTimePht', 'Enter the start and end time in Philippine time.')
      else {
        const h = shiftHours(r.startTimePht, r.endTimePht)
        if (h < MIN_HOURS_PER_DAY || h > MAX_HOURS_PER_DAY) issue('endTimePht', `A fixed shift must be ${MIN_HOURS_PER_DAY} to ${MAX_HOURS_PER_DAY} hours a day.`)
        else perDay = h
      }
    }
    if (perDay != null && r.workDays.length > 0) {
      const week = perDay * r.workDays.length
      if (week < MIN_HOURS_PER_WEEK || week > MAX_HOURS_PER_WEEK) {
        issue('workDays', `That’s ${week} hours a week. The schedule must be ${MIN_HOURS_PER_WEEK} to ${MAX_HOURS_PER_WEEK} hours a week (e.g. 3 to 9 hours a day, 5 days a week).`)
      }
    }
    if (r.scheduleType === 'WEEKLY_FLEXIBLE' && !inRange(r.hoursPerWeek, MIN_HOURS_PER_WEEK, MAX_HOURS_PER_WEEK)) {
      issue('hoursPerWeek', `Enter hours per week, between ${MIN_HOURS_PER_WEEK} and ${MAX_HOURS_PER_WEEK}.`)
    }
    if (r.scheduleType === 'PROJECT' && !inRange(r.projectHours, 1, 2000)) issue('projectHours', 'Enter the number of project hours.')
  })

export const part2Schema = z.object({
  requests: z.array(vaRequestSchema).min(1, 'Add at least one VA service.').max(20),
})

// Answers keyed by question id: a string, or a list for multiple choice.
export const part3AnswersSchema = z.record(z.string(), z.union([text(2000), z.array(text(200)).max(20)])).superRefine((answers, ctx) => {
  for (const q of PART3_QUESTIONS) {
    const a = answers[q.id]
    const empty = a == null || a.length === 0
    if (q.required && empty) ctx.addIssue({ code: 'custom', path: [q.id], message: `Answer “${q.label}”` })
    if (empty || !('options' in q)) continue
    const picked = Array.isArray(a) ? a : [a]
    if (picked.some((p) => !q.options.includes(p))) ctx.addIssue({ code: 'custom', path: [q.id], message: `Choose from the listed answers for “${q.label}”` })
  }
})

export const part3Schema = z.discriminatedUnion('completeNow', [
  z.object({ completeNow: z.literal(true), answers: part3AnswersSchema }),
  z.object({ completeNow: z.literal(false) }),
])

export const onboardingSchema = z.object({ part1: part1Schema, part2: part2Schema, part3: part3Schema })

export type Part1 = z.infer<typeof part1Schema>
export type VaRequest = z.infer<typeof vaRequestSchema>
export type Part3Answers = z.infer<typeof part3AnswersSchema>
export type OnboardingInput = z.infer<typeof onboardingSchema>

// Form state allows blanks the schema rejects, so the selects can start empty.
export type Part1Draft = Omit<Part1, 'primary' | 'payment'> & {
  primary: Omit<Part1['primary'], 'region'> & { region: Region | '' }
  payment: Omit<Part1['payment'], 'method' | 'hasPayoneerOrWise'> & { method: PaymentMethod | ''; hasPayoneerOrWise: boolean | null }
}
export type VaRequestDraft = Omit<VaRequest, 'scheduleType'> & { scheduleType: ScheduleType | '' }

export function emptyPart1(prefillEmail?: string | null): Part1Draft {
  return {
    primary: { firstName: '', lastName: '', role: '', email: prefillEmail ?? '', whatsapp: '', region: '' },
    focalContact: 'PRIMARY',
    company: { companyName: '', dbaName: '', businessAddress: '', website: '', timeZone: '' },
    hasSecondary: false,
    secondary: { firstName: '', lastName: '', role: '', email: '', whatsapp: '' },
    business: { platforms: [], platformOther: '', fulfillmentType: '', sellerType: '', otherInfo: '' },
    invoice: { source: 'PRIMARY', firstName: '', lastName: '', role: '', email: '' },
    payment: { hasPayoneerOrWise: null, method: '', methodOther: '', billingCountry: '' },
  }
}

export function emptyVaRequest(): VaRequestDraft {
  return {
    service: '',
    numberOfVas: 1,
    targetStartDate: '',
    scheduleType: '',
    hoursPerWeek: null,
    hoursPerDay: null,
    projectHours: null,
    startTimePht: '',
    endTimePht: '',
    workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    additionalHours: '',
    tasks: '',
    tools: '',
  }
}

// A stored Part 3 answer as display text.
export function part3AnswerText(a: unknown): string {
  return Array.isArray(a) ? a.join(', ') : typeof a === 'string' ? a : ''
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
