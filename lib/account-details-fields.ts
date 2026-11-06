import { z } from 'zod'
import { INVOICE_SOURCES, PAYMENT_METHODS, PLATFORMS, REGIONS, SCHEDULE_TYPES, WORK_DAYS, isTimeZone } from '@/lib/onboarding-fields'

// Client-safe: Customer Management's edit of an account's onboarding details
// (Part 1 of the form) and its tickets' VA requests (Part 2), from the
// Details section of a customer's or account's page (Nov 5, 2026).
//
// Looser than the onboarding form on purpose: staff fix what a customer
// typed, and legacy accounts imported from the old CMS often have no
// WhatsApp, region or address, so only what the records need is required.
// The work hour minimums are the form's rule for customers, not for staff.
// Editing never changes a status.

const text = (max: number) => z.string().trim().max(max)
const isEmail = (v: string) => z.email().safeParse(v).success
const TIME_RE = /^\d{2}:\d{2}$/

export const contactEditSchema = z.object({
  firstName: text(200).min(1, 'Enter the contact’s first name.'),
  lastName: text(200),
  role: text(200),
  email: text(200).refine((v) => v === '' || isEmail(v), 'Enter a valid email for the contact, or leave it blank.'),
  whatsapp: text(40),
  region: z.enum(REGIONS).or(z.literal('')),
})
export type ContactEdit = z.infer<typeof contactEditSchema>

export const accountDetailsSchema = z
  .object({
    companyName: text(200).min(1, 'Enter the company name.'),
    dbaName: text(200),
    businessAddress: text(500),
    website: text(300),
    timeZone: text(60).refine((v) => v === '' || isTimeZone(v), 'Choose a time zone from the list.'),
    platforms: z.array(z.enum(PLATFORMS)),
    platformOther: text(200),
    otherInfo: text(2000),
    invoiceSource: z.enum(INVOICE_SOURCES),
    invoiceName: text(200),
    invoiceRole: text(200),
    invoiceEmail: text(200),
    paymentMethod: z.enum(PAYMENT_METHODS),
    paymentMethodOther: text(200),
    billingCountry: text(200),
    // null: not asked (customers in Israel) or not recorded.
    hasPayoneerOrWise: z.boolean().nullable(),
    primary: contactEditSchema.nullable(),
    secondary: contactEditSchema.nullable(),
    // Which contact VAA works with day to day; one per account at most.
    focal: z.enum(['PRIMARY', 'SECONDARY', 'NONE']),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (v.platforms.includes('Other') && !v.platformOther) issue('platformOther', 'Enter the other platform, or untick Other.')
    if (v.paymentMethod === 'OTHER' && !v.paymentMethodOther) issue('paymentMethodOther', 'Enter the other payment method.')
    if (v.website && !/^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(v.website)) issue('website', 'Enter the website as an address, e.g. https://example.com.')
    if (v.focal === 'PRIMARY' && !v.primary) issue('focal', 'Add the primary contact, or choose another main contact.')
    if (v.focal === 'SECONDARY' && !v.secondary) issue('focal', 'Add the secondary contact, or choose another main contact.')
    if (v.invoiceSource === 'SECONDARY' && !v.secondary) issue('invoiceSource', 'Add the secondary contact, or choose who invoices go to.')
    if (v.invoiceSource === 'PRIMARY' && !v.primary) issue('invoiceSource', 'Add the primary contact, or choose who invoices go to.')
    if (v.invoiceSource === 'OTHER') {
      if (!v.invoiceName) issue('invoiceName', 'Enter who invoices go to.')
      if (!isEmail(v.invoiceEmail)) issue('invoiceEmail', 'Enter the invoice contact’s email.')
    }
  })
export type AccountDetailsInput = z.input<typeof accountDetailsSchema>

const hours = (ceiling: number) => z.number().positive().max(ceiling).nullable()

export const vaRequestEditSchema = z
  .object({
    service: text(200).min(1, 'Enter the service.'),
    numberOfVas: z.number('Enter how many VAs.').int('Use a whole number of VAs.').min(1, 'At least 1 VA.').max(50),
    scheduleType: z.enum(SCHEDULE_TYPES, 'Choose a work hour type.'),
    hoursPerDay: hours(24),
    hoursPerWeek: hours(168),
    hoursPerMonth: hours(744),
    projectHours: hours(10000),
    // Philippine time.
    startTimePht: text(5),
    endTimePht: text(5),
    workDays: z.array(z.enum(WORK_DAYS)).max(7),
    nightDifferential: z.boolean(),
    additionalHours: text(200),
    targetStartDate: text(10).refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Choose the target start date.'),
    tasks: text(2000),
    tools: text(1000),
    taskTracker: z.boolean().nullable(),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    const daily = r.scheduleType === 'DAILY_FIXED' || r.scheduleType === 'DAILY_FLEXIBLE'
    if (daily && r.workDays.length === 0) issue('workDays', 'Choose the work days.')
    if (r.scheduleType === 'DAILY_FIXED' && (!TIME_RE.test(r.startTimePht) || !TIME_RE.test(r.endTimePht))) issue('startTimePht', 'Enter the start and end time (Philippine time).')
    if (r.scheduleType === 'DAILY_FLEXIBLE' && r.hoursPerDay == null) issue('hoursPerDay', 'Enter the hours per day.')
    if (r.scheduleType === 'WEEKLY_FLEXIBLE' && r.hoursPerWeek == null) issue('hoursPerWeek', 'Enter the hours per week.')
    if (r.scheduleType === 'MONTHLY' && r.hoursPerMonth == null) issue('hoursPerMonth', 'Enter the hours per month.')
    if (r.scheduleType === 'PROJECT' && r.projectHours == null) issue('projectHours', 'Enter the project hours.')
  })
export type VaRequestEditInput = z.input<typeof vaRequestEditSchema>

// What the edit forms start from: an account and its requests as plain data
// (no Dates or Decimals), made on the server (details-data.ts).
export type EditableContact = ContactEdit & { isFocal: boolean }
export type EditableRequest = VaRequestEditInput & { id: string; code: string }
export type EditableAccount = {
  id: string
  code: string
  name: string
  details: AccountDetailsInput
  tickets: { id: string; code: string; requests: EditableRequest[] }[]
}
