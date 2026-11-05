import { cn } from '@/lib/utils'
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/billing-fields'

// Colours come from the area's status tokens (info/success/warning).
const TONE: Record<InvoiceStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SENT: 'bg-info/15 text-info',
  PARTIALLY_PAID: 'bg-warning/15 text-warning',
  PAID: 'bg-success/15 text-success',
  VOID: 'bg-muted text-muted-foreground line-through',
}

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', TONE[status], className)}>{INVOICE_STATUS_LABELS[status]}</span>
}
