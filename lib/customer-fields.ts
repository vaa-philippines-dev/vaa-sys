import { z } from 'zod'

// Client-safe: customer statuses, labels and input shapes. Prisma reads live
// in lib/customers.ts.

export const CUSTOMER_STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED', 'TERMINATED'] as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

export const STATUS_LABELS: Record<CustomerStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  CANCELLED: 'Cancelled',
  TERMINATED: 'Terminated',
}

export const STATUS_BADGE: Record<CustomerStatus, string> = {
  PENDING: 'bg-info/10 text-info border-info/20',
  ACTIVE: 'bg-success/10 text-success border-success/20',
  PAUSED: 'bg-warning/10 text-warning border-warning/20',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  TERMINATED: 'bg-destructive/10 text-destructive border-destructive/20',
}

// Moving a customer into one of these needs a reason in the log.
export const REASON_REQUIRED: CustomerStatus[] = ['PAUSED', 'CANCELLED', 'TERMINATED']


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

export const statusChangeSchema = z
  .object({
    status: z.enum(CUSTOMER_STATUSES),
    reason: z.string().trim().max(1000),
  })
  .refine((v) => !REASON_REQUIRED.includes(v.status) || v.reason.length > 0, {
    message: 'Give a reason for this status.',
    path: ['reason'],
  })

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
