import type { CustomerStatus } from '@/lib/customer-fields'

// Customer Management's status colours. Inside .cms these utilities resolve
// to the --st-* palette in app/globals.css (pending blue, active green,
// paused amber, cancelled grey, terminated brick).
export const STATUS_META: Record<CustomerStatus, { label: string; dot: string; bar: string; soft: string; stripe: string }> = {
  PENDING: { label: 'Pending', dot: 'bg-info', bar: 'bg-info', soft: 'bg-info/12 text-info', stripe: 'before:bg-info' },
  ACTIVE: { label: 'Active', dot: 'bg-success', bar: 'bg-success', soft: 'bg-success/12 text-success', stripe: 'before:bg-success' },
  PAUSED: { label: 'Paused', dot: 'bg-warning', bar: 'bg-warning', soft: 'bg-warning/15 text-warning', stripe: 'before:bg-warning' },
  CANCELLED: {
    label: 'Cancelled',
    dot: 'bg-muted-foreground',
    bar: 'bg-muted-foreground/60',
    soft: 'bg-muted text-muted-foreground',
    stripe: 'before:bg-muted-foreground/60',
  },
  TERMINATED: { label: 'Terminated', dot: 'bg-destructive', bar: 'bg-destructive', soft: 'bg-destructive/12 text-destructive', stripe: 'before:bg-destructive' },
}

// The order statuses appear in: the life of a customer, not the enum order.
export const STATUS_ORDER: CustomerStatus[] = ['PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED', 'TERMINATED']
