import Link from 'next/link'
import { Download, Search, Upload, X } from 'lucide-react'
import { ActivityFeed } from '@/components/cms/ActivityFeed'
import { CustomerLedger, type LedgerRow } from '@/components/cms/CustomerLedger'
import { PortfolioCard } from '@/components/cms/PortfolioCard'
import { STATUS_META, STATUS_ORDER } from '@/components/cms/status-meta'
import { requireArea } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { LIST_LIMIT, REAL_CUSTOMERS, customerPortfolio, listCustomers } from '@/lib/customers'
import { vaConnectionFigures } from '@/lib/service-requests'
import { customerScopeWhere } from '@/lib/scope'
import { staffNames } from '@/lib/workforce'
import { prisma } from '@/lib/prisma'
import { startedVaCountsByCustomer } from '@/lib/va-connection-hooks'
import { customerWarnings, type CustomerStatus } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'
import type { LeadPhase } from '@/lib/lead-phase-fields'

// The leads table shows this many until "Show all" is clicked (asked for on
// Nov 5, 2026): leads are Lead Management's work, so they stay out of the
// way of the customers below.
const LEADS_SHOWN = 5

// Still a lead: Pending and not yet onboarded by the CS team, the same rule
// as Lead Management's list (listLeads in lib/customers.ts).
const isLead = (c: { status: CustomerStatus; leadPhase: LeadPhase }) => c.status === 'PENDING' && c.leadPhase !== 'NEW_CUSTOMER_ONBOARDED'

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; cs?: string; review?: string; leads?: string }> }) {
  const user = await requireArea('customers', '/customers')
  const { q, status, cs, review, leads: leadsParam } = await searchParams
  // The customers table shows Active customers unless another status is
  // picked (asked for on Nov 5, 2026); ?status=all shows every status. The
  // CS Specialist and review views show every status, as before.
  const canImport = can(user.role, 'customerImport', 'create')
  const filtered = !!(cs || review)
  const picked = STATUS_ORDER.includes(status as CustomerStatus) ? (status as CustomerStatus) : null
  const activeStatus: CustomerStatus | null = picked ?? (status === 'all' || filtered ? null : 'ACTIVE')

  const now = new Date()
  const scope = await customerScopeWhere(user)
  const filters = { q, specialist: cs, review: review === '1', scope }
  // Leads are always Pending, so they're loaded on their own and the status
  // filter only applies to the customers table.
  const [{ rows: customerList, byStatus: partial, total }, { rows: pendingList }, portfolio, activeAccounts, va] = await Promise.all([
    listCustomers({ ...filters, status: activeStatus ?? undefined }),
    listCustomers({ ...filters, status: 'PENDING' }),
    customerPortfolio(now, scope),
    prisma.account.count({ where: { status: 'ACTIVE', customer: { AND: [scope ?? {}, REAL_CUSTOMERS] } } }),
    vaConnectionFigures(scope),
  ])
  const rows = [...pendingList.filter(isLead), ...customerList.filter((c) => !isLead(c))]
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, partial[s] ?? 0])) as Record<CustomerStatus, number>
  const [names, vaCounts] = await Promise.all([staffNames(rows.map((r) => r.assignedSpecialistEmail ?? '')), startedVaCountsByCustomer(prisma, rows.map((r) => r.id))])

  const ledger: LedgerRow[] = rows.map((c) => {
    const lead = isLead(c)
    return {
      id: c.id,
      name: c.name,
      code: c.customerCode,
      email: c.email,
      status: c.status,
      daysInStatus: Math.floor((now.getTime() - (lead ? c.leadPhaseChangedAt : c.statusChangedAt).getTime()) / 86_400_000),
      accountCount: c.accountCount,
      vasRequested: c.vasRequested,
      specialist: c.assignedSpecialistEmail ? (names.get(c.assignedSpecialistEmail) ?? c.assignedSpecialistEmail) : null,
      inReview: !!c.reviewAction,
      warnings: customerWarnings(c, vaCounts ? (vaCounts.get(c.id) ?? 0) : null),
      test: c.isTest,
      phase: lead ? c.leadPhase : null,
    }
  })
  const leadRows = ledger.filter((r) => r.phase)
  const customerRows = ledger.filter((r) => !r.phase)
  const allLeads = leadsParam === 'all'
  const shownLeads = allLeads ? leadRows : leadRows.slice(0, LEADS_SHOWN)
  // The same page and filters, with one of them changed.
  const pageHref = (next: { status?: string | null; leads?: boolean }) => {
    const p = new URLSearchParams()
    const st = next.status === undefined ? status : next.status
    for (const [k, v] of Object.entries({ q, status: st, cs, review, leads: (next.leads ?? allLeads) ? 'all' : null })) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/customers?${s}` : '/customers'
  }
  const leadsHref = (all: boolean) => pageHref({ leads: all })
  // The chips count the customers table only: leads (all Pending) are in
  // their own table above. Test records aren't counted, as everywhere.
  const realLeads = pendingList.filter((c) => isLead(c) && !c.isTest).length
  const statusChips: { value: string | null; label: string; count: number; dot?: string }[] = [
    // No status in the URL is the Active default.
    ...STATUS_ORDER.map((s) => ({
      value: s === 'ACTIVE' && !filtered ? null : s,
      label: STATUS_META[s].label,
      count: s === 'PENDING' ? Math.max(0, byStatus[s] - realLeads) : byStatus[s],
      dot: STATUS_META[s].dot,
    })),
    { value: 'all', label: 'All statuses', count: Math.max(0, total - realLeads) },
  ]

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
            {cs === 'none' ? 'Without a CS Specialist' : review === '1' ? 'Waiting for review' : 'Customers'}
            {filtered && (
              <Link href="/customers" className="rounded-full p-1 text-muted-foreground hover:bg-muted" title="Back to all customers" aria-label="Back to all customers">
                <X className="h-3.5 w-3.5" />
              </Link>
            )}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <form action="/customers" className="flex h-9 items-center gap-2 rounded-xl border bg-card px-3">
          {status && <input type="hidden" name="status" value={status} />}
          {cs && <input type="hidden" name="cs" value={cs} />}
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <label htmlFor="customer-search" className="sr-only">
            Search customers
          </label>
          <input
            id="customer-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, customer ID or email"
            className="w-44 bg-transparent text-[13px] outline-none sm:w-60"
          />
        </form>
        {/* Admins: the Customers import template and upload (lib/customer-import.ts). */}
        {canImport && (
          <div className="flex gap-2">
            <a
              href="/customers/import/template"
              download
              className="flex h-9 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-medium hover:bg-muted"
              title="The Excel template for importing customers"
            >
              <Download className="h-4 w-4" /> Template
            </a>
            <Link href="/customers/import" className="flex h-9 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-medium hover:bg-muted">
              <Upload className="h-4 w-4" /> Import
            </Link>
          </div>
        )}
        </div>
      </div>

      <PortfolioCard
        activeCustomers={byStatus.ACTIVE}
        pausedCustomers={byStatus.PAUSED}
        activeAccounts={activeAccounts}
        activeConnections={va.connections}
        vasConnected={va.vas}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {leadRows.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="leads-heading">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 id="leads-heading" className="text-sm font-semibold">
                  Leads <span className="font-normal text-muted-foreground">· {leadRows.length}</span>
                </h2>
                <p className="text-[12px] text-muted-foreground">Still in Lead Management, not yet onboarded</p>
              </div>
              <CustomerLedger rows={shownLeads} kind="leads" />
              {leadRows.length > LEADS_SHOWN && (
                <Link href={leadsHref(!allLeads)} scroll={false} className="self-start rounded-lg px-2 py-1 text-[13px] font-medium text-primary hover:bg-muted">
                  {allLeads ? 'Show fewer' : `Show all ${leadRows.length} leads`}
                </Link>
              )}
            </section>
          )}

          <section className="flex flex-col gap-2" aria-labelledby="customers-heading">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h2 id="customers-heading" className="text-sm font-semibold">
                {activeStatus ? `${STATUS_META[activeStatus].label} customers` : 'Customers'} <span className="font-normal text-muted-foreground">· {customerRows.length}</span>
              </h2>
              <nav className="flex flex-wrap gap-1" aria-label="Filter customers by status">
                {statusChips.map((c) => {
                  const on = c.value === (status ?? (filtered ? 'all' : null))
                  return (
                    <Link
                      key={c.label}
                      href={pageHref({ status: c.value })}
                      aria-current={on ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {c.dot && <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />}
                      {c.label} <span className="tabular-nums opacity-75">{c.count}</span>
                    </Link>
                  )
                })}
              </nav>
            </div>
            {customerList.length >= LIST_LIMIT && (
              <p className="px-1 text-[12px] text-warning">Showing the newest {LIST_LIMIT.toLocaleString()} customers. Pick a status or search to narrow it down.</p>
            )}
            {customerRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
                <p className="text-sm font-medium">{q ? `Nothing matches “${q}”.` : activeStatus ? `No ${STATUS_META[activeStatus].label.toLowerCase()} customers.` : 'No customers yet.'}</p>
                {!q && !activeStatus && <p className="mt-1 text-sm text-muted-foreground">Customers appear here once Lead Management adds them.</p>}
              </div>
            ) : (
              <CustomerLedger rows={customerRows} />
            )}
          </section>
        </div>
        <ActivityFeed items={portfolio.recent} />
      </div>
    </main>
  )
}
