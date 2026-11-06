import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { SignOutButton } from '@/components/layout/SignOutButton'
import { LmsNav } from '@/components/lms/LmsNav'
import { SystemSwitcher } from '@/components/lms/SystemSwitcher'
import { EXTERNAL_SYSTEMS, type SystemLink } from '@/components/lms/systems'
import { initialsFrom } from '@/components/lms/stage-meta'
import { redirect } from 'next/navigation'
import { requireSignedIn, displayName, rateViewerEmail } from '@/lib/auth'
import { ViewAsBanner } from '@/components/layout/ViewAsBanner'
import { canUse, homeFor, ROLE_LABELS } from '@/lib/access-fields'
import { can } from '@/lib/permissions'
import { listLeads } from '@/lib/customers'
import { canViewRates } from '@/lib/rates'
import { countSchedulesToReview } from '@/lib/request-schedule'

// Lead Management keeps the original lead-management-sys design: sidebar
// layout and the .lms palette (app/globals.css). Everything else in vaa-sys
// uses the top-bar layout in app/(app)/layout.tsx.
//
// The Lead Manager uses the whole area. CS Managers and Executives only get
// Lead reports, so for them the sidebar shows just that; every page still
// checks its own permission.
export default async function LmsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSignedIn('/leads')
  const board = canUse(user.role, 'leads')
  const reports = can(user.role, 'leadReports')
  // Someone allowed to see the confidential service rates gets Departments &
  // services even without the rest of Lead Management.
  const departments = can(user.role, 'workforceOrg') || (await canViewRates(rateViewerEmail(user)))
  if (!board && !reports && !departments) redirect(homeFor(user.role))
  const home = board ? '/leads' : reports ? '/leads/reports' : '/leads/departments'

  const [leads, scheduleChanges] = await Promise.all([
    board ? listLeads() : Promise.resolve([]),
    // The Lead Manager is told about schedule changes that affect billing.
    board && can(user.role, 'scheduleReviews') ? countSchedulesToReview().catch(() => 0) : Promise.resolve(null),
  ])

  const others: SystemLink[] = [
    ...(canUse(user.role, 'customers') ? [{ label: 'Customer Management', href: '/customers' }] : []),
    ...(can(user.role, 'billing') ? [{ label: 'Accounting System', href: '/accounting' }] : []),
    ...(user.role === 'ADMIN' ? [{ label: 'All VAA systems', href: '/' }] : []),
    ...EXTERNAL_SYSTEMS,
  ]
  const name = displayName(user)

  return (
    <div className="lms flex h-dvh flex-col overflow-hidden md:flex-row">
      <aside className="hidden h-full w-60 shrink-0 flex-col justify-between border-r bg-card px-4 py-5 md:flex">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link href={home} className="flex items-center gap-2 px-1">
              <Image src="/vaaleadms.png" alt="VAA" width={64} height={64} className="h-8 w-8" priority />
              <span className="text-sm font-semibold tracking-wide">VAA · LMS</span>
            </Link>
            <SystemSwitcher current="Lead Management System" others={others} />
          </div>
          <Suspense>
            <LmsNav
              total={leads.filter((l) => !l.isTest).length}
              board={board}
              showContracts={can(user.role, 'contracts')}
              showReports={reports}
              showSettings={can(user.role, 'settings', 'update')}
              showDepartments={departments}
              showAccess={can(user.role, 'userAccess')}
              scheduleChanges={scheduleChanges}
            />
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
        <Link href={home} className="shrink-0">
          <Image src="/vaaleadms.png" alt="VAA" width={64} height={64} className="h-7 w-7" priority />
        </Link>
        <div className="min-w-0 flex-1">
          <SystemSwitcher current="Lead Management System" others={others} />
        </div>
        <ThemeToggle />
        <SignOutButton />
      </header>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <ViewAsBanner user={user} />
        {children}
      </div>
    </div>
  )
}
