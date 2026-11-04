import type { OnboardingStage } from '@/lib/customer-fields'
import { PHASE_LABELS, type LeadPhase } from '@/lib/lead-phase-fields'

// Lead Management's onboarding stages (Customer Intake's steps), with the
// LMS design's muted status colours (these utilities resolve to the earthy
// palette inside .lms).
export const STAGE_COLUMNS: OnboardingStage[] = ['NEW', 'LINK_SENT', 'OPENED', 'SUBMITTED', 'EXPIRED']

export const STAGE_META: Record<OnboardingStage, { label: string; dot: string; soft: string }> = {
  NEW: { label: 'No link yet', dot: 'bg-muted-foreground', soft: 'bg-muted text-muted-foreground' },
  LINK_SENT: { label: 'Link sent', dot: 'bg-info', soft: 'bg-info/15 text-info' },
  OPENED: { label: 'Form opened', dot: 'bg-warning', soft: 'bg-warning/15 text-warning' },
  SUBMITTED: { label: 'Form submitted', dot: 'bg-success', soft: 'bg-success/15 text-success' },
  EXPIRED: { label: 'Link expired', dot: 'bg-destructive', soft: 'bg-destructive/15 text-destructive' },
}

// The board's columns: Customer Intake's stages up to the form, then the
// workflow phases after it. Leads leave the board once onboarded.
export type BoardColumn = Exclude<OnboardingStage, 'SUBMITTED'> | Exclude<LeadPhase, 'CUSTOMER_INTAKE' | 'NEW_CUSTOMER_ONBOARDED'>

export const BOARD_COLUMNS: BoardColumn[] = ['NEW', 'LINK_SENT', 'OPENED', 'EXPIRED', 'CONTRACT_BILLING_INITIATION', 'CONTRACT_PAYMENT_CONFIRMATION', 'CUSTOMER_SUCCESS_HANDOFF']

export const COLUMN_META: Record<BoardColumn, { label: string; dot: string; soft: string; phase: LeadPhase }> = {
  NEW: { ...STAGE_META.NEW, phase: 'CUSTOMER_INTAKE' },
  LINK_SENT: { ...STAGE_META.LINK_SENT, phase: 'CUSTOMER_INTAKE' },
  OPENED: { ...STAGE_META.OPENED, phase: 'CUSTOMER_INTAKE' },
  EXPIRED: { ...STAGE_META.EXPIRED, phase: 'CUSTOMER_INTAKE' },
  CONTRACT_BILLING_INITIATION: { label: PHASE_LABELS.CONTRACT_BILLING_INITIATION, dot: 'bg-primary', soft: 'bg-primary/10 text-foreground', phase: 'CONTRACT_BILLING_INITIATION' },
  CONTRACT_PAYMENT_CONFIRMATION: { label: PHASE_LABELS.CONTRACT_PAYMENT_CONFIRMATION, dot: 'bg-warning', soft: 'bg-warning/15 text-warning', phase: 'CONTRACT_PAYMENT_CONFIRMATION' },
  CUSTOMER_SUCCESS_HANDOFF: { label: PHASE_LABELS.CUSTOMER_SUCCESS_HANDOFF, dot: 'bg-success', soft: 'bg-success/15 text-success', phase: 'CUSTOMER_SUCCESS_HANDOFF' },
}

// Where a lead sits on the board. A submitted form is always past Customer
// Intake, even if its phase hasn't been worked out yet.
export function boardColumnOf(stage: OnboardingStage, phase: LeadPhase): BoardColumn {
  if (phase === 'CUSTOMER_INTAKE') return stage === 'SUBMITTED' ? 'CONTRACT_BILLING_INITIATION' : stage
  return phase === 'NEW_CUSTOMER_ONBOARDED' ? 'CUSTOMER_SUCCESS_HANDOFF' : phase
}

export function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

// "Day N" since the lead was added, counting the first day as Day 1.
export function dayOf(createdAt: Date, now = new Date()) {
  return Math.max(1, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000) + 1)
}
