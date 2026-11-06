import { RA_STATUS_LABELS, type RaStatus } from '@/lib/rate-agreement-fields'
import { cn } from '@/lib/utils'

const TONES: Record<RaStatus, string> = {
  WAITING: 'bg-warning/15 text-warning',
  PREPARED: 'bg-primary/10 text-primary',
  SCHEDULE_CONFIRMED: 'bg-primary/10 text-primary',
  PAYROLL_ACKNOWLEDGED: 'bg-primary/10 text-primary',
  SENT_TO_VA: 'bg-primary/15 text-primary',
  VA_ACKNOWLEDGED: 'bg-success/15 text-success',
  CANCELLED: 'bg-muted text-muted-foreground',
}

export function RaStatusPill({ status, className }: { status: RaStatus; className?: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', TONES[status], className)}>{RA_STATUS_LABELS[status]}</span>
}
