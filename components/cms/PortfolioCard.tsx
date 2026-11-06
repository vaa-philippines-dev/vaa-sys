import Link from 'next/link'

// The Customers page's figures (asked for on Nov 5, 2026, replacing the
// status mix): active and paused customers, active accounts, and the VAs
// working. All counted from the database, test records left out.
export function PortfolioCard({
  activeCustomers,
  pausedCustomers,
  activeAccounts,
  activeConnections,
  vasConnected,
}: {
  activeCustomers: number
  pausedCustomers: number
  activeAccounts: number
  activeConnections: number
  vasConnected: number
}) {
  const figures = [
    { value: activeCustomers, label: 'Active customers', href: '/customers' },
    { value: activeAccounts, label: 'Active accounts', href: '/accounts?status=ACTIVE' },
    { value: pausedCustomers, label: 'Paused customers', href: '/customers?status=PAUSED' },
    { value: activeConnections, label: 'Active VA connections', hint: 'Started' },
    { value: vasConnected, label: 'Active VAs connected', hint: 'Different VAs working' },
  ]
  return (
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3 lg:grid-cols-5" aria-label="Customer figures">
      {figures.map((f) => {
        const body = (
          <>
            <dd className="font-display text-[28px] font-semibold leading-none tabular-nums tracking-tight">{f.value.toLocaleString()}</dd>
            <dt className="mt-1.5 text-[12px] leading-tight text-muted-foreground">
              {f.label}
              {f.hint && <span className="block text-[11px]">{f.hint}</span>}
            </dt>
          </>
        )
        return (
          <dl key={f.label} className="bg-card">
            {f.href ? (
              <Link href={f.href} className="flex h-full flex-col-reverse justify-end p-5 hover:bg-muted/50">
                {body}
              </Link>
            ) : (
              <div className="flex h-full flex-col-reverse justify-end p-5">{body}</div>
            )}
          </dl>
        )
      })}
    </section>
  )
}
