import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { listServiceRequests, phaseCounts } from '@/lib/service-requests'
import { staffNames } from '@/lib/workforce'
import { manilaDate } from '@/lib/customer-fields'
import { OPEN_PHASES, SR_PHASES, SR_PHASE_LABELS, SR_TYPE_LABELS, isClosed, srCode, type SrPhase, type SrType } from '@/lib/service-request-fields'
import { SortableTable } from '@/components/ui/sortable-table'
import { PhasePill } from '@/components/requests/PhasePill'
import { TestBadge } from '@/components/leads/TestBadge'
import { cn } from '@/lib/utils'

// Service Requests (Nov 5, 2026): every ticket, open ones first by default.
// "Mine" is what's waiting on the person: a Service Manager's assigned
// tickets, HR's Rate Agreements, a CS Specialist's customers.
export default async function ServiceRequestsPage({ searchParams }: { searchParams: Promise<{ phase?: string; mine?: string; q?: string }> }) {
  const user = await requireCan('serviceRequests', 'read', '/service-requests')
  const sp = await searchParams
  const phase: SrPhase | 'OPEN' | 'ALL' = SR_PHASES.includes(sp.phase as SrPhase) ? (sp.phase as SrPhase) : sp.phase === 'ALL' ? 'ALL' : 'OPEN'
  const mine = sp.mine === '1'
  const q = sp.q?.trim() ?? ''
  const [tickets, counts] = await Promise.all([listServiceRequests(user, { phase, mine, q }), phaseCounts(user)])
  const names = await staffNames(tickets.flatMap((t) => [t.managerEmail ?? '', t.customer.assignedSpecialistEmail ?? '']))
  const name = (e: string | null) => (e ? (names.get(e) ?? e) : null)
  const now = new Date().getTime()
  const open = OPEN_PHASES.reduce((n, p) => n + (counts[p] ?? 0), 0)

  const href = (next: { phase?: string; mine?: boolean }) => {
    const p = new URLSearchParams()
    const ph = next.phase ?? (phase === 'OPEN' ? '' : phase)
    if (ph) p.set('phase', ph)
    if (next.mine ?? mine) p.set('mine', '1')
    if (q) p.set('q', q)
    const s = p.toString()
    return s ? `/service-requests?${s}` : '/service-requests'
  }
  const chips: { value: string; label: string; count: number }[] = [
    { value: '', label: 'Open', count: open },
    ...OPEN_PHASES.map((p) => ({ value: p, label: SR_PHASE_LABELS[p], count: counts[p] ?? 0 })),
    { value: 'CLOSED_WON', label: SR_PHASE_LABELS.CLOSED_WON, count: counts.CLOSED_WON ?? 0 },
    { value: 'CLOSED_LOST', label: SR_PHASE_LABELS.CLOSED_LOST, count: counts.CLOSED_LOST ?? 0 },
    { value: 'ALL', label: 'All', count: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) },
  ]
  const current = phase === 'OPEN' ? '' : phase

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
          <h1 className="mt-1 font-display text-2xl font-semibold">Service Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">Each ticket follows its most advanced VA candidate. Open a ticket to take the next step.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href({ mine: !mine })}
            aria-pressed={mine}
            className={cn('flex h-9 items-center rounded-xl border px-3 text-sm font-medium', mine ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
          >
            Waiting on me
          </Link>
          <form action="/service-requests" className="flex h-9 items-center gap-2 rounded-xl border bg-card px-3">
            {current && <input type="hidden" name="phase" value={current} />}
            {mine && <input type="hidden" name="mine" value="1" />}
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <label htmlFor="sr-search" className="sr-only">
              Search service requests
            </label>
            <input id="sr-search" name="q" type="search" defaultValue={q} placeholder="TKT-000001, account or customer" className="w-52 bg-transparent text-[13px] outline-none" />
          </form>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Filter by phase">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={href({ phase: c.value })}
            aria-current={c.value === current ? 'page' : undefined}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs',
              c.value === current ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {c.label} <span className="tabular-nums opacity-75">{c.count}</span>
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <SortableTable
          className="w-full min-w-[880px] text-left text-[13px]"
          theadClassName="border-b text-[11px] uppercase tracking-wide text-muted-foreground"
          columns={[
            { key: 'ticket', label: 'Ticket', firstDir: 'desc', className: 'py-3 pl-5 pr-3 font-medium' },
            { key: 'account', label: 'Account', className: 'px-3 py-3 font-medium' },
            { key: 'type', label: 'Type', className: 'px-3 py-3 font-medium' },
            { key: 'phase', label: 'Phase', className: 'px-3 py-3 font-medium' },
            { key: 'manager', label: 'Service Dept. Manager', className: 'px-3 py-3 font-medium' },
            { key: 'vas', label: 'VAs started', align: 'right', firstDir: 'desc', className: 'px-3 py-3 font-medium' },
            { key: 'days', label: 'In phase', align: 'right', firstDir: 'desc', className: 'py-3 pl-3 pr-5 font-medium' },
          ]}
          empty={
            <tr>
              <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                {q || mine || phase !== 'OPEN' ? 'No service requests match.' : 'No open service requests.'}
              </td>
            </tr>
          }
          rows={tickets.map((t) => {
            const started = new Set(t.candidates.filter((c) => c.stage === 'STARTED').map((c) => c.requestId)).size
            const days = Math.floor((now - t.phaseChangedAt.getTime()) / 86_400_000)
            return {
              id: t.id,
              values: {
                ticket: t.ticketNumber,
                account: t.account.name,
                type: t.type,
                phase: SR_PHASES.indexOf(t.phase as SrPhase),
                manager: name(t.managerEmail),
                vas: started,
                days: isClosed(t.phase as SrPhase) ? null : days,
              },
              node: (
                <tr key={t.id} className="group border-b last:border-0 hover:bg-muted/50">
                  <td className="relative py-2.5 pl-5 pr-3">
                    <Link href={`/service-requests/${t.id}`} className="font-mono font-medium after:absolute after:inset-0 group-hover:underline">
                      {srCode(t.ticketNumber)}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">opened {t.createdAt.toLocaleDateString('en-PH', manilaDate)}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    {t.account.name}
                    {t.customer.isTest && <TestBadge className="ml-2" />}
                    <p className="text-[11px] text-muted-foreground">
                      {t.customer.name} · {t.account.accountCode}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">{SR_TYPE_LABELS[t.type as SrType]}</td>
                  <td className="px-3 py-2.5">
                    <PhasePill phase={t.phase as SrPhase} />
                  </td>
                  <td className="px-3 py-2.5">{name(t.managerEmail) ?? <span className="text-muted-foreground">Not assigned</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {started} / {t.requests.length}
                  </td>
                  <td className="py-2.5 pl-3 pr-5 text-right text-muted-foreground">{isClosed(t.phase as SrPhase) ? '–' : days === 0 ? 'Today' : `${days} d`}</td>
                </tr>
              ),
            }
          })}
        />
      </div>
    </main>
  )
}
