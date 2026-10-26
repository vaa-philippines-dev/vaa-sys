import Link from 'next/link'
import { requireCan } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { specialistsOverview } from '@/lib/specialists'
import { dayString, manilaDate } from '@/lib/customer-fields'
import { STATUS_META, STATUS_ORDER } from '@/components/cms/status-meta'
import { CustomerBatch, CancelTakeoverButton } from '@/components/cms/SpecialistsBoard'
import { ROLE_LABELS } from '@/lib/access-fields'
import { cn } from '@/lib/utils'

const STATE_LABEL = { ACTIVE: 'Running', UPCOMING: 'Upcoming', EXPIRED: 'Ended', CANCELLED: 'Cancelled' } as const

// The CS team and their portfolios (legacy CS Specialists page): who owns
// which customers, who is covering for whom, and the customers nobody owns.
// CS Managers and admins reassign, transfer and set up takeovers here.
export default async function SpecialistsPage() {
  const user = await requireCan('csSpecialists', 'read', '/specialists')
  const manage = can(user.role, 'csSpecialists', 'update')
  const { team, portfolio, unassigned, takeovers } = await specialistsOverview()
  const teamOptions = team.map((m) => ({ email: m.email, name: m.name }))
  const fmt = (d: Date) => new Date(`${dayString(d)}T00:00:00+08:00`).toLocaleDateString('en-PH', manilaDate)

  return (
    <main className="w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">CS Specialists</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each Customer Specialist sees their own customers plus any they’re covering. Add people to the team on the{' '}
          {can(user.role, 'access') ? (
            <Link href="/access" className="text-primary hover:underline">
              Access
            </Link>
          ) : (
            'Access'
          )}{' '}
          page.
        </p>
      </div>

      {team.length === 0 && <p className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">No Customer Specialists yet.</p>}

      <section className="grid gap-4 lg:grid-cols-2">
        {portfolio.map((m) => (
          <article key={m.email} className="space-y-3 rounded-2xl border bg-card p-5">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display font-semibold">{m.name}</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {m.email} · {ROLE_LABELS[m.role]}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-2xl font-semibold leading-none tabular-nums">{m.byStatus.ACTIVE ?? 0}</p>
                <p className="text-[11px] text-muted-foreground">active of {m.customers.length}</p>
              </div>
            </header>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {STATUS_ORDER.filter((s) => m.byStatus[s]).map((s) => (
                <li key={s} className="flex items-center gap-1.5">
                  <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[s].dot)} />
                  {STATUS_META[s].label} <span className="tabular-nums text-muted-foreground">{m.byStatus[s]}</span>
                </li>
              ))}
              {m.covering > 0 && <li className="text-info">Covering {m.covering}</li>}
            </ul>
            {m.customers.length > 0 && (
              <CustomerBatch
                customers={m.customers}
                team={teamOptions.filter((t) => t.email !== m.email)}
                manage={manage}
                summary={`${m.customers.length} ${m.customers.length === 1 ? 'customer' : 'customers'}`}
              />
            )}
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Without a CS Specialist</h2>
        {unassigned.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every customer has a CS Specialist.</p>
        ) : (
          <div className="rounded-2xl border bg-card p-5">
            <CustomerBatch customers={unassigned} team={teamOptions} manage={manage} summary={`${unassigned.length} ${unassigned.length === 1 ? 'customer' : 'customers'}`} open assignOnly />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Takeovers</h2>
        <p className="text-sm text-muted-foreground">A takeover lets someone cover specific customers between two dates. Pick customers on a card above and choose “Cover”.</p>
        {takeovers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No takeovers in the last 60 days.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Covered by</th>
                  <th className="px-4 py-2.5 font-medium">Dates</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {takeovers.map((t) => (
                  <tr key={t.id} className={t.state === 'ACTIVE' || t.state === 'UPCOMING' ? '' : 'text-muted-foreground'}>
                    <td className="px-4 py-2.5">
                      <Link href={`/customers/${t.customer.id}`} className="hover:underline">
                        {t.customer.name}
                      </Link>
                      {t.reason && <span className="block text-xs text-muted-foreground">{t.reason}</span>}
                    </td>
                    <td className="px-4 py-2.5">{t.specialistName}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {fmt(t.startDate)} – {fmt(t.endDate)}
                    </td>
                    <td className="px-4 py-2.5">{STATE_LABEL[t.state]}</td>
                    <td className="px-4 py-2.5 text-right">{manage && (t.state === 'ACTIVE' || t.state === 'UPCOMING') && <CancelTakeoverButton id={t.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
