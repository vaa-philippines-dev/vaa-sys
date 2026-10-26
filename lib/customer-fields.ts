import { z } from 'zod'

// Client-safe: customer statuses, labels and input shapes. Prisma reads live
// in lib/customers.ts.

export const CUSTOMER_STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'INACTIVE', 'CANCELLED', 'TERMINATED'] as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

export const STATUS_LABELS: Record<CustomerStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  INACTIVE: 'Inactive',
  CANCELLED: 'Cancelled',
  TERMINATED: 'Terminated',
}

export const STATUS_BADGE: Record<CustomerStatus, string> = {
  PENDING: 'bg-info/10 text-info border-info/20',
  ACTIVE: 'bg-success/10 text-success border-success/20',
  PAUSED: 'bg-warning/10 text-warning border-warning/20',
  INACTIVE: 'bg-muted text-muted-foreground border-border',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  TERMINATED: 'bg-destructive/10 text-destructive border-destructive/20',
}

// Accounts share every status but Pending can't be picked by hand: new and
// reactivated accounts sit there until a VA connection starts.
export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'INACTIVE', 'TERMINATED', 'CANCELLED'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]
export const PICKABLE_ACCOUNT_STATUSES: AccountStatus[] = ['ACTIVE', 'PAUSED', 'INACTIVE', 'TERMINATED', 'CANCELLED']

export const TERMINAL_STATUSES = ['TERMINATED', 'CANCELLED'] as const
export const isTerminal = (s: string | null | undefined) => s === 'TERMINATED' || s === 'CANCELLED'

// Moving into one of these needs a reason in the log, and applies at once
// but waits for a CS Manager's review when someone else does it.
export const REASON_REQUIRED: CustomerStatus[] = ['PAUSED', 'CANCELLED', 'TERMINATED']
export const REVIEWED_STATUSES: CustomerStatus[] = ['PAUSED', 'CANCELLED', 'TERMINATED']

// Customer IDs are always generated (lib/customers.ts), never typed.
export const newLeadSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer name.').max(200),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email, or leave it blank.')
    .transform((v) => (v === '' ? null : v.toLowerCase())),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v)),
})
export type NewLeadInput = z.input<typeof newLeadSchema>

// YYYY-MM-DD from a date input; empty means today.
const dateInput = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date.')

export const statusChangeSchema = z
  .object({
    status: z.enum(CUSTOMER_STATUSES),
    reason: z.string().trim().max(1000),
    // When it took effect; empty = now. Terminations can't be in the future.
    effectiveDate: dateInput.default(''),
    terminationReasonId: z.string().trim().max(60).default(''),
    // Reactivating: which terminated/cancelled accounts come back too.
    reactivateAccountIds: z.array(z.string().max(60)).max(200).default([]),
  })
  .refine((v) => !REASON_REQUIRED.includes(v.status) || v.reason.length > 0, {
    message: 'Give a reason for this status.',
    path: ['reason'],
  })
export type StatusChangeInput = z.input<typeof statusChangeSchema>

export const accountStatusChangeSchema = z
  .object({
    status: z.enum(PICKABLE_ACCOUNT_STATUSES as [AccountStatus, ...AccountStatus[]]),
    reason: z.string().trim().max(1000),
    effectiveDate: dateInput.default(''),
    terminationReasonId: z.string().trim().max(60).default(''),
  })
  .refine((v) => !(['PAUSED', 'CANCELLED', 'TERMINATED'] as string[]).includes(v.status) || v.reason.length > 0, {
    message: 'Give a reason for this status.',
    path: ['reason'],
  })
export type AccountStatusChangeInput = z.input<typeof accountStatusChangeSchema>

// Editing a customer never touches its status (the legacy edit form wrote a
// fake Active status change on every save).
export const customerEditSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter the customer name.').max(200),
    email: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email, or leave it blank.')
      .transform((v) => (v === '' ? null : v.toLowerCase())),
    notes: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => (v === '' ? null : v)),
    noPaymentYet: z.boolean(),
    paymentDate: dateInput,
  })
  .refine((v) => v.noPaymentYet || v.paymentDate !== '', {
    message: 'Enter the payment date, or tick “No payment yet”.',
    path: ['paymentDate'],
  })
export type CustomerEditInput = z.input<typeof customerEditSchema>

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string }

