import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { SignOutButton } from '@/components/layout/SignOutButton'
import { LmsNav } from '@/components/lms/LmsNav'
import { SystemSwitcher } from '@/components/lms/SystemSwitcher'
import { EXTERNAL_SYSTEMS, type SystemLink } from '@/components/lms/systems'
import { STAGE_COLUMNS, initialsFrom } from '@/components/lms/stage-meta'
import { requireArea, displayName } from '@/lib/auth'
import { canUse, ROLE_LABELS } from '@/lib/access-fields'
import { listLeads } from '@/lib/customers'
import type { OnboardingStage } from '@/lib/customer-fields'

// Lead Management keeps the original lead-management-sys design: sidebar
// layout and the .lms palette (app/globals.css). Everything else in vaa-sys
// uses the top-bar layout in app/(app)/layout.tsx.
export default async function LmsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireArea('leads', '/leads')
  const leads = await listLeads()
  const byStage = Object.fromEntries(STAGE_COLUMNS.map((s) => [s, leads.filter((l) => l.stage === s).length])) as Record<OnboardingStage, number>

  const others: SystemLink[] = [
    ...(canUse(user.role, 'customers') ? [{ label: 'Customer Management', href: '/customers' }] : []),
    ...(user.role === 'ADMIN' ? [{ label: 'All VAA systems', href: '/' }] : []),
    ...EXTERNAL_SYSTEMS,
  ]
  const name = displayName(user)

  return (
    <div className="lms flex h-dvh flex-col overflow-hidden md:flex-row">
      <aside className="hidden h-full w-60 shrink-0 flex-col justify-between border-r bg-card px-4 py-5 md:flex">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link href="/leads" className="flex items-center gap-2 px-1">
              <Image src="/vaaleadms.png" alt="VAA" width={64} height={64} className="h-8 w-8" priority />
              <span className="text-sm font-semibold tracking-wide">VAA · LMS</span>
            </Link>
            <SystemSwitcher current="Lead Management System" others={others} />
          </div>
          <Suspense>
            <LmsNav total={leads.length} byStage={byStage} showSettings={canUse(user.role, 'settings')} />
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
        <Link href="/leads" className="shrink-0">
          <Image src="/vaaleadms.png" alt="VAA" width={64} height={64} className="h-7 w-7" priority />
        </Link>
        <div className="min-w-0 flex-1">
          <SystemSwitcher current="Lead Management System" others={others} />
        </div>
        <ThemeToggle />
        <SignOutButton />
      </header>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  )
}
