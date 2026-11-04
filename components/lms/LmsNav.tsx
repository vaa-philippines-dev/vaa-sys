'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChartColumn, FileSignature, KeyRound, Settings, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

// The LMS sidebar's nav: Leads, Contracts, Reports and Form settings, plus
// User access for admins, each shown to the roles that can open it. The phase views and "New lead" that
// used to sit here were taken out (asked for on Nov 4, 2026): New lead is on
// the Leads table, and the table shows each lead's phase. People who only have Lead
// reports (board false) see just the Reports item.
export function LmsNav({
  total,
  board,
  showContracts,
  showReports,
  showSettings,
  showAccess,
}: {
  total: number
  board: boolean
  showContracts?: boolean
  showReports?: boolean
  showSettings?: boolean
  // Admins only: User access (/leads/access).
  showAccess?: boolean
}) {
  const pathname = usePathname()
  // A lead's own page counts as Leads; the other /leads/… pages have their own item.
  const onLeads = pathname === '/leads' || pathname === '/leads/import' || /^\/leads\/(?!contracts|reports|settings|access|import|new)[^/]+$/.test(pathname)

  const item = (href: string, label: string, Icon: typeof Users, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium', active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
    >
      <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
      {label}
    </Link>
  )

  return (
    <nav className="flex flex-col gap-0.5">
      {board && (
        <Link
          href="/leads"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium',
            onLeads ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Users className="h-[15px] w-[15px]" strokeWidth={1.75} />
          Leads
          <span
            className={cn(
              'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums',
              onLeads ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {total}
          </span>
        </Link>
      )}
      {board && showContracts && item('/leads/contracts', 'Contracts', FileSignature, pathname === '/leads/contracts')}
      {showReports && item('/leads/reports', 'Reports', ChartColumn, pathname === '/leads/reports')}
      {board && showSettings && item('/leads/settings', 'Form settings', Settings, pathname === '/leads/settings')}
      {showAccess && item('/leads/access', 'User access', KeyRound, pathname === '/leads/access')}
    </nav>
  )
}
