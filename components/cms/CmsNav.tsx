'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Building2, CheckCheck, FileSignature, History, KeyRound, Settings2, UserCog, Users } from 'lucide-react'
import { STATUS_META, STATUS_ORDER } from '@/components/cms/status-meta'
import type { CustomerStatus } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

const ICONS = {
  customers: Users,
  accounts: Building2,
  specialists: UserCog,
  approvals: CheckCheck,
  contracts: FileSignature,
  activity: History,
  settings: Settings2,
  access: KeyRound,
} as const

export type CmsNavItem = { href: string; label: string; icon: keyof typeof ICONS; count?: number; alert?: boolean }

// Customer Management's sidebar nav: the pages this person may open (worked
// out on the server from lib/permissions.ts), then a view per customer
// status with its live count.
export function CmsNav({ items, byStatus }: { items: CmsNavItem[]; byStatus: Record<CustomerStatus, number> }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const onList = pathname === '/customers'
  const status = onList ? searchParams.get('status') : null

  const isActive = (href: string) =>
    href === '/customers' ? (pathname === '/customers' || pathname.startsWith('/customers/')) && !status : pathname === href || pathname.startsWith(`${href}/`)

  const item = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium',
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    )

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-col gap-0.5">
        {items.map((n) => {
          const Icon = ICONS[n.icon]
          const active = isActive(n.href)
          return (
            <Link key={n.href} href={n.href} className={item(active)}>
              <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
              {n.label}
              {n.count !== undefined && (n.count > 0 || !n.alert) && (
                <span
                  className={cn(
                    'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums',
                    active ? 'bg-primary-foreground/15 text-primary-foreground' : n.alert ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {n.count}
                </span>
              )}
            </Link>
          )
        })}
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
