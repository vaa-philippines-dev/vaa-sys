import { z } from 'zod'
import { WORK_DAYS, dayHoursText, hasDayHours, nightDifferentialHours, shiftHours, type DayHours, type ScheduleType } from '@/lib/onboarding-fields'

// Client-safe: how a bill is worked out, its labels and its form schemas.
// The rules are the "Initial Billing Process — Summary & Guide" doc (Oct 26,
// 2026), sections in brackets below:
//   OTF + Deposit + Service Fee + ND Fee − waivers/discounts − Free Hours
//   = Subtotal; + 18% VAT (Israeli clients); + 4.53% PayPal fee on that.
// Server code saves what computeBill returns (lib/billing.ts); the draft
// editor runs the same function to show the totals as the Lead Manager types.

// ── Settings ─────────────────────────────────────────────────────

// The fee defaults a new bill copies (Accounting → Settings). Amounts are in
// the bill's currency; GBP and NIS bills are entered as-is, not converted.
export type BillingDefaults = { otf: number; deposit: number; ndPercent: number; vatPercent: number; paypalPercent: number }
export const BILLING_DEFAULTS: BillingDefaults = { otf: 250, deposit: 250, ndPercent: 10, vatPercent: 18, paypalPercent: 4.53 }
export const BILLING_DEFAULT_LABELS: Record<keyof BillingDefaults, { label: string; hint: string; unit: '$' | '%' }> = {
  otf: { label: 'One-Time Fee', hint: 'Once per department the client requests VAs under.', unit: '$' },
  deposit: { label: 'Deposit Fee', hint: 'Per VA, whatever the department.', unit: '$' },
  ndPercent: { label: 'Night differential', hint: 'Of the hourly rate, per hour between 10 PM and 6 AM PH time.', unit: '%' },
  vatPercent: { label: 'VAT', hint: 'Israeli clients only, on the subtotal.', unit: '%' },
  paypalPercent: { label: 'PayPal fee', hint: 'Clients paying by PayPal, on the total including VAT.', unit: '%' },
}
const amount = (max: number) => z.number('Enter a number.').min(0, 'Use 0 or more.').max(max, `Use ${max.toLocaleString('en-US')} or less.`)
export const billingDefaultsSchema = z.object({
  otf: amount(100000),
  deposit: amount(100000),
  ndPercent: amount(100),
  vatPercent: amount(100),
  paypalPercent: amount(100),
})

export const rateSchema = z.object({
  service: z.string().trim().min(1, 'Pick a service.').max(120),
  hourlyRate: amount(10000),
})

// ── Labels ───────────────────────────────────────────────────────

export const CURRENCIES = ['USD', 'GBP', 'NIS'] as const
export type Currency = (typeof CURRENCIES)[number]
export const CURRENCY_LABELS: Record<Currency, string> = { USD: 'US Dollar (USD)', GBP: 'British Pound (GBP)', NIS: 'Israeli New Shekel (NIS)' }

export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  VOID: 'Void',
}

export type LineKind = 'OTF' | 'OTF_DISCOUNT' | 'DEPOSIT' | 'DEPOSIT_DISCOUNT' | 'SERVICE_FEE' | 'ND_FEE' | 'FREE_HOURS'
export const LINE_KIND_LABELS: Record<LineKind, string> = {
  OTF: 'One-Time Fee',
  OTF_DISCOUNT: 'One-Time Fee discount',
  DEPOSIT: 'Deposit Fee',
  DEPOSIT_DISCOUNT: 'Deposit discount',
  SERVICE_FEE: 'Service Fee',
  ND_FEE: 'Night differential',
  FREE_HOURS: 'Free hours',
}
export type ForegoneType = 'WAIVED' | 'DISCOUNTED' | 'FREE'
export const FOREGONE_LABELS: Record<ForegoneType, string> = { WAIVED: 'Waived', DISCOUNTED: 'Discounted', FREE: 'Free' }

export const invoiceCode = (n: number) => `INV-${String(n).padStart(4, '0')}`

export function formatMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency === 'NIS' ? 'ILS' : currency }).format(value)
}

// 2 decimals, halves away from zero (so 71.9493 → 71.95, as in the doc).
export function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
}

const hoursText = (h: number) => `${Number(h.toFixed(2))} h`

