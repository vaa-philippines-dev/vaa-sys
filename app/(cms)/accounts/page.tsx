import Link from 'next/link'
import { Hourglass, Search, X } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { listAccounts } from '@/lib/accounts'
import { customerScopeWhere } from '@/lib/scope'
import { ACCOUNT_STATUSES, STATUS_LABELS, type AccountStatus } from '@/lib/customer-fields'
import { STATUS_META } from '@/components/cms/status-meta'
import { cn } from '@/lib/utils'

// Every account the person can see (legacy Accounts list), filterable by
// status and searchable by account, company or customer.
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requireCan('accounts', 'read', '/accounts')
  const { q, status } = await searchParams
  const active = ACCOUNT_STATUSES.includes(status as AccountStatus) ? (status as AccountStatus) : null
  const { rows, byStatus } = await listAccounts({ q, status: active ?? undefined, scope: await customerScopeWhere(user) })

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
            {active ? `${STATUS_LABELS[active]} accounts` : 'Accounts'}
            {active && (
              <Link href="/accounts" className="rounded-full p-1 text-muted-foreground hover:bg-muted" title="Show every status" aria-label="Show every status">
                <X className="h-3.5 w-3.5" />
              </Link>
            )}
          </h1>
        </div>
        <form action="/accounts" className="flex h-9 items-center gap-2 rounded-xl border bg-card px-3">
          {active && <input type="hidden" name="status" value={active} />}
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <label htmlFor="account-search" className="sr-only">
            Search accounts
          </label>
          <input id="account-search" name="q" type="search" defaultValue={q} placeholder="Account, company or customer" className="w-44 bg-transparent text-[13px] outline-none sm:w-60" />
        </form>
      </div>

      <ul className="flex flex-wrap gap-2">
        {ACCOUNT_STATUSES.map((s) => (
          <li key={s}>
            <Link
              href={`/accounts?status=${s}`}
              className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs', active === s ? 'bg-muted font-medium' : 'bg-card text-muted-foreground hover:bg-muted')}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[s].dot)} />
              {STATUS_LABELS[s]} <span className="tabular-nums">{byStatus[s] ?? 0}</span>
            </Link>
          </li>
        ))}
      </ul>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-6 py-14 text-center text-sm text-muted-foreground">
          {q ? `Nothing matches “${q}”.` : 'No accounts yet. The first account is made when a customer submits the onboarding form.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b">
                <th className="py-3 pl-6 pr-3 font-medium">Account</th>
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="hidden px-3 py-3 font-medium md:table-cell">Category · Type</th>
                <th className="hidden py-3 pl-3 pr-6 font-medium lg:table-cell">Country / region</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="group border-b last:border-b-0 hover:bg-muted/50">
                  <td className={cn('relative py-3 pl-6 pr-3 before:absolute before:inset-y-2.5 before:left-2.5 before:w-1 before:rounded-full', STATUS_META[a.status].stripe)}>
                    <Link href={`/accounts/${a.id}`} className="font-medium group-hover:underline">
                      {a.name}
                    </Link>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {a.accountCode}
                      {a.companyName !== a.name && <span className="font-sans"> · {a.companyName}</span>}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/customers/${a.customer.id}`} className="hover:underline">
                      {a.customer.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium', STATUS_META[a.status].soft)}>{STATUS_LABELS[a.status]}</span>
                      {a.isReturning && <span className="rounded-full bg-info/12 px-2 py-0.5 text-[11px] font-medium text-info">Returning</span>}
                      {a.reviewAction && <Hourglass className="h-3.5 w-3.5 text-warning" aria-label="Waiting for review" />}
                    </span>
                  </td>
                  <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">{[a.category?.label, a.type?.label].filter(Boolean).join(' · ') || '–'}</td>
                  <td className="hidden py-3 pl-3 pr-6 text-muted-foreground lg:table-cell">{a.countryRegion?.label ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
