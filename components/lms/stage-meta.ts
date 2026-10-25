import type { OnboardingStage } from '@/lib/customer-fields'

// Lead Management's board columns: the onboarding stages in the order a
// lead moves through them, with the LMS design's muted status colours
// (these utilities resolve to the earthy palette inside .lms).
export const STAGE_COLUMNS: OnboardingStage[] = ['NEW', 'LINK_SENT', 'OPENED', 'SUBMITTED', 'EXPIRED']

export const STAGE_META: Record<OnboardingStage, { label: string; dot: string; soft: string }> = {
  NEW: { label: 'No link yet', dot: 'bg-muted-foreground', soft: 'bg-muted text-muted-foreground' },
  LINK_SENT: { label: 'Link sent', dot: 'bg-info', soft: 'bg-info/15 text-info' },
  OPENED: { label: 'Form opened', dot: 'bg-warning', soft: 'bg-warning/15 text-warning' },
  SUBMITTED: { label: 'Form submitted', dot: 'bg-success', soft: 'bg-success/15 text-success' },
  EXPIRED: { label: 'Link expired', dot: 'bg-destructive', soft: 'bg-destructive/15 text-destructive' },
}

export function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

// "Day N" since the lead was added, counting the first day as Day 1.
export function dayOf(createdAt: Date, now = new Date()) {
  return Math.max(1, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000) + 1)
}