// A payment changes a sent bill's status; drafts and void bills keep theirs.
export function statusAfterPayments(status: InvoiceStatus, total: number, paid: number): InvoiceStatus {
  if (status === 'DRAFT' || status === 'VOID') return status
  if (paid <= 0) return 'SENT'
  return paid + 0.005 >= total ? 'PAID' : 'PARTIALLY_PAID'
}

// ── Departments ──────────────────────────────────────────────────

// Which department each service offering (lib/onboarding-fields.ts) is billed
// under, for the One-Time Fee: Workforce's service departments.
const SERVICE_DEPARTMENTS: Record<string, string> = {
  'Amazon - Virtual Assistant': 'Amazon',
  'Wholesale - Virtual Assistant': 'Wholesale',
  'PPC - Virtual Assistant': 'PPC',
  'Social Media - Virtual Assistant': 'Social Media',
  'Executive Assistant - Virtual Assistant': 'Executive Assistant',
  'Walmart - Virtual Assistant': 'Walmart',
  'Creatives - Graphic Designer': 'Creatives',
  'Creatives - Video Editor': 'Creatives',
  'Creatives - Copywriter': 'Creatives',
  'Shopify VA': 'Shopify',
}
export const CREATIVES = 'Creatives'

export function departmentOf(service: string): string {
  return SERVICE_DEPARTMENTS[service] ?? (service.includes(' - ') ? service.split(' - ')[0].trim() : service)
}

// [1] No OTF for Creatives while every Creatives VA on the bill is
// project-based.
export function otfExempt(department: string, items: { department: string; scheduleType: ScheduleType }[]): boolean {
  const mine = items.filter((i) => i.department === department)
  return department === CREATIVES && mine.length > 0 && mine.every((i) => i.scheduleType === 'PROJECT')
}

// ── First-period hours ───────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function monthEnd(start: string): string {
  const d = parseDay(start)
  return dayKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
}

// The days from start to end (both included) that fall on the VA's work days.
export function countWorkdays(start: string, end: string, workDays: string[]): number {
  const days = new Set(workDays)
  let n = 0
  for (let d = parseDay(start); d <= parseDay(end); d = new Date(d.getTime() + 86_400_000)) if (days.has(DAY_NAMES[d.getUTCDay()])) n++
  return n
}
const calendarDays = (start: string, end: string) => Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / 86_400_000) + 1

export type RequestForBill = {
  scheduleType: ScheduleType
  targetStartDate: string
  hoursPerDay: number | null
  hoursPerWeek: number | null
  hoursPerMonth: number | null
  projectHours: number | null
  startTimePht: string | null
  endTimePht: string | null
  workDays: string[]
  // Hours for each day, Mon..Sun, when the request has them.
  dayHours?: DayHours | null
}

export type FirstPeriod = { periodStart: string; periodEnd: string | null; hours: number; ndHours: number; basis: string }

// [3] What one VA works in the first bill: the workdays from the target
// start date to the end of that month for regular hours, or the project
// hours. [4] Night differential only for fixed times (flexible hours have no
// fixed ND hours; approved ones go on the next bill). Weekly and monthly
// hours aren't in the doc: they're prorated by calendar day, like the legacy
// CMS's projected hours (weekly ÷ 7 × days).
export function firstPeriod(r: RequestForBill): FirstPeriod {
  const start = r.targetStartDate
  const end = monthEnd(start)
  const range = `${shortDay.format(parseDay(start))}–${shortDay.format(parseDay(end))}`
  if (r.scheduleType === 'PROJECT') {
    const h = r.projectHours ?? 0
    return { periodStart: start, periodEnd: null, hours: h, ndHours: 0, basis: `${hoursText(h)} project hours` }
  }
  if (r.scheduleType === 'DAILY_FIXED' || r.scheduleType === 'DAILY_FLEXIBLE') {
    const fixed = r.scheduleType === 'DAILY_FIXED' && !!r.startTimePht && !!r.endTimePht
    const perDay = fixed ? shiftHours(r.startTimePht!, r.endTimePht!) : (r.hoursPerDay ?? 0)
    const ndPerDay = fixed ? nightDifferentialHours(r.startTimePht!, r.endTimePht!) : 0
    // Hours for each day (Nov 6, 2026): each date in the period counts its
    // weekday's hours, so a 4-hour Saturday bills 4 hours.
    if (hasDayHours(r.dayHours)) {
      const byDay = new Map(WORK_DAYS.map((day, i) => [day as string, r.dayHours![i] ?? 0]))
      let hours = 0
      let days = 0
      for (let d = parseDay(start); d <= parseDay(end); d = new Date(d.getTime() + 86_400_000)) {
        const h = byDay.get(DAY_NAMES[d.getUTCDay()]) ?? 0
        if (h > 0) {
          hours += h
          days++
        }
      }
      return {
        periodStart: start,
        periodEnd: end,
        hours: round2(hours),
        ndHours: round2(ndPerDay * days),
        basis: `${dayHoursText(r.dayHours)} over ${days} workday${days === 1 ? '' : 's'} (${range})${ndPerDay ? `, ${hoursText(ndPerDay)} a day in ND` : ''}`,
      }
    }
    const days = countWorkdays(start, end, r.workDays)
    return {
      periodStart: start,
      periodEnd: end,
      hours: round2(perDay * days),
      ndHours: round2(ndPerDay * days),
      basis: `${hoursText(perDay)} × ${days} workday${days === 1 ? '' : 's'} (${range})${ndPerDay ? `, ${hoursText(ndPerDay)} a day in ND` : ''}`,
    }
  }
  const days = calendarDays(start, end)
  if (r.scheduleType === 'WEEKLY_FLEXIBLE') {
    const w = r.hoursPerWeek ?? 0
    return { periodStart: start, periodEnd: end, hours: round2((w / 7) * days), ndHours: 0, basis: `${hoursText(w)} a week ÷ 7 × ${days} days (${range})` }
  }
  const m = r.hoursPerMonth ?? 0
  const inMonth = calendarDays(`${start.slice(0, 8)}01`, end)
  return { periodStart: start, periodEnd: end, hours: round2((m * days) / inMonth), ndHours: 0, basis: `${hoursText(m)} a month × ${days}/${inMonth} days (${range})` }
}

