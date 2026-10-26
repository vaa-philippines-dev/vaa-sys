import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { SignOutButton } from '@/components/layout/SignOutButton'
import { CmsNav, type CmsNavItem } from '@/components/cms/CmsNav'
import { STATUS_ORDER } from '@/components/cms/status-meta'
import { SystemSwitcher } from '@/components/lms/SystemSwitcher'
import { EXTERNAL_SYSTEMS, type SystemLink } from '@/components/lms/systems'
import { initialsFrom } from '@/components/lms/stage-meta'
import { prisma } from '@/lib/prisma'
import { requireSignedIn, displayName } from '@/lib/auth'
import { canUse, homeFor, ROLE_LABELS } from '@/lib/access-fields'
import { can } from '@/lib/permissions'
import { customerScopeWhere } from '@/lib/scope'
import { countPendingReviews } from '@/lib/customers'
import { redirect } from 'next/navigation'
import type { CustomerStatus } from '@/lib/customer-fields'

// Customer Management's shell: the LMS sidebar pattern in the .cms palette
// (app/globals.css). Holds every Customer Management page; each page still
// checks its own permission.
export default async function CmsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSignedIn()
  const r = user.role
  if (!can(r, 'customers') && !can(r, 'access') && !can(r, 'settings')) redirect(homeFor(r))

  const scope = await customerScopeWhere(user)
  const [counts, reviews] = await Promise.all([
    prisma.customer.groupBy({ by: ['status'], where: scope ?? {}, _count: { _all: true } }),
    can(r, 'approvals', 'update') ? countPendingReviews() : Promise.resolve(0),
  ])
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0])) as Record<CustomerStatus, number>
  const total = counts.reduce((sum, c) => sum + c._count._all, 0)

  const candidates: (CmsNavItem | false)[] = [
    can(r, 'customers') && { href: '/customers', label: 'Customers', icon: 'customers', count: total },
    can(r, 'accounts') && { href: '/accounts', label: 'Accounts', icon: 'accounts' },
    can(r, 'csSpecialists') && { href: '/specialists', label: 'CS Specialists', icon: 'specialists' },
    can(r, 'approvals', 'update') && { href: '/approvals', label: 'Approvals', icon: 'approvals', count: reviews, alert: true },
    can(r, 'contracts') && { href: '/contracts', label: 'Contracts', icon: 'contracts' },
    can(r, 'activityLogs') && { href: '/activity', label: 'Activity log', icon: 'activity' },
    can(r, 'settings') && { href: '/settings', label: 'Settings', icon: 'settings' },
    can(r, 'access') && { href: '/access', label: 'Access', icon: 'access' },
  ]
  const items = candidates.filter((i): i is CmsNavItem => !!i)

  const others: SystemLink[] = [
    ...(canUse(user.role, 'leads') ? [{ label: 'Lead Management System', href: '/leads' }] : []),
    ...(user.role === 'ADMIN' ? [{ label: 'All VAA systems', href: '/' }] : []),
    ...EXTERNAL_SYSTEMS,
  ]
  const name = displayName(user)
  const switcher = <SystemSwitcher current="Customer Management" others={others} />

  return (
    <div className="cms flex h-dvh flex-col overflow-hidden md:flex-row">
      <aside className="hidden h-full w-60 shrink-0 flex-col justify-between border-r bg-card px-4 py-5 md:flex">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link href="/customers" className="flex items-center gap-2 px-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Image src="/vaa-logo-white.png" alt="VAA" width={350} height={134} className="h-auto w-6 dark:invert" priority />
              </span>
              <span className="font-display text-sm font-semibold tracking-wide">VAA · CMS</span>
            </Link>
            {switcher}
          </div>
          <Suspense>
            <CmsNav items={items} byStatus={byStatus} />
          </Suspense>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initialsFrom(name)}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium" title={user.email}>
                {name}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Phones: the sidebar folds into a top bar. */}
      <header className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2 md:hidden">
        <Link href="/customers" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Image src="/vaa-logo-white.png" alt="VAA" width={350} height={134} className="h-auto w-5 dark:invert" priority />
        </Link>
        <div className="min-w-0 flex-1">{switcher}</div>
        <ThemeToggle />
        <SignOutButton />
      </header>
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b bg-card px-4 py-1.5 md:hidden" aria-label="Customer Management">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="shrink-0 rounded-lg px-2.5 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
            {i.label}
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  )
}
