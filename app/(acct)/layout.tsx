import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { SignOutButton } from '@/components/layout/SignOutButton'
import { AcctNav, type AcctNavItem } from '@/components/acct/AcctNav'
import { SystemSwitcher } from '@/components/lms/SystemSwitcher'
import { EXTERNAL_SYSTEMS, type SystemLink } from '@/components/lms/systems'
import { initialsFrom } from '@/components/lms/stage-meta'
import { prisma } from '@/lib/prisma'
import { requireSignedIn, displayName } from '@/lib/auth'
import { ViewAsBanner } from '@/components/layout/ViewAsBanner'
import { canUse, homeFor, ROLE_LABELS } from '@/lib/access-fields'
import { can } from '@/lib/permissions'
import { REAL_CUSTOMERS } from '@/lib/customers'

// The Accounting System's shell: the same sidebar as the other two areas,
// in the .acct palette (app/globals.css). Everyone with billing → read gets
// in; each page still checks its own permission.
export default async function AcctLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSignedIn('/accounting')
  const r = user.role
  if (!can(r, 'billing')) redirect(homeFor(r))

  // Bills waiting for money: sent or partly paid, test leads left out.
  const open = await prisma.invoice.count({ where: { status: { in: ['SENT', 'PARTIALLY_PAID'] }, customer: REAL_CUSTOMERS } })
  const items: AcctNavItem[] = [
    { href: '/accounting', label: 'Bills', icon: 'invoices', count: open },
    { href: '/accounting/payments', label: 'Payments', icon: 'payments' },
    { href: '/accounting/foregone', label: 'Foregone Revenue', icon: 'foregone' },
    ...(can(r, 'billing', 'update') ? [{ href: '/accounting/settings', label: 'Rates & fees', icon: 'settings' } as AcctNavItem] : []),
  ]

  const others: SystemLink[] = [
    ...(canUse(r, 'leads') ? [{ label: 'Lead Management System', href: '/leads' }] : []),
    ...(canUse(r, 'customers') ? [{ label: 'Customer Management', href: '/customers' }] : []),
    ...(r === 'ADMIN' ? [{ label: 'All VAA systems', href: '/' }] : []),
    ...EXTERNAL_SYSTEMS,
  ]
  const name = displayName(user)
  const switcher = <SystemSwitcher current="Accounting System" others={others} />

  return (
    <div className="acct flex h-dvh flex-col overflow-hidden md:flex-row">
      <aside className="hidden h-full w-60 shrink-0 flex-col justify-between border-r bg-card px-4 py-5 md:flex">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link href="/accounting" className="flex items-center gap-2 px-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Image src="/vaa-logo-white.png" alt="VAA" width={350} height={134} className="h-auto w-6 dark:invert" priority />
              </span>
              <span className="text-sm font-semibold tracking-wide">VAA · Accounting</span>
            </Link>
            {switcher}
          </div>
          <Suspense>
            <AcctNav items={items} />
          </Suspense>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initialsFrom(name)}</div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium" title={user.email}>
                {name}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABELS[r]}</p>
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
        <Link href="/accounting" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Image src="/vaa-logo-white.png" alt="VAA" width={350} height={134} className="h-auto w-5 dark:invert" priority />
        </Link>
        <div className="min-w-0 flex-1">{switcher}</div>
        <ThemeToggle />
        <SignOutButton />
      </header>
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b bg-card px-4 py-1.5 md:hidden" aria-label="Accounting System">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="shrink-0 rounded-lg px-2.5 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
            {i.label}
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <ViewAsBanner user={user} />
        {children}
      </div>
    </div>
  )
}
