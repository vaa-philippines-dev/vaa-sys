import { z } from 'zod'

// Client-safe: the customer onboarding form, asking the same questions as
// VAA's Google Form "CUSTOMER ONBOARDING FORM". Part 1 is the customer
// profile (contacts, company, platforms, invoicing, payment); Part 2 is the
// skill requirements, one VA request per service, which become sub-tickets;
// Part 3 is the optional VA personality preference, which can also be filled
// in later on the same link. Wording and option lists are the Google Form's
// own (read from the live form on Oct 26, 2026) — change them here and the
// form follows.

// "Primary Contact Region of Residence". Israel gets the NIS payment options.
export const REGIONS = ['The Americas', 'Europe', 'Israel', 'Middle East', 'Asia-Pacific'] as const
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
  'Ebay',
  'Etsy',
  'Own Site',
  'Social Media (Facebook, Instagram, LinkedIn)',
  'Tiktok Shop',
  'Other',
] as const
export type Platform = (typeof PLATFORMS)[number]

// "VA - Service Offering".
export const SERVICE_OFFERINGS = [
  'Amazon - Virtual Assistant',
  'Wholesale - Virtual Assistant',
  'PPC - Virtual Assistant',
  'Social Media - Virtual Assistant',
  'Executive Assistant - Virtual Assistant',
  'Walmart - Virtual Assistant',
  'Creatives - Graphic Designer',
  'Creatives - Video Editor',
  'Creatives - Copywriter',
  'Shopify VA',
] as const

// "Work Hour Type" (Google: Initial Project Hours | Daily | Weekly), with
// daily split into fixed and flexible time, which the Google Form asks in a
// free-text schedule. Daily fixed has set Philippine-time start and end
// times; project is a total number of hours.
export const SCHEDULE_TYPES = ['PROJECT', 'DAILY_FIXED', 'DAILY_FLEXIBLE', 'WEEKLY_FLEXIBLE'] as const
export type ScheduleType = (typeof SCHEDULE_TYPES)[number]
export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  PROJECT: 'Initial project hours',
  DAILY_FIXED: 'Daily, fixed time',
  DAILY_FLEXIBLE: 'Daily, flexible time',
  WEEKLY_FLEXIBLE: 'Weekly',
}
export const SCHEDULE_HINTS: Record<ScheduleType, string> = {
  PROJECT: 'A total number of hours for a project (e.g. 20 project hours).',
  DAILY_FIXED: 'Set start and end times every work day, in Philippine time.',
  DAILY_FLEXIBLE: 'A set number of hours a day (e.g. 5 hours daily), worked any time that day.',
  WEEKLY_FLEXIBLE: 'A set number of hours a week (e.g. 40 hours weekly), worked any time.',
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

// Part 3, VA personality preference: ten scenarios, each with four
// statements the customer rates from 1 (least preferred) to 5 (most
// preferred). The statements are always in the same order, which reads as
// the DISC styles: D (takes charge), I (engages people), S (supports),
// C (analyzes).
export const PART3_STYLES = ['D', 'I', 'S', 'C'] as const
export const PART3_STYLE_LABELS: Record<(typeof PART3_STYLES)[number], string> = {
  D: 'Takes charge',
  I: 'Engages people',
  S: 'Supports others',
  C: 'Analyzes and plans',
}
export const PART3_MIN = 1
export const PART3_MAX = 5

export const PART3_SCENARIOS = [
  {
    id: 's1',
    prompt: 'When faced with a challenge, you’d prefer your VA to:',
    statements: ['Take charge and lead the effort', 'Encourage collaboration and maintain a positive atmosphere', 'Offer support and help to others', 'Analyze the problem and develop a detailed plan'],
  },
  {
    id: 's2',
    prompt: 'In social settings, you prefer your VA to:',
    statements: ['Direct the conversation and make decisions', 'Engage others by fostering a positive, collaborative vibe', 'Listen and provide support', 'Observe and think before speaking'],
  },
  {
    id: 's3',
    prompt: 'You prefer your VA’s work style to be best described as:',
    statements: ['Fast-paced and goal-oriented', 'Creative and spontaneous', 'Steady and dependable', 'Methodical and detail-oriented'],
  },
  {
    id: 's4',
    prompt: 'When working in a team, you prefer your VA to:',
    statements: ['Take the lead and assign tasks', 'Promote a positive and engaging team dynamic', 'Support team cohesion and collaboration', 'Focus on organizing and planning'],
  },
  {
    id: 's5',
    prompt: 'In decision-making, you prefer your VA to:',
    statements: ['Are quick and decisive', 'Consider how the decision will affect relationships', 'Seek consensus and input from others', 'Gather all the facts and analyze thoroughly'],
  },
  {
    id: 's6',
    prompt: 'Under stress, you prefer your VA to:',
    statements: ['Become more assertive and determined', 'Seek out social interactions for support', 'Look for ways to help and support others', 'Retreat to plan and analyze the situation'],
  },
  {
    id: 's7',
    prompt: 'You prefer your VA to approach new tasks by:',
    statements: ['Jumping in and take charge', 'Brainstorming creative ideas', 'Considering team needs and collaboration', 'Developing a detailed plan before starting'],
  },
  {
    id: 's8',
    prompt: 'In conflict situations, you prefer your VA to:',
    statements: ['Stand your ground and assert your position', 'Maintain composure and promote a calm, respectful atmosphere', 'Mediate and seek a peaceful resolution', 'Look for logical solutions and facts'],
  },
  {
    id: 's9',
    prompt: 'When presented with a new idea, you prefer your VA to:',
    statements: [
      'Evaluate how it aligns with goals and take action',
      'Encourage enthusiasm and open discussion among the team',
      'Consider how it impacts collaboration across teams',
      'Analyze its feasibility and potential impact',
    ],
  },
  {
    id: 's10',
    prompt: 'You prefer your VA to handle feedback by:',
    statements: [
      'Accepting it as a challenge to improve',
      'Using it to foster open communication and team rapport',
      'Listening and providing supportive responses',
      'Carefully reviewing and use it to make systematic improvements',
    ],
  },
] as const

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
      // Asked of everyone except customers in Israel, as in the Google Form.
      hasPayoneerOrWise: z.boolean().nullable(),
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
    if (v.primary.region !== 'Israel' && v.payment.hasPayoneerOrWise == null) {
      issue(['payment', 'hasPayoneerOrWise'], 'Tell us whether you have an active Payoneer or Wise account.')
    }
    if (v.payment.method === 'OTHER' && !v.payment.methodOther) issue(['payment', 'methodOther'], 'Enter the payment method you’d like to use.')
    if (v.payment.method === 'CREDIT_CARD' && !v.payment.billingCountry) issue(['payment', 'billingCountry'], 'Enter your country and state of residence for credit card payment.')
  })

