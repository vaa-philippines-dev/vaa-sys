import Link from 'next/link'
import { Search, X } from 'lucide-react'
import { ActivityFeed } from '@/components/cms/ActivityFeed'
import { CustomerLedger, type LedgerRow } from '@/components/cms/CustomerLedger'
import { PortfolioCard } from '@/components/cms/PortfolioCard'
import { STATUS_META, STATUS_ORDER } from '@/components/cms/status-meta'
import { requireArea } from '@/lib/auth'
import { customerPortfolio, listCustomers } from '@/lib/customers'
import type { CustomerStatus } from '@/lib/customer-fields'

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireArea('customers', '/customers')
  const { q, status } = await searchParams
  const activeStatus = STATUS_ORDER.includes(status as CustomerStatus) ? (status as CustomerStatus) : null

  const now = new Date()
  const [{ rows, byStatus: partial, total }, portfolio] = await Promise.all([listCustomers({ q, status: activeStatus ?? undefined }), customerPortfolio(now)])
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, partial[s] ?? 0])) as Record<CustomerStatus, number>

  const ledger: LedgerRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.customerCode,
    email: c.email,
    status: c.status,
    daysInStatus: Math.floor((now.getTime() - c.statusChangedAt.getTime()) / 86_400_000),
    accountCount: c.accountCount,
    vasRequested: c.vasRequested,
  }))

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
            {activeStatus ? STATUS_META[activeStatus].label : 'Customers'}
            {activeStatus && (
              <Link href="/customers" className="rounded-full p-1 text-muted-foreground hover:bg-muted" title="Show every status" aria-label="Show every status">
                <X className="h-3.5 w-3.5" />
              </Link>
            )}
          </h1>
        </div>
        <form action="/customers" className="flex h-9 items-center gap-2 rounded-xl border bg-card px-3">
          {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
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
      </div>

      <PortfolioCard byStatus={byStatus} total={total} accounts={portfolio.accounts} vasRequested={portfolio.vasRequested} changesThisWeek={portfolio.changesThisWeek} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {ledger.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
              <p className="text-sm font-medium">{q ? `Nothing matches “${q}”.` : activeStatus ? `No ${STATUS_META[activeStatus].label.toLowerCase()} customers.` : 'No customers yet.'}</p>
              {!q && !activeStatus && <p className="mt-1 text-sm text-muted-foreground">Customers appear here once Lead Management adds them.</p>}
            </div>
          ) : (
            <CustomerLedger rows={ledger} />
          )}
        </div>
        <ActivityFeed items={portfolio.recent} />
      </div>
    </main>
  )
}
