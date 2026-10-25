import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { SignOutButton } from '@/components/layout/SignOutButton'
import { CmsNav } from '@/components/cms/CmsNav'
import { STATUS_ORDER } from '@/components/cms/status-meta'
import { SystemSwitcher } from '@/components/lms/SystemSwitcher'
import { EXTERNAL_SYSTEMS, type SystemLink } from '@/components/lms/systems'
import { initialsFrom } from '@/components/lms/stage-meta'
import { prisma } from '@/lib/prisma'
import { requireSignedIn, displayName } from '@/lib/auth'
import { canUse, homeFor, ROLE_LABELS } from '@/lib/access-fields'
import { redirect } from 'next/navigation'
import type { CustomerStatus } from '@/lib/customer-fields'

// Customer Management's shell: the LMS sidebar pattern in the .cms palette
// (app/globals.css). Holds /customers and /access.
export default async function CmsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSignedIn()
  if (!canUse(user.role, 'customers') && !canUse(user.role, 'access')) redirect(homeFor(user.role))

  const counts = await prisma.customer.groupBy({ by: ['status'], _count: { _all: true } })
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0])) as Record<CustomerStatus, number>
  const total = counts.reduce((sum, c) => sum + c._count._all, 0)

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
            <CmsNav total={total} byStatus={byStatus} showAccess={canUse(user.role, 'access')} />
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

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  )
}
