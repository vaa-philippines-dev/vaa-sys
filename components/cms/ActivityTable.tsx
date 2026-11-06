import Link from 'next/link'
import { ACTION_LABELS } from '@/lib/activity-fields'
import { manilaDateTime } from '@/lib/customer-fields'
import type { ActivityLog } from '@/src/generated/prisma/client'
import { SortableTable } from '@/components/ui/sortable-table'

// Activity log rows as a table: the Activity log page, and the history on a
// customer's or account's page.
type Row = ActivityLog

export function ActivityTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <p className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">Nothing in this range.</p>
  // Sorting reorders the rows on this page only (the log pages through 100
  // at a time, newest first).
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <SortableTable
        className="w-full text-sm"
        theadClassName="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"
        tbodyClassName="divide-y"
        columns={[
          { key: 'when', label: 'When', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
          { key: 'record', label: 'Record', className: 'px-4 py-2.5 font-medium' },
          { key: 'what', label: 'What', className: 'px-4 py-2.5 font-medium' },
          { key: 'change', label: 'Change', className: 'px-4 py-2.5 font-medium' },
          { key: 'by', label: 'By', className: 'px-4 py-2.5 font-medium' },
        ]}
        rows={rows.map((r) => ({
          id: r.id,
          values: {
            when: r.createdAt,
            record: `${r.entityType} ${r.entityLabel ?? r.entityId}`,
            what: ACTION_LABELS[r.action] ?? r.action,
            change: r.newValue ?? r.oldValue ?? r.notes,
            by: r.actorName ?? r.actorEmail,
          },
          node: (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                {r.createdAt.toLocaleString('en-PH', manilaDateTime)}
                {r.effectiveDate && Math.abs(r.effectiveDate.getTime() - r.createdAt.getTime()) > 60_000 && (
                  <span className="block">effective {r.effectiveDate.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <span className="text-xs text-muted-foreground">{r.entityType}</span>
                <span className="block">{entityLink(r)}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                {ACTION_LABELS[r.action] ?? r.action}
                {r.field && <span className="block text-xs text-muted-foreground">{r.field}</span>}
              </td>
              <td className="max-w-md px-4 py-2.5">
                {(r.oldValue || r.newValue) && (
                  <p className="break-words">
                    {r.oldValue && <span className="text-muted-foreground line-through decoration-muted-foreground/40">{r.oldValue}</span>}
                    {r.oldValue && r.newValue && ' → '}
                    {r.newValue}
                  </p>
                )}
                {r.notes && r.action !== 'NOTE' && <p className="mt-0.5 text-xs text-muted-foreground">{r.notes}</p>}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {r.actorName ?? r.actorEmail}
                {r.actorName && <span className="block text-muted-foreground">{r.actorEmail}</span>}
              </td>
            </tr>
          ),
        }))}
      />
    </div>
  )
}

function entityLink(r: Row) {
  const label = r.entityLabel ?? r.entityId
  if (r.entityType === 'Customer')
    return (
      <Link href={`/customers/${r.entityId}`} className="hover:underline">
        {label}
      </Link>
    )
  if (r.entityType === 'Account')
    return (
      <Link href={`/accounts/${r.entityId}`} className="hover:underline">
        {label}
      </Link>
    )
  return label
}
