import { z } from 'zod'

// Client-safe: a VA's Rate Agreement on a service request (Nov 6, 2026;
// lib/rate-agreements.ts has who may do what). HR walks it through the steps
// below in order. The VA moves on to the Kick-off Call once they acknowledge
// it, and it's cancelled with its ticket or VA.

export const RA_STATUSES = ['WAITING', 'PREPARED', 'SCHEDULE_CONFIRMED', 'PAYROLL_ACKNOWLEDGED', 'SENT_TO_VA', 'VA_ACKNOWLEDGED', 'CANCELLED'] as const
export type RaStatus = (typeof RA_STATUSES)[number]

export const RA_STATUS_LABELS: Record<RaStatus, string> = {
  WAITING: 'Waiting for HR',
  PREPARED: 'Prepared by HR',
  SCHEDULE_CONFIRMED: 'Schedule confirmation by CS',
  PAYROLL_ACKNOWLEDGED: 'Acknowledgement by Payroll',
  SENT_TO_VA: 'Sent to VA',
  VA_ACKNOWLEDGED: 'VA Acknowledged',
  CANCELLED: 'Cancelled',
}

// The steps, in order, after Waiting.
export const RA_STEPS: RaStatus[] = ['PREPARED', 'SCHEDULE_CONFIRMED', 'PAYROLL_ACKNOWLEDGED', 'SENT_TO_VA', 'VA_ACKNOWLEDGED']
export const RA_OPEN: RaStatus[] = ['WAITING', 'PREPARED', 'SCHEDULE_CONFIRMED', 'PAYROLL_ACKNOWLEDGED', 'SENT_TO_VA']

export function nextRaStep(status: RaStatus): RaStatus | null {
  if (status === 'WAITING') return 'PREPARED'
  const i = RA_STEPS.indexOf(status)
  return i >= 0 && i < RA_STEPS.length - 1 ? RA_STEPS[i + 1] : null
}

// The button that records each step.
export const RA_STEP_ACTIONS: Record<RaStatus, string> = {
  WAITING: '',
  PREPARED: 'Mark prepared by HR',
  SCHEDULE_CONFIRMED: 'CS confirmed the schedule',
  PAYROLL_ACKNOWLEDGED: 'Payroll acknowledged',
  SENT_TO_VA: 'Sent to the VA',
  VA_ACKNOWLEDGED: 'VA acknowledged',
  CANCELLED: '',
}

// The terms can change until the agreement goes to the VA.
export const raTermsLocked = (s: RaStatus) => s === 'SENT_TO_VA' || s === 'VA_ACKNOWLEDGED' || s === 'CANCELLED'

export const RA_BONDS = ['NONE', 'TRAINING', 'PERFORMANCE', 'BOTH'] as const
export type RaBond = (typeof RA_BONDS)[number]
export const RA_BOND_LABELS: Record<RaBond, string> = {
  NONE: 'Not applicable',
  TRAINING: 'Training Bond',
  PERFORMANCE: 'Performance Bond',
  BOTH: 'Training and Performance Bond',
}

const yesNo = z.enum(['yes', 'no'], 'Choose Yes or No.')

// HR's terms. Each must be chosen before the agreement is marked prepared.
export const raTermsSchema = z.object({
  bond: z.enum(RA_BONDS, 'Choose whether a Training or Performance Bond applies.'),
  nightDifferential: yesNo,
  incrementalWage: yesNo,
  notes: z.string().trim().max(2000),
})
export type RaTerms = z.input<typeof raTermsSchema>

export const raStepSchema = z.object({
  to: z.enum(RA_STEPS),
  // Sent to VA: the day it was sent (YYYY-MM-DD).
  sentOn: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Pick the date it was sent.'),
})
