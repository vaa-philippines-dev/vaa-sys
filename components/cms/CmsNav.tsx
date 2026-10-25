'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { KeyRound, Users } from 'lucide-react'
import { STATUS_META, STATUS_ORDER } from '@/components/cms/status-meta'
import type { CustomerStatus } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

// Customer Management's sidebar nav: all customers, a view per status with
// its live count, and Access for those who manage it.
export function CmsNav({ total, byStatus, showAccess }: { total: number; byStatus: Record<CustomerStatus, number>; showAccess: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const onList = pathname === '/customers'
  const status = onList ? searchParams.get('status') : null
  // A customer's own page still belongs under "Customers".
  const inCustomers = pathname === '/customers' || pathname.startsWith('/customers/')

  const item = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium',
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    )

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-col gap-0.5">
        <Link href="/customers" className={item(inCustomers && !status)}>
          <Users className="h-[15px] w-[15px]" strokeWidth={1.75} />
          Customers
          <span
            className={cn(
              'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums',
              inCustomers && !status ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {total}
          </span>
        </Link>
        {showAccess && (
          <Link href="/access" className={item(pathname === '/access')}>
            <KeyRound className="h-[15px] w-[15px]" strokeWidth={1.75} />
            Access
          </Link>
        )}
      </nav>

      <div className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">By status</p>
        {STATUS_ORDER.map((s) => (
          <Link
            key={s}
            href={`/customers?status=${s}`}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]',
              status === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[s].dot)} />
            {STATUS_META[s].label}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{byStatus[s]}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