const optionalNumber = z.number().nullable()
const inRange = (v: number | null, min: number, max: number) => v != null && !Number.isNaN(v) && v >= min && v <= max

export const vaRequestSchema = z
  .object({
    service: z.enum(SERVICE_OFFERINGS, 'Choose a service offering.'),
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

// Part 3 ratings keyed by scenario id: one rating per statement, in order.
export const part3AnswersSchema = z
  .record(z.string(), z.array(z.number().int().min(PART3_MIN).max(PART3_MAX).nullable()).length(PART3_STYLES.length))
  .superRefine((answers, ctx) => {
    PART3_SCENARIOS.forEach((s, i) => {
      if (!answers[s.id] || answers[s.id].some((r) => r == null)) ctx.addIssue({ code: 'custom', path: [s.id], message: `Rate all four statements in scenario ${i + 1}.` })
    })
    const known = new Set<string>(PART3_SCENARIOS.map((s) => s.id))
    if (Object.keys(answers).some((k) => !known.has(k))) ctx.addIssue({ code: 'custom', path: [], message: 'Check your answers and try again.' })
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
  payment: Omit<Part1['payment'], 'method'> & { method: PaymentMethod | '' }
}
export type VaRequestDraft = Omit<VaRequest, 'service' | 'scheduleType'> & { service: VaRequest['service'] | ''; scheduleType: ScheduleType | '' }

export function emptyPart1(prefillEmail?: string | null): Part1Draft {
  return {
    primary: { firstName: '', lastName: '', role: '', email: prefillEmail ?? '', whatsapp: '', region: '' },
    focalContact: 'PRIMARY',
    company: { companyName: '', dbaName: '', businessAddress: '', website: '', timeZone: '' },
    hasSecondary: false,
    secondary: { firstName: '', lastName: '', role: '', email: '', whatsapp: '' },
    business: { platforms: [], platformOther: '', otherInfo: '' },
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

export function emptyPart3(): Part3Answers {
  return Object.fromEntries(PART3_SCENARIOS.map((s) => [s.id, PART3_STYLES.map(() => null)]))
}

// Each style's total across the ten scenarios (10 to 50), for the lead page.
export function part3Totals(answers: Part3Answers) {
  return PART3_STYLES.map((style, i) => ({ style, total: PART3_SCENARIOS.reduce((sum, s) => sum + (answers[s.id]?.[i] ?? 0), 0) }))
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