// ── The bill ─────────────────────────────────────────────────────

export type BillSettings = BillingDefaults & { applyVat: boolean; applyPaypalFee: boolean }
export type BillItem = {
  lineNo: number
  service: string
  department: string
  scheduleType: ScheduleType
  numberOfVas: number
  hourlyRate: number
  hours: number
  ndHours: number
  freeHours: number
  freeHoursRef: string | null
  depositDiscountPercent: number
  depositApprovalRef: string | null
}
export type BillDepartment = { department: string; exempt: boolean; discountPercent: number; approvalRef: string | null }
export type BillLine = {
  lineNo: number
  kind: LineKind
  description: string
  calculation: string
  amount: number
  department: string | null
  foregoneAmount: number
  foregoneType: ForegoneType | null
  approvalRef: string | null
}
export type Bill = { lines: BillLine[]; subtotal: number; vatAmount: number; paypalFeeAmount: number; total: number; foregone: number }

const pctText = (p: number) => `${Number(p.toFixed(2))}%`

export function computeBill(s: BillSettings, items: BillItem[], departments: BillDepartment[], currency: Currency): Bill {
  const money = (n: number) => formatMoney(n, currency)
  const lines: Omit<BillLine, 'lineNo'>[] = []
  const reduction = (kind: LineKind, description: string, calculation: string, value: number, type: ForegoneType, ref: string | null, department: string | null) =>
    lines.push({ kind, description, calculation, amount: -value, department, foregoneAmount: value, foregoneType: type, approvalRef: ref })
  // The same service twice gets its request number, so lines stay apart.
  const twice = new Set(items.map((i) => i.service).filter((sv, i, all) => all.indexOf(sv) !== i))
  const label = (i: BillItem) => `${i.service}${twice.has(i.service) ? ` #${i.lineNo}` : ''}`
  const vas = (i: BillItem) => (i.numberOfVas > 1 ? ` × ${i.numberOfVas} VAs` : '')

  // [1] One-Time Fee, per department, then its CEO-approved discount.
  for (const d of departments) {
    if (d.exempt) {
      lines.push({ kind: 'OTF', description: `One-Time Fee — ${d.department}`, calculation: 'Project-based only, so exempt', amount: 0, department: d.department, foregoneAmount: 0, foregoneType: null, approvalRef: null })
      continue
    }
    lines.push({ kind: 'OTF', description: `One-Time Fee — ${d.department}`, calculation: `1 department × ${money(s.otf)}`, amount: s.otf, department: d.department, foregoneAmount: 0, foregoneType: null, approvalRef: null })
    const off = round2((s.otf * d.discountPercent) / 100)
    if (off > 0) {
      const waived = d.discountPercent >= 100
      reduction('OTF_DISCOUNT', `One-Time Fee ${waived ? 'waived' : 'discount'} — ${d.department} (CEO-approved)`, `${money(s.otf)} × ${pctText(d.discountPercent)}`, off, waived ? 'WAIVED' : 'DISCOUNTED', d.approvalRef, d.department)
    }
  }
  // [2] Deposit Fee, per VA.
  for (const i of items) {
    const full = round2(s.deposit * i.numberOfVas)
    lines.push({ kind: 'DEPOSIT', description: `Deposit Fee — ${label(i)}`, calculation: `${i.numberOfVas} VA${i.numberOfVas === 1 ? '' : 's'} × ${money(s.deposit)}`, amount: full, department: i.department, foregoneAmount: 0, foregoneType: null, approvalRef: null })
    const off = round2((full * i.depositDiscountPercent) / 100)
    if (off > 0) {
      const waived = i.depositDiscountPercent >= 100
      reduction('DEPOSIT_DISCOUNT', `Deposit ${waived ? 'waived' : 'discount'} — ${label(i)} (CEO-approved)`, `${money(full)} × ${pctText(i.depositDiscountPercent)}`, off, waived ? 'WAIVED' : 'DISCOUNTED', i.depositApprovalRef, i.department)
    }
  }
  // [3] Service Fee and [4] night differential, per request.
  for (const i of items) {
    lines.push({
      kind: 'SERVICE_FEE',
      description: `Service Fee — ${label(i)}`,
      calculation: `${hoursText(i.hours)} × ${money(i.hourlyRate)}${vas(i)}`,
      amount: round2(i.hours * i.hourlyRate * i.numberOfVas),
      department: i.department,
      foregoneAmount: 0,
      foregoneType: null,
      approvalRef: null,
    })
    if (i.ndHours > 0) {
      lines.push({
        kind: 'ND_FEE',
        description: `Night differential — ${label(i)}`,
        calculation: `${hoursText(i.ndHours)} ND × ${money(i.hourlyRate)} × ${pctText(s.ndPercent)}${vas(i)}`,
        amount: round2(((i.ndHours * i.hourlyRate * s.ndPercent) / 100) * i.numberOfVas),
        department: i.department,
        foregoneAmount: 0,
        foregoneType: null,
        approvalRef: null,
      })
    }
  }
  // [5] Free hours, as their own negative line.
  for (const i of items) {
    const value = round2(i.freeHours * i.hourlyRate)
    if (value > 0) reduction('FREE_HOURS', `Free hours — ${label(i)}`, `${hoursText(i.freeHours)} × ${money(i.hourlyRate)}`, value, 'FREE', i.freeHoursRef, i.department)
  }

  // [6] VAT on the subtotal, then the PayPal fee on the subtotal plus VAT.
  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0))
  const vatAmount = s.applyVat ? round2((subtotal * s.vatPercent) / 100) : 0
  const paypalFeeAmount = s.applyPaypalFee ? round2(((subtotal + vatAmount) * s.paypalPercent) / 100) : 0
  return {
    lines: lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
    subtotal,
    vatAmount,
    paypalFeeAmount,
    total: round2(subtotal + vatAmount + paypalFeeAmount),
    foregone: round2(lines.reduce((sum, l) => sum + l.foregoneAmount, 0)),
  }
}

