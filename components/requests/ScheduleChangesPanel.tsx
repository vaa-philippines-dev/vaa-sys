import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import type { Actor } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { listScheduleChanges } from '@/lib/request-schedule'
import { CHANGE_KIND_LABELS, REVIEWER, changeText } from '@/lib/request-schedule-fields'
import { subTicketCode } from '@/lib/onboarding-fields'
import { SR_PHASE_LABELS, type SrPhase } from '@/lib/service-request-fields'
import { manilaDateTime } from '@/lib/customer-fields'
import { staffNames } from '@/lib/workforce'
import { ScheduleCheck } from '@/components/requests/ScheduleControls'
import { SortableTable } from '@/components/ui/sortable-table'
import { cn } from '@/lib/utils'

// Schedule changes on VA requests (lib/request-schedule.ts), for Customer
// Management's /service-requests/schedule-changes and Lead Management's
// /leads/schedule-changes. A change made while the service request was open
// affects billing and waits for Executive Support's check; the rest are the
// schedule's history once the VA is connected.
export async function ScheduleChangesPanel({ user, area, show, basePath }: { user: Actor; area: 'cms' | 'lms'; show: 'waiting' | 'all'; basePath: string }) {
  const rows = await listScheduleChanges(user, { show })
  const names = await staffNames([...rows.map((r) => r.changedByEmail), ...rows.map((r) => r.reviewedByEmail ?? '')])
  const who = (e: string | null) => (e ? (names.get(e) ?? e) : '')
  const canCheck = can(user.role, 'scheduleReviews', 'update')
  const seesRequests = can(user.role, 'serviceRequests')
  const seesLeads = can(user.role, 'leads')
  const tab = (value: 'waiting' | 'all', label: string) => (
    <Link
      href={value === 'waiting' ? basePath : `${basePath}?show=all`}
      className={cn('rounded-full border px-3 py-1 text-[13px]', show === value ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
    >
      {label}
    </Link>
  )

  return (
    <main className="w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{area === 'cms' ? 'Customer Management' : 'Lead Management'}</p>
        <h1 className={cn('mt-1 text-2xl font-semibold', area === 'cms' && 'font-display')}>Schedule changes</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          A VA request’s schedule changed while its service request was still open, or its service or department changed on a New request. That changes what the customer
          is billed, so {REVIEWER} checks each change, and the VA can’t be marked started until it’s checked. Every other change is kept here as the request’s history.
        </p>
      </div>

      <div className="flex gap-2">
        {tab('waiting', `Waiting for ${REVIEWER}`)}
        {tab('all', 'All changes')}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          <CalendarClock className="h-6 w-6" />
          {show === 'waiting' ? 'No schedule changes are waiting to be checked.' : 'No schedule changes yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <SortableTable
            className="w-full min-w-[880px] text-left text-[13px]"
            theadClassName="border-b bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground"
            tbodyClassName="divide-y"
            columns={[
              { key: 'when', label: 'When', firstDir: 'desc', className: 'px-3 py-2 font-medium' },
              { key: 'request', label: 'Request', className: 'px-3 py-2 font-medium' },
              { key: 'change', label: 'Change', sortable: false, className: 'px-3 py-2 font-medium' },
              { key: 'state', label: 'Check', className: 'px-3 py-2 font-medium' },
            ]}
            rows={rows.map((c) => {
              const t = c.ticket
              const code = subTicketCode(t.ticketNumber, c.request.lineNo)
              const waiting = c.needsReview && !c.reviewedAt
              const isLead = t.customer.status === 'PENDING' && t.customer.leadPhase !== 'NEW_CUSTOMER_ONBOARDED'
              const href = seesRequests ? `/service-requests/${t.id}` : seesLeads && isLead ? `/leads/${t.customer.id}` : null
              return {
                id: c.id,
                values: { when: c.changedAt, request: `${t.account.name} ${code}`, state: waiting ? 0 : c.needsReview ? 1 : 2 },
                node: (
                  <tr key={c.id} className="align-top">
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {c.changedAt.toLocaleString('en-PH', manilaDateTime)}
                      <span className="block text-[11px]">by {who(c.changedByEmail)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {href ? (
                        <Link href={href} className="font-medium hover:underline">
                          {t.account.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{t.account.name}</span>
                      )}
                      {t.customer.isTest && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">Test</span>}
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {code} · {c.request.service}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">during {SR_PHASE_LABELS[c.phase as SrPhase] ?? c.phase}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block text-[11px] font-medium text-muted-foreground">{CHANGE_KIND_LABELS[c.kind] ?? c.kind}</span>
                      <span className="block text-muted-foreground line-through decoration-muted-foreground/50">{changeText(c.kind, c.before)}</span>
                      <span className="block font-medium">{changeText(c.kind, c.after)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {waiting ? (
                        canCheck ? (
                          <ScheduleCheck changeId={c.id} />
                        ) : (
                          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[12px] font-medium text-warning">Waiting for {REVIEWER}</span>
                        )
                      ) : c.needsReview ? (
                        <span className="text-success">
                          Checked by {who(c.reviewedByEmail)}
                          <span className="block text-[11px] text-muted-foreground">
                            {c.reviewedAt?.toLocaleString('en-PH', manilaDateTime)}
                            {c.reviewNote && ` · ${c.reviewNote}`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">History (after the request closed)</span>
                      )}
                    </td>
                  </tr>
                ),
              }
            })}
          />
        </div>
      )}
    </main>
  )
}
