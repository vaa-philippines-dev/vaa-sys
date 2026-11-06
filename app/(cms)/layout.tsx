import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { SignOutButton } from '@/components/layout/SignOutButton'
import { CmsNav, type CmsNavItem } from '@/components/cms/CmsNav'
import { SystemSwitcher } from '@/components/lms/SystemSwitcher'
import { EXTERNAL_SYSTEMS, type SystemLink } from '@/components/lms/systems'
import { initialsFrom } from '@/components/lms/stage-meta'
import { prisma } from '@/lib/prisma'
import { requireSignedIn, displayName, rateViewerEmail } from '@/lib/auth'
import { canViewRates } from '@/lib/rates'
import { canUse, grantableRoles, homeFor, ROLE_LABELS } from '@/lib/access-fields'
import { accessPeopleWhoLeft } from '@/lib/access-staff'
import { countSchedulesToReview } from '@/lib/request-schedule'
import { countRaWaitingOn } from '@/lib/rate-agreements'
import { hrTicketWhere } from '@/lib/service-requests'
import { ViewAsBanner } from '@/components/layout/ViewAsBanner'
import { can } from '@/lib/permissions'
import { customerScopeWhere } from '@/lib/scope'
import { REAL_CUSTOMERS, countPendingReviews } from '@/lib/customers'
import { redirect } from 'next/navigation'

// Customer Management's shell: the LMS sidebar pattern in the .cms palette
// (app/globals.css). Holds every Customer Management page; each page still
// checks its own permission.
export default async function CmsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSignedIn()
  const r = user.role
  if (!can(r, 'customers') && !can(r, 'access') && !can(r, 'settings') && !can(r, 'serviceRequests')) redirect(homeFor(r))

  const scope = await customerScopeWhere(user)
  const [activeCustomers, activeAccounts, reviews, openRequests, leftStaff, scheduleReviews, rateAgreements] = await Promise.all([
    // The Customers and Accounts counts are the Active ones (Nov 6, 2026).
    can(r, 'customers') ? prisma.customer.count({ where: { AND: [scope ?? {}, REAL_CUSTOMERS, { status: 'ACTIVE' }] } }) : Promise.resolve(0),
    can(r, 'accounts') ? prisma.account.count({ where: { status: 'ACTIVE', customer: { AND: [scope ?? {}, REAL_CUSTOMERS] } } }) : Promise.resolve(0),
    can(r, 'approvals', 'update') ? countPendingReviews() : Promise.resolve(0),
    can(r, 'serviceRequests')
      ? prisma.ticket.count({ where: { phase: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] }, customer: { AND: [scope ?? {}, REAL_CUSTOMERS] }, ...hrTicketWhere(user) } }).catch(() => 0)
      : Promise.resolve(0),
    // People with access who have left VAA in Workforce, among those this
    // person can remove.
    can(r, 'access') ? accessPeopleWhoLeft().then((l) => l.filter((p) => grantableRoles(r).includes(p.role)).length).catch(() => 0) : Promise.resolve(0),
    can(r, 'scheduleReviews') ? countSchedulesToReview().catch(() => 0) : Promise.resolve(0),
    // An HR Specialist's open Rate Agreements; an HR Manager's unassigned ones.
    can(r, 'rateAgreements') ? countRaWaitingOn(user).catch(() => 0) : Promise.resolve(0),
  ])

  // Departments & services is also here, under Company, for admins and the
  // people allowed to see the confidential rates.
  const seesDepartments = can(r, 'workforceOrg') || (await canViewRates(rateViewerEmail(user)))

  // The sidebar's sections (Nov 6, 2026): Customer Success, Human Resources,
  // Company, Settings.
  const CS = 'Customer Success'
  const HR = 'Human Resources'
  const CO = 'Company'
  const SET = 'Settings'
  const candidates: (CmsNavItem | false)[] = [
    can(r, 'customers') && { section: CS, href: '/customers', label: 'Customers', icon: 'customers', count: activeCustomers },
    can(r, 'accounts') && { section: CS, href: '/accounts', label: 'Accounts', icon: 'accounts', count: activeAccounts },
    can(r, 'serviceRequests') && { section: CS, href: '/service-requests', label: 'Service Requests', icon: 'requests', count: openRequests },
    can(r, 'scheduleReviews') && { section: CS, href: '/service-requests/schedule-changes', label: 'Schedule changes', icon: 'schedule', count: scheduleReviews, alert: true },
    can(r, 'vaConnections') && { section: CS, href: '/va-connections', label: 'VA Connections', icon: 'connections' },
    can(r, 'csSpecialists') && { section: CS, href: '/specialists', label: 'CS Specialists', icon: 'specialists' },
    can(r, 'approvals', 'update') && { section: CS, href: '/approvals', label: 'Approvals', icon: 'approvals', count: reviews, alert: true },
    can(r, 'rateAgreements') && { section: HR, href: '/rate-agreements', label: 'Rate Agreements', icon: 'rates', count: rateAgreements, alert: true },
    can(r, 'contracts') && { section: CO, href: '/contracts', label: 'Contracts', icon: 'contracts' },
    seesDepartments && { section: CO, href: '/departments', label: 'Departments & services', icon: 'departments' },
    can(r, 'settings') && { section: SET, href: '/settings', label: 'Settings', icon: 'settings' },
    can(r, 'access') && { section: SET, href: '/access', label: 'Access', icon: 'access', count: leftStaff, alert: true },
    can(r, 'activityLogs') && { section: SET, href: '/activity', label: 'Activity log', icon: 'activity' },
  ]
  const items = candidates.filter((i): i is CmsNavItem => !!i)

  const others: SystemLink[] = [
    // CS Managers and Executives reach Lead Management for its reports only.
    ...(canUse(user.role, 'leads')
      ? [{ label: 'Lead Management System', href: '/leads' }]
      : can(r, 'leadReports')
        ? [{ label: 'Lead reports', href: '/leads/reports' }]
        : []),
    ...(can(r, 'billing') ? [{ label: 'Accounting System', href: '/accounting' }] : []),
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
            <CmsNav items={items} />
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

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <ViewAsBanner user={user} />
        {children}
      </div>
    </div>
  )
}
