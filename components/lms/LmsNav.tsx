'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChartColumn, FileSignature, Plus, Settings, Users } from 'lucide-react'
import { BOARD_COLUMNS, COLUMN_META, type BoardColumn } from '@/components/lms/stage-meta'
import { PHASE_LABELS } from '@/lib/lead-phase-fields'
import { cn } from '@/lib/utils'

// The LMS sidebar's nav: the board as the main item, its columns as "Views"
// (each a filter on the board, with its live count), grouped by phase:
// Customer Intake's stages, then the phases after the form. Contracts sits
// with Contract & Billing. People who only have Lead reports (board false)
// see just the Reports item.
export function LmsNav({
  total,
  byColumn,
  board,
  showContracts,
  showReports,
  showSettings,
}: {
  total: number
  byColumn: Record<BoardColumn, number>
  board: boolean
  showContracts?: boolean
  showReports?: boolean
  showSettings?: boolean
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const onBoard = pathname === '/leads'
  const stage = onBoard ? searchParams.get('stage') : null
  const intake = BOARD_COLUMNS.filter((c) => COLUMN_META[c].phase === 'CUSTOMER_INTAKE')
  const later = BOARD_COLUMNS.filter((c) => COLUMN_META[c].phase !== 'CUSTOMER_INTAKE')

  const reportsLink = showReports && (
    <Link
      href="/leads/reports"
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium',
        pathname === '/leads/reports' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <ChartColumn className="h-[15px] w-[15px]" strokeWidth={1.75} />
      Reports
    </Link>
  )

  if (!board) return <nav className="flex flex-col gap-0.5">{reportsLink}</nav>

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-col gap-0.5">
        <Link
          href="/leads"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium',
            onBoard && !stage ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Users className="h-[15px] w-[15px]" strokeWidth={1.75} />
          Leads
          <span
            className={cn(
              'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums',
              onBoard && !stage ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {total}
          </span>
        </Link>
        <Link href="/leads?new=1" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus className="h-[15px] w-[15px]" strokeWidth={1.75} />
          New lead
        </Link>
        {reportsLink}
        {showSettings && (
          <Link
            href="/leads/settings"
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium',
              pathname === '/leads/settings' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Settings className="h-[15px] w-[15px]" strokeWidth={1.75} />
            Form settings
          </Link>
        )}
      </nav>

      <div className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{PHASE_LABELS.CUSTOMER_INTAKE}</p>
        {intake.map((c) => (
          <ViewLink key={c} column={c} active={stage === c} count={byColumn[c]} />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">After the form</p>
        {later.map((c) => (
          <div key={c} className="contents">
            <ViewLink column={c} active={stage === c} count={byColumn[c]} />
            {c === 'CONTRACT_BILLING_INITIATION' && showContracts && (
              <Link
                href="/leads/contracts"
                className={cn(
                  'ml-4 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px]',
                  pathname === '/leads/contracts' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <FileSignature className="h-3.5 w-3.5" strokeWidth={1.75} />
                Contracts
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ViewLink({ column, active, count }: { column: BoardColumn; active: boolean; count: number }) {
  const meta = COLUMN_META[column]
  return (
    <Link
      href={`/leads?stage=${column}`}
      className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]', active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} />
      <span className="min-w-0 truncate" title={meta.label}>
        {meta.label}
      </span>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
    </Link>
  )
}