// ── Forms ────────────────────────────────────────────────────────

const ref = z.string().trim().max(200).default('')
const percent = z.number('Enter a number.').min(0, 'Use 0 or more.').max(100, 'Use 100 or less.')
const hours = z.number('Enter the hours.').min(0, 'Use 0 or more.').max(2000, 'Use 2,000 or less.')

// What the Lead Manager can change on a draft initial bill. Every waiver,
// discount and free-hours grant needs its approval reference ([7]).
export const draftBillSchema = z
  .object({
    currency: z.enum(CURRENCIES),
    applyVat: z.boolean(),
    applyPaypalFee: z.boolean(),
    notes: z.string().trim().max(2000).default(''),
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          hourlyRate: z.number('Enter the hourly rate.').min(0, 'Use 0 or more.').max(10000, 'Use 10,000 or less.'),
          hours,
          ndHours: hours,
          freeHours: hours,
          freeHoursRef: ref,
          depositDiscountPercent: percent,
          depositApprovalRef: ref,
        })
      )
      .min(1),
    departments: z.array(z.object({ department: z.string().min(1), discountPercent: percent, approvalRef: ref })),
  })
  .superRefine((v, ctx) => {
    v.items.forEach((i, n) => {
      if (i.ndHours > i.hours) ctx.addIssue({ code: 'custom', path: ['items', n, 'ndHours'], message: 'ND hours can’t be more than the hours billed.' })
      if (i.freeHours > 0 && !i.freeHoursRef) ctx.addIssue({ code: 'custom', path: ['items', n, 'freeHoursRef'], message: 'Say which promo or agreement gave the free hours.' })
      if (i.depositDiscountPercent > 0 && !i.depositApprovalRef)
        ctx.addIssue({ code: 'custom', path: ['items', n, 'depositApprovalRef'], message: 'Add the CEO approval for the deposit discount.' })
    })
    v.departments.forEach((d, n) => {
      if (d.discountPercent > 0 && !d.approvalRef) ctx.addIssue({ code: 'custom', path: ['departments', n, 'approvalRef'], message: `Add the CEO approval for the ${d.department} One-Time Fee discount.` })
    })
  })
