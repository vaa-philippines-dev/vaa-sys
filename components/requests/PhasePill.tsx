import { SR_PHASE_LABELS, type SrPhase } from '@/lib/service-request-fields'
import { cn } from '@/lib/utils'

// A service request's phase as a pill, in the .cms palette's status tokens.
const TONE: Record<SrPhase, string> = {
  NEW: 'bg-info/10 text-info',
  VA_ASSIGNMENT: 'bg-warning/10 text-warning',
  VA_PREPARATION: 'bg-primary/10 text-primary',
  RATE_AGREEMENT: 'bg-primary/10 text-primary',
  KICKOFF_CALL: 'bg-primary/10 text-primary',
  CONNECTION_CALL: 'bg-primary/10 text-primary',
  START_VA: 'bg-success/10 text-success',
  CLOSED_WON: 'bg-success/15 text-success',
  CLOSED_LOST: 'bg-muted text-muted-foreground',
}

export function PhasePill({ phase, className }: { phase: SrPhase; className?: string }) {
  return <span className={cn('inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium', TONE[phase], className)}>{SR_PHASE_LABELS[phase]}</span>
}