// Possible duplicates shown while entering a new lead.
export type CustomerMatch = {
  id: string | null
  code: string | null
  name: string
  status: string | null
  source: 'vaa_sys' | 'legacy_cms'
}

// Where a lead is in onboarding, derived from its links and submission.
export type OnboardingStage = 'NEW' | 'LINK_SENT' | 'OPENED' | 'EXPIRED' | 'SUBMITTED'

export const STAGE_LABELS: Record<OnboardingStage, string> = {
  NEW: 'No link yet',
  LINK_SENT: 'Link sent',
  OPENED: 'Form opened',
  EXPIRED: 'Link expired',
  SUBMITTED: 'Form submitted',
}

export const STAGE_BADGE: Record<OnboardingStage, string> = {
  NEW: 'bg-muted text-muted-foreground border-border',
  LINK_SENT: 'bg-info/10 text-info border-info/20',
  OPENED: 'bg-warning/10 text-warning border-warning/20',
  EXPIRED: 'bg-destructive/10 text-destructive border-destructive/20',
  SUBMITTED: 'bg-success/10 text-success border-success/20',
}

export function onboardingStage(
  links: { revokedAt: Date | null; expiresAt: Date; openedAt: Date | null; submittedAt: Date | null }[],
  now = new Date()
): OnboardingStage {
  if (links.some((l) => l.submittedAt)) return 'SUBMITTED'
  const open = links.filter((l) => !l.revokedAt)
  if (open.length === 0) return 'NEW'
  const live = open.filter((l) => l.expiresAt > now)
  if (live.length === 0) return 'EXPIRED'
  return live.some((l) => l.openedAt) ? 'OPENED' : 'LINK_SENT'
}

export const manilaDate: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }
export const manilaDateTime: Intl.DateTimeFormatOptions = { ...manilaDate, hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }

// Dates people pick are Manila calendar days (the legacy sheet ran on
// Asia/Taipei, the same UTC+8). Never use toISOString() for a calendar day:
// under UTC+8 it shifts some dates back a day (a legacy bug).
export function manilaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now)
}

// For @db.Date columns: the calendar day itself, stored at UTC midnight.
export function dateOnly(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

// A @db.Date value back to YYYY-MM-DD.
export function dayString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// For timestamps: the start of that Manila day.
export function manilaStartOf(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`)
}

// Shown on the customer list and page only, never stored (legacy UI rules).
// startedVas is null until VA connections exist (module 2); the two
// VA-based warnings stay off until then.
export type CustomerWarning = 'NO_CS' | 'VA_NOT_ACTIVE' | 'ACTIVE_NO_VA'

export const WARNING_LABELS: Record<CustomerWarning, string> = {
  NO_CS: 'No CS Specialist assigned',
  VA_NOT_ACTIVE: 'Has a working VA but isn’t Active',
  ACTIVE_NO_VA: 'Active with no working VA',
}

export function customerWarnings(c: { status: CustomerStatus; assignedSpecialistEmail: string | null }, startedVas: number | null): CustomerWarning[] {
  const out: CustomerWarning[] = []
  if (!c.assignedSpecialistEmail && !isTerminal(c.status)) out.push('NO_CS')
  if (startedVas !== null && startedVas > 0 && c.status !== 'ACTIVE') out.push('VA_NOT_ACTIVE')
  if (startedVas !== null && startedVas === 0 && c.status === 'ACTIVE') out.push('ACTIVE_NO_VA')
  return out
}

export const noteSchema = z.object({ body: z.string().trim().min(1, 'Write the note first.').max(5000) })

const optionalUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Enter a full link starting with https://, or leave it blank.')
  .transform((v) => (v === '' ? null : v))
const optionalId = z
  .string()
  .trim()
  .max(60)
  .transform((v) => (v === '' ? null : v))

// The Customer Management fields of an account (contacts and billing come
// from the onboarding form).
export const accountEditSchema = z.object({
  categoryId: optionalId,
  typeId: optionalId,
  countryRegionId: optionalId,
  sellerOnboardingLink: optionalUrl,
  contractLink: optionalUrl,
  contractId: optionalId,
  isReturning: z.boolean(),
})
export type AccountEditInput = z.input<typeof accountEditSchema>

export const accountManagerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the manager’s name.').max(200),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email, or leave it blank.')
    .transform((v) => (v === '' ? null : v.toLowerCase())),
})
export type AccountManagerInput = z.input<typeof accountManagerSchema>