export type DraftBillInput = z.input<typeof draftBillSchema>

export const paymentSchema = z.object({
  amount: z.number('Enter the amount.').positive('Enter more than 0.').max(10_000_000),
  paidOn: z.iso.date('Enter the date it was paid.'),
  method: z.string().trim().min(1, 'Say how it was paid.').max(60),
  reference: z.string().trim().max(200).default(''),
  notes: z.string().trim().max(1000).default(''),
})
export type PaymentInput = z.input<typeof paymentSchema>

export const voidSchema = z.object({ reason: z.string().trim().min(3, 'Say why the bill is void.').max(500) })

// Payment methods Accounting picks from when recording a payment, with the
// onboarding form's methods first.
export const PAYMENT_RECORD_METHODS = ['Payoneer', 'Wise', 'ACH transfer', 'SWIFT transfer', 'Credit card', 'NIS bank transfer', 'PayPal', 'Other'] as const

// The email the Lead Manager sends with the initial bill, like the contract
// email: copied or opened in their email app, never sent by vaa-sys.
export function invoiceEmail(p: {
  customerName: string
  senderName: string
  code: string
  currency: Currency
  lines: Pick<BillLine, 'description' | 'calculation' | 'amount'>[]
  subtotal: number
  vatAmount: number
  vatPercent: number
  paypalFeeAmount: number
  paypalPercent: number
  total: number
}) {
  const money = (v: number) => formatMoney(v, p.currency)
  const rows = p.lines.filter((l) => l.amount !== 0).map((l) => `- ${l.description}: ${money(l.amount)} (${l.calculation})`)
  const extra = [
    ...(p.vatAmount ? [`- VAT (${p.vatPercent}%): ${money(p.vatAmount)}`] : []),
    ...(p.paypalFeeAmount ? [`- PayPal fee (${p.paypalPercent}%): ${money(p.paypalFeeAmount)}`] : []),
  ]
  return {
    subject: `VAA Philippines: initial bill ${p.code}`,
    body: [
      `Hi ${p.customerName},`,
      '',
      `Here is your initial bill, ${p.code}. It covers setting up your engagement and your first (partial) month of service.`,
      '',
      ...rows,
      ...(extra.length ? ['', `Subtotal: ${money(p.subtotal)}`, ...extra] : []),
      '',
      `Total due: ${money(p.total)}`,
      '',
      'Please let us know once the payment is made, or if you have any questions.',
      '',
      'Best regards,',
      p.senderName,
      'VAA Philippines',
    ].join('\n'),
  }
}

// The bill's starting VAT and PayPal switches, from what the customer gave on
// the onboarding form: Israel (country or NIS bank transfer) → VAT; PayPal
// written under "Other" → the PayPal fee.
export function billDefaultsFor(account: { paymentMethod: string; paymentMethodOther: string | null; billingCountry: string | null; region: string | null } | null) {
  if (!account) return { applyVat: false, applyPaypalFee: false, currency: 'USD' as Currency }
  const israel = account.paymentMethod === 'NIS_BANK_TRANSFER' || /israel/i.test(account.billingCountry ?? '') || /israel/i.test(account.region ?? '')
  const paypal = account.paymentMethod === 'OTHER' && /paypal/i.test(account.paymentMethodOther ?? '')
  return { applyVat: israel, applyPaypalFee: paypal, currency: (account.paymentMethod === 'NIS_BANK_TRANSFER' ? 'NIS' : 'USD') as Currency }
}
