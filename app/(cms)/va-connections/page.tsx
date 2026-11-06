import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { VA_CONNECTIONS_SHOWN, VA_CONNECTION_STATUSES, VA_CONNECTION_STATUS_LABELS, listVaConnections, type VaConnectionStatus } from '@/lib/va-connections'
import { manilaDate } from '@/lib/customer-fields'
import { subTicketCode } from '@/lib/onboarding-fields'
import { srCode } from '@/lib/service-request-fields'
import { SortableTable } from '@/components/ui/sortable-table'
import { TestBadge } from '@/components/leads/TestBadge'
import { cn } from '@/lib/utils'

const day = (d: Date | null) => (d ? d.toLocaleDateString('en-PH', { ...manilaDate, timeZone: 'UTC' }) : null)

const TONES: Partial<Record<VaConnectionStatus, string>> = {
  STARTED: 'bg-success/15 text-success',
  PAUSED: 'bg-warning/15 text-warning',
  PENDING: 'bg-primary/10 text-primary',
  ACCEPTED: 'bg-primary/10 text-primary',
  TERMINATED: 'bg-destructive/10 text-destructive',
}

// VA Connections (Nov 6, 2026): every VA working for (or who worked for) an
// account. A service request's VA is listed here once its Service
// Department Manager marks them started; the legacy CMS's are imported.
export default async function VaConnectionsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requireCan('vaConnections', 'read', '/va-connections')
  const sp = await searchParams
  const status: VaConnectionStatus | 'ALL' = VA_CONNECTION_STATUSES.includes(sp.status as VaConnectionStatus) ? (sp.status as VaConnectionStatus) : sp.status === 'ALL' ? 'ALL' : 'STARTED'
  const q = sp.q?.trim() ?? ''
  const { rows, counts } = await listVaConnections(user, { status, q })
  const seesRequests = can(user.role, 'serviceRequests')

  const href = (s: string) => {
    const p = new URLSearchParams()
    if (s !== 'STARTED') p.set('status', s)
    if (q) p.set('q', q)
    const str = p.toString()
    return str ? `/va-connections?${str}` : '/va-connections'
  }
  const chips = [
    ...VA_CONNECTION_STATUSES.filter((s) => s === 'STARTED' || (counts[s] ?? 0) > 0).map((s) => ({ value: s, label: VA_CONNECTION_STATUS_LABELS[s], count: counts[s] ?? 0 })),
    { value: 'ALL', label: 'All', count: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) },
  ]

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
          <h1 className="mt-1 font-display text-2xl font-semibold">VA Connections</h1>
          <p className="mt-1 text-sm text-muted-foreground">VAs working for an account. A service request’s VA is listed here once they’re marked started.</p>
        </div>
        <form action="/va-connections" className="flex h-9 items-center gap-2 rounded-xl border bg-card px-3">
          {status !== 'STARTED' && <input type="hidden" name="status" value={status} />}
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <label htmlFor="conn-search" className="sr-only">
            Search VA connections
          </label>
          <input id="conn-search" name="q" type="search" defaultValue={q} placeholder="VA, account, customer or service" className="w-56 bg-transparent text-[13px] outline-none" />
        </form>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
        {chips.map((c) => (
          <Link
            key={c.value}
            href={href(c.value)}
            aria-current={c.value === status ? 'page' : undefined}
            className={cn('rounded-full border px-2.5 py-0.5 text-xs', c.value === status ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            {c.label} <span className="tabular-nums opacity-75">{c.count.toLocaleString()}</span>
          </Link>
        ))}
      </nav>

      {rows.length >= VA_CONNECTIONS_SHOWN && <p className="text-[12px] text-warning">Showing the newest {VA_CONNECTIONS_SHOWN.toLocaleString()}. Search to narrow it down.</p>}
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <SortableTable
          className="w-full min-w-[880px] text-left text-[13px]"
          theadClassName="border-b text-[11px] uppercase tracking-wide text-muted-foreground"
          columns={[
            { key: 'va', label: 'VA', className: 'py-3 pl-5 pr-3 font-medium' },
            { key: 'account', label: 'Account', className: 'px-3 py-3 font-medium' },
            { key: 'service', label: 'Service', className: 'px-3 py-3 font-medium' },
            { key: 'status', label: 'Status', className: 'px-3 py-3 font-medium' },
            { key: 'start', label: 'Started', firstDir: 'desc', className: 'px-3 py-3 font-medium' },
            { key: 'from', label: 'From', className: 'py-3 pl-3 pr-5 font-medium' },
          ]}
          empty={
            <tr>
              <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                {q ? `Nothing matches “${q}”.` : 'No VA connections with this status.'}
              </td>
            </tr>
          }
          rows={rows.map((c) => {
            const st = c.status as VaConnectionStatus
            const line = c.candidate?.request.lineNo
            return {
              id: c.id,
              values: { va: c.vaName, account: c.account.name, service: c.service ?? '', status: VA_CONNECTION_STATUSES.indexOf(st), start: c.startDate, from: c.ticket ? c.ticket.ticketNumber : -1 },
              node: (
                <tr key={c.id} className="border-b align-top last:border-0 hover:bg-muted/50">
                  <td className="py-2.5 pl-5 pr-3">
                    <span className="font-medium">{c.vaName}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{c.connectionCode}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/accounts/${c.account.id}`} className="hover:underline">
                      {c.account.name}
                    </Link>
                    {c.customer.isTest && <TestBadge className="ml-2" />}
                    <span className="block text-[11px] text-muted-foreground">{c.customer.name}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {c.service ?? <span className="text-muted-foreground">–</span>}
                    {c.department && <span className="block text-[11px] text-muted-foreground">{c.department}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', TONES[st] ?? 'bg-muted text-muted-foreground')}>{VA_CONNECTION_STATUS_LABELS[st] ?? st}</span>
                    {c.endDate && <span className="block text-[11px] text-muted-foreground">ended {day(c.endDate)}</span>}
                  </td>
                  <td className="px-3 py-2.5">{day(c.startDate) ?? <span className="text-muted-foreground">–</span>}</td>
                  <td className="py-2.5 pl-3 pr-5">
                    {c.ticket ? (
                      seesRequests ? (
                        <Link href={`/service-requests/${c.ticket.id}`} className="font-mono text-[12px] hover:underline">
                          {line ? subTicketCode(c.ticket.ticketNumber, line) : srCode(c.ticket.ticketNumber)}
                        </Link>
                      ) : (
                        <span className="font-mono text-[12px]">{line ? subTicketCode(c.ticket.ticketNumber, line) : srCode(c.ticket.ticketNumber)}</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">{c.source === 'LEGACY' ? 'Legacy CMS' : '–'}</span>
                    )}
                  </td>
                </tr>
              ),
            }
          })}
        />
      </div>
    </main>
  )
}
