import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { canAssignRa, listHrPeople, listRateAgreements, raStatusCounts, type RaFilter } from '@/lib/rate-agreements'
import { departmentInfo, requestDepartment } from '@/lib/request-departments'
import { staffNames } from '@/lib/workforce'
import { manilaDate } from '@/lib/customer-fields'
import { subTicketCode } from '@/lib/onboarding-fields'
import { SR_TYPE_LABELS, type SrType } from '@/lib/service-request-fields'
import { RA_OPEN, RA_STATUSES, RA_STATUS_LABELS, type RaStatus } from '@/lib/rate-agreement-fields'
import { SortableTable } from '@/components/ui/sortable-table'
import { RaStatusPill } from '@/components/requests/RaStatusPill'
import { RaAssignSelect } from '@/components/requests/RateAgreementControls'
import { TestBadge } from '@/components/leads/TestBadge'
import { cn } from '@/lib/utils'

const day = (d: Date) => d.toLocaleDateString('en-PH', { ...manilaDate, timeZone: 'UTC' })

// The HR team's table of every Rate Agreement (Nov 6, 2026). Open ones
// first by default; an HR Specialist starts on theirs, an HR Manager assigns
// the rest from here.
export default async function RateAgreementsPage({ searchParams }: { searchParams: Promise<{ status?: string; who?: string; q?: string }> }) {
  const user = await requireCan('rateAgreements', 'read', '/rate-agreements')
  const sp = await searchParams
  const status: RaFilter['status'] = RA_STATUSES.includes(sp.status as RaStatus) ? (sp.status as RaStatus) : sp.status === 'ALL' ? 'ALL' : 'OPEN'
  // An HR Specialist lands on their own; everyone else on all of them.
  const who: NonNullable<RaFilter['who']> = sp.who === 'mine' || sp.who === 'unassigned' || sp.who === 'all' ? sp.who : user.role === 'HR_SPECIALIST' ? 'mine' : 'all'
  const q = sp.q?.trim() ?? ''
  const canAssign = canAssignRa(user)

  const [rows, counts, info, people] = await Promise.all([
    listRateAgreements(user, { status, who, q }),
    raStatusCounts(user, { who, q }),
    departmentInfo(),
    canAssign ? listHrPeople() : Promise.resolve([]),
  ])
  const names = await staffNames(rows.map((r) => r.assignedToEmail ?? ''))
  const deptName = (id: string | null) => (id ? (info.departments.find((d) => d.id === id)?.name ?? 'Unknown department') : 'No department')
  const now = new Date().getTime()

  const href = (next: { status?: string; who?: string }) => {
    const p = new URLSearchParams()
    const st = next.status ?? (status === 'OPEN' ? '' : status)
    if (st) p.set('status', st)
    p.set('who', next.who ?? who)
    if (q) p.set('q', q)
    return `/rate-agreements?${p.toString()}`
  }
  const open = RA_OPEN.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const chips = [
    { value: '', label: 'Open', count: open },
    ...RA_STATUSES.map((s) => ({ value: s, label: RA_STATUS_LABELS[s], count: counts[s] ?? 0 })),
    { value: 'ALL', label: 'All', count: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) },
  ]
  const current = status === 'OPEN' ? '' : status
  const whoTabs = [
    { value: 'mine', label: 'Assigned to me' },
    ...(canAssign ? [{ value: 'unassigned', label: 'Not assigned' }] : []),
    { value: 'all', label: 'Everyone’s' },
  ]

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management · HR</p>
          <h1 className="mt-1 font-display text-2xl font-semibold">Rate Agreements</h1>
          <p className="mt-1 text-sm text-muted-foreground">One per VA moved to Rate Agreement on a service request. Open one to confirm it and record each step.</p>
        </div>
        <form action="/rate-agreements" className="flex h-9 items-center gap-2 rounded-xl border bg-card px-3">
          {current && <input type="hidden" name="status" value={current} />}
          <input type="hidden" name="who" value={who} />
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <label htmlFor="ra-search" className="sr-only">
            Search Rate Agreements
          </label>
          <input id="ra-search" name="q" type="search" defaultValue={q} placeholder="TKT-000001, VA, account or customer" className="w-56 bg-transparent text-[13px] outline-none" />
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          {chips.map((c) => (
            <Link
              key={c.label}
              href={href({ status: c.value })}
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
        <nav className="flex rounded-xl border bg-card p-0.5" aria-label="Whose">
          {whoTabs.map((w) => (
            <Link
              key={w.value}
              href={href({ who: w.value })}
              aria-current={w.value === who ? 'page' : undefined}
              className={cn('rounded-lg px-2.5 py-1 text-xs font-medium', w.value === who ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {w.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <SortableTable
          className="w-full min-w-[960px] text-left text-[13px]"
          theadClassName="border-b text-[11px] uppercase tracking-wide text-muted-foreground"
          columns={[
            { key: 'ticket', label: 'VA request', firstDir: 'desc', className: 'py-3 pl-5 pr-3 font-medium' },
            { key: 'va', label: 'VA', className: 'px-3 py-3 font-medium' },
            { key: 'account', label: 'Account', className: 'px-3 py-3 font-medium' },
            { key: 'department', label: 'Department', className: 'px-3 py-3 font-medium' },
            { key: 'status', label: 'Status', className: 'px-3 py-3 font-medium' },
            { key: 'assigned', label: 'HR Specialist', className: 'px-3 py-3 font-medium' },
            { key: 'sent', label: 'RA sent', firstDir: 'desc', className: 'px-3 py-3 font-medium' },
            { key: 'days', label: 'In status', align: 'right', firstDir: 'desc', className: 'py-3 pl-3 pr-5 font-medium' },
          ]}
          empty={
            <tr>
              <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                {q || status !== 'OPEN' || who !== 'all' ? 'No Rate Agreements match.' : 'No open Rate Agreements.'}
              </td>
            </tr>
          }
          rows={rows.map((ra) => {
            const st = ra.status as RaStatus
            const days = Math.floor((now - ra.statusChangedAt.getTime()) / 86_400_000)
            const done = st === 'VA_ACKNOWLEDGED' || st === 'CANCELLED'
            const dept = deptName(requestDepartment(info, ra.request))
            const assigned = ra.assignedToEmail ? (names.get(ra.assignedToEmail) ?? ra.assignedToEmail) : null
            return {
              id: ra.id,
              values: {
                ticket: ra.ticket.ticketNumber * 100 + ra.request.lineNo,
                va: ra.candidate.vaName,
                account: ra.ticket.account.name,
                department: dept,
                status: RA_STATUSES.indexOf(st),
                assigned: assigned ?? '',
                sent: ra.sentOn,
                days: done ? null : days,
              },
              node: (
                <tr key={ra.id} className="group border-b align-top last:border-0 hover:bg-muted/50">
                  <td className="relative py-2.5 pl-5 pr-3">
                    <Link href={`/rate-agreements/${ra.id}`} className="font-mono font-medium after:absolute after:inset-0 group-hover:underline">
                      {subTicketCode(ra.ticket.ticketNumber, ra.request.lineNo)}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {SR_TYPE_LABELS[ra.ticket.type as SrType]} · {ra.request.service}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    {ra.candidate.vaName}
                    <p className="text-[11px] text-muted-foreground">{ra.candidate.role === 'MAIN' ? 'Main VA' : 'Buffer VA'}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    {ra.ticket.account.name}
                    {ra.ticket.customer.isTest && <TestBadge className="ml-2" />}
                    <p className="text-[11px] text-muted-foreground">{ra.ticket.customer.name}</p>
                  </td>
                  <td className="px-3 py-2.5">{dept}</td>
                  <td className="px-3 py-2.5">
                    <RaStatusPill status={st} />
                  </td>
                  {/* Above the row link, so the select stays usable. */}
                  <td className="relative z-10 px-3 py-2.5">
                    {canAssign && !done ? (
                      <RaAssignSelect id={ra.id} current={ra.assignedToEmail} people={people} compact />
                    ) : (
                      (assigned ?? <span className="text-warning">Not assigned</span>)
                    )}
                  </td>
                  <td className="px-3 py-2.5">{ra.sentOn ? day(ra.sentOn) : <span className="text-muted-foreground">–</span>}</td>
                  <td className="py-2.5 pl-3 pr-5 text-right text-muted-foreground">{done ? '–' : days === 0 ? 'Today' : `${days} d`}</td>
                </tr>
              ),
            }
          })}
        />
      </div>
    </main>
  )
}
