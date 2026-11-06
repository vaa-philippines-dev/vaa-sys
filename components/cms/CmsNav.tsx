'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, CalendarClock, CheckCheck, ClipboardList, FileSignature, HandCoins, History, KeyRound, Link2, Network, Settings2, UserCog, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = {
  customers: Users,
  accounts: Building2,
  requests: ClipboardList,
  schedule: CalendarClock,
  connections: Link2,
  rates: HandCoins,
  specialists: UserCog,
  approvals: CheckCheck,
  contracts: FileSignature,
  departments: Network,
  activity: History,
  settings: Settings2,
  access: KeyRound,
} as const

export type CmsNavItem = { section: string; href: string; label: string; icon: keyof typeof ICONS; count?: number; alert?: boolean }

// Customer Management's sidebar nav: the pages this person may open (worked
// out on the server from lib/permissions.ts), in sections (Nov 6, 2026:
// Customer Success, Human Resources, Company, Settings). A section with
// nothing this person can open isn't shown. The "By status" views that used
// to sit under it were taken out (Nov 6, 2026): the Customers page has its
// own status chips, and the Customers count is the Active customers.
export function CmsNav({ items }: { items: CmsNavItem[] }) {
  const pathname = usePathname()

  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  // The longest matching link wins, so Schedule changes, not Service Requests,
  // is marked on /service-requests/schedule-changes.
  const isActive = (href: string) => under(href) && !items.some((i) => i.href.length > href.length && i.href.startsWith(`${href}/`) && under(i.href))

  const item = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium',
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    )
  const sections = [...new Set(items.map((i) => i.section))]

  return (
    <nav className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">{section}</p>
          {items
            .filter((n) => n.section === section)
            .map((n) => {
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
        </div>
      ))}
    </nav>
  )
}
