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

// The customer's time zone (required): every IANA zone the runtime knows,
// labelled by its current UTC offset, e.g. "(UTC+08:00) Asia/Manila". Fixed
// shift times are entered in this zone and converted to Philippine time.
export const PHT_ZONE = 'Asia/Manila'
const PHT_OFFSET_MINUTES = 8 * 60

// Minutes east of UTC for a zone at a moment, e.g. 480 for Asia/Manila.
export function zoneOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

export function utcOffsetLabel(minutes: number) {
  const abs = Math.abs(minutes)
  return `UTC${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

export function isTimeZone(value: string) {
  if (!value) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function timeZoneLabel(timeZone: string, at: Date = new Date()) {
  return isTimeZone(timeZone) ? `(${utcOffsetLabel(zoneOffsetMinutes(timeZone, at))}) ${timeZone.replace(/_/g, ' ')}` : timeZone
}

export type TimeZoneOption = { value: string; label: string }

// Sorted west to east, then by name. Built on the server and passed to the
// form, so the list the page renders matches the one it hydrates.
export function timeZoneOptions(at: Date = new Date()): TimeZoneOption[] {
  return Intl.supportedValuesOf('timeZone')
    .map((value) => ({ value, offset: zoneOffsetMinutes(value, at) }))
    .sort((a, b) => a.offset - b.offset || a.value.localeCompare(b.value))
    .map(({ value, offset }) => ({ value, label: `(${utcOffsetLabel(offset)}) ${value.replace(/_/g, ' ')}` }))
}

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

// "Work Hour Type" (Google: Initial Project Hours | Daily | Weekly, plus
// Monthly from the Oct 26 meeting), with daily split into fixed and flexible
// time, which the Google Form asks in a free-text schedule. Daily fixed has
// set start and end times; project is a total number of hours.
export const SCHEDULE_TYPES = ['PROJECT', 'DAILY_FIXED', 'DAILY_FLEXIBLE', 'WEEKLY_FLEXIBLE', 'MONTHLY'] as const
export type ScheduleType = (typeof SCHEDULE_TYPES)[number]
export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  PROJECT: 'Initial project hours',
  DAILY_FIXED: 'Daily, fixed time',
  DAILY_FLEXIBLE: 'Daily, flexible time',
  WEEKLY_FLEXIBLE: 'Weekly',
  MONTHLY: 'Monthly',
}
export const SCHEDULE_HINTS: Record<ScheduleType, string> = {
  PROJECT: 'A total number of hours for a project (e.g. 20 project hours).',
  DAILY_FIXED: 'Set start and end times every work day, in your time zone.',
  DAILY_FLEXIBLE: 'A set number of hours a day (e.g. 5 hours daily), worked any time that day.',
  WEEKLY_FLEXIBLE: 'A set number of hours a week (e.g. 40 hours weekly), worked any time.',
  MONTHLY: 'A set number of hours a month (e.g. 80 hours monthly), worked any time.',
}

// Minimum hours per work hour type. Admins change them in Settings; there
// is no maximum. Defaults from the Oct 26 meeting: 3 h a day, 15 h a week
// (3 h x 5 days), 60 h a month (3 h x 21 days), 15 project hours.
export const MINIMUM_KEYS = ['hoursPerDay', 'hoursPerWeek', 'hoursPerMonth', 'projectHours'] as const
export type WorkHourMinimums = Record<(typeof MINIMUM_KEYS)[number], number>
export const DEFAULT_MINIMUMS: WorkHourMinimums = { hoursPerDay: 3, hoursPerWeek: 15, hoursPerMonth: 60, projectHours: 15 }
export const MINIMUM_LABELS: Record<keyof WorkHourMinimums, string> = {
  hoursPerDay: 'Hours a day (daily fixed and daily flexible)',
  hoursPerWeek: 'Hours a week (weekly, and daily hours times work days)',
  hoursPerMonth: 'Hours a month (monthly)',
  projectHours: 'Project hours (initial project hours)',
}
export const minimumsSchema = z.object(
  Object.fromEntries(MINIMUM_KEYS.map((k) => [k, z.number('Enter a number.').min(0, 'Use 0 or more.').max(1000, 'Use 1,000 or less.')])) as Record<
    keyof WorkHourMinimums,
    z.ZodNumber
  >
)

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

const TIME_RE = /^\d{2}:\d{2}$/

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

const wrap = (minutes: number) => ((minutes % 1440) + 1440) % 1440
const toHhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

// The moment offsets are taken at: noon UTC on the target start date when
// there is one (so daylight saving matches the start), else now.
function offsetMoment(dateIso?: string) {
  return dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? new Date(`${dateIso}T12:00:00Z`) : new Date()
}

// A wall-clock HH:MM in the customer's zone as Philippine time, and back.
export function zoneTimeToPht(hhmm: string, timeZone: string, dateIso?: string) {
  if (!TIME_RE.test(hhmm) || !isTimeZone(timeZone)) return hhmm
  return toHhmm(wrap(toMinutes(hhmm) - zoneOffsetMinutes(timeZone, offsetMoment(dateIso)) + PHT_OFFSET_MINUTES))
}
export function phtToZoneTime(hhmm: string, timeZone: string, dateIso?: string) {
  if (!TIME_RE.test(hhmm) || !isTimeZone(timeZone)) return hhmm
  return toHhmm(wrap(toMinutes(hhmm) - PHT_OFFSET_MINUTES + zoneOffsetMinutes(timeZone, offsetMoment(dateIso))))
}

// "America/New York, UTC-05:00": a zone with its offset on a date, for
// labelling times entered for that date.
export function zoneOnDate(timeZone: string, dateIso?: string) {
  return isTimeZone(timeZone) ? `${timeZone.replace(/_/g, ' ')}, ${utcOffsetLabel(zoneOffsetMinutes(timeZone, offsetMoment(dateIso)))}` : timeZone
}

// "17:00" -> "5:00 PM".
export function time12(hhmm: string) {
  if (!TIME_RE.test(hhmm)) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// ── Validation ───────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max)
const required = (label: string, max = 200) => text(max).min(1, `Enter ${label}.`)
const isEmail = (v: string) => z.email().safeParse(v).success
const PHONE_RE = /^\+?[0-9 ()-]{7,}$/

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
      timeZone: text(60).refine(isTimeZone, 'Choose your time zone.'),
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
      platforms: z.array(z.enum(PLATFORMS)),
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
const hoursOk = (v: number | null, ceiling: number) => v != null && !Number.isNaN(v) && v > 0 && v <= ceiling

export type MinimumField = 'hoursPerDay' | 'hoursPerWeek' | 'hoursPerMonth' | 'projectHours' | 'endTimePht' | 'workDays'

// Below-minimum problems for one VA service, by field: the form outlines
// those fields in red as the customer types, and the schema rejects them.
// Hours are only capped by what fits in a day, week or month.
export function minimumIssues(
  r: Pick<VaRequest, 'scheduleType' | 'hoursPerDay' | 'hoursPerWeek' | 'hoursPerMonth' | 'projectHours' | 'startTimePht' | 'endTimePht' | 'workDays'> | VaRequestDraft,
  min: WorkHourMinimums
): Partial<Record<MinimumField, string>> {
  const issues: Partial<Record<MinimumField, string>> = {}
  let perDay: number | null = null
  if (r.scheduleType === 'DAILY_FLEXIBLE' && r.hoursPerDay != null && !Number.isNaN(r.hoursPerDay)) {
    if (r.hoursPerDay < min.hoursPerDay) issues.hoursPerDay = `The minimum is ${min.hoursPerDay} hours a day.`
    else perDay = r.hoursPerDay
  }
  if (r.scheduleType === 'DAILY_FIXED' && TIME_RE.test(r.startTimePht) && TIME_RE.test(r.endTimePht)) {
    const h = shiftHours(r.startTimePht, r.endTimePht)
    if (h < min.hoursPerDay) issues.endTimePht = `That’s ${h} hour${h === 1 ? '' : 's'}. The minimum is ${min.hoursPerDay} hours a day.`
    else perDay = h
  }
  if (perDay != null && r.workDays.length > 0 && perDay * r.workDays.length < min.hoursPerWeek) {
    issues.workDays = `That’s ${perDay * r.workDays.length} hours a week. The minimum is ${min.hoursPerWeek} hours a week.`
  }
  if (r.scheduleType === 'WEEKLY_FLEXIBLE' && r.hoursPerWeek != null && r.hoursPerWeek < min.hoursPerWeek) issues.hoursPerWeek = `The minimum is ${min.hoursPerWeek} hours a week.`
  if (r.scheduleType === 'MONTHLY' && r.hoursPerMonth != null && r.hoursPerMonth < min.hoursPerMonth) issues.hoursPerMonth = `The minimum is ${min.hoursPerMonth} hours a month.`
  if (r.scheduleType === 'PROJECT' && r.projectHours != null && r.projectHours < min.projectHours) issues.projectHours = `The minimum is ${min.projectHours} project hours.`
  return issues
}

export function vaRequestSchemaFor(min: WorkHourMinimums) {
  return z
    .object({
      service: z.enum(SERVICE_OFFERINGS, 'Choose a service offering.'),
      numberOfVas: z.number('Enter how many VAs.').int('Use a whole number of VAs.').min(1, 'At least 1 VA.').max(50),
      targetStartDate: text(10).refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Choose a target start date.'),
      scheduleType: z.enum(SCHEDULE_TYPES, 'Choose a work hour type.'),
      hoursPerWeek: optionalNumber,
      hoursPerDay: optionalNumber,
      hoursPerMonth: optionalNumber,
      projectHours: optionalNumber,
      // Philippine time; the customer enters them in their own zone.
      startTimePht: text(5),
      endTimePht: text(5),
      workDays: z.array(z.enum(WORK_DAYS)).max(7),
      additionalHours: text(200),
      taskTracker: z.boolean().nullable(),
      tasks: text(2000),
      tools: text(1000),
    })
    .superRefine((r, ctx) => {
      const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
      const daily = r.scheduleType === 'DAILY_FIXED' || r.scheduleType === 'DAILY_FLEXIBLE'
      if (daily && r.workDays.length === 0) issue('workDays', 'Choose the work days.')
      if (r.scheduleType === 'DAILY_FLEXIBLE' && !hoursOk(r.hoursPerDay, 24)) issue('hoursPerDay', 'Enter the work hours per day.')
      if (r.scheduleType === 'DAILY_FIXED' && (!TIME_RE.test(r.startTimePht) || !TIME_RE.test(r.endTimePht))) issue('startTimePht', 'Enter the start and end time.')
      if (r.scheduleType === 'WEEKLY_FLEXIBLE' && !hoursOk(r.hoursPerWeek, 168)) issue('hoursPerWeek', 'Enter the work hours per week.')
      if (r.scheduleType === 'MONTHLY' && !hoursOk(r.hoursPerMonth, 744)) issue('hoursPerMonth', 'Enter the work hours per month.')
      if (r.scheduleType === 'PROJECT' && !hoursOk(r.projectHours, 10000)) issue('projectHours', 'Enter the number of project hours.')
      for (const [path, message] of Object.entries(minimumIssues(r, min))) issue(path, message)
    })
}

export function part2SchemaFor(min: WorkHourMinimums) {
  return z.object({ requests: z.array(vaRequestSchemaFor(min)).min(1, 'Add at least one VA service.').max(20) })
}

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

export function onboardingSchemaFor(min: WorkHourMinimums) {
  return z.object({ part1: part1Schema, part2: part2SchemaFor(min), part3: part3Schema })
}

export type Part1 = z.infer<typeof part1Schema>
export type VaRequest = z.infer<ReturnType<typeof vaRequestSchemaFor>>
export type Part3Answers = z.infer<typeof part3AnswersSchema>
export type OnboardingInput = z.infer<ReturnType<typeof onboardingSchemaFor>>

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
    hoursPerMonth: null,
    projectHours: null,
    // 8:00 AM to 5:00 PM Philippine time, as agreed on Oct 26.
    startTimePht: '08:00',
    endTimePht: '17:00',
    workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    additionalHours: '',
    taskTracker: null,
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
