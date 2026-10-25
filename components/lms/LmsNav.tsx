'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Plus, Users } from 'lucide-react'
import { STAGE_COLUMNS, STAGE_META } from '@/components/lms/stage-meta'
import type { OnboardingStage } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

// The LMS sidebar's nav: the board as the main item, onboarding stages as
// "Views" (each a filter on the board, with its live count).
export function LmsNav({ total, byStage }: { total: number; byStage: Record<OnboardingStage, number> }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const onBoard = pathname === '/leads'
  const stage = onBoard ? searchParams.get('stage') : null

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
      </nav>

      <div className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Views</p>
        {STAGE_COLUMNS.map((s) => (
          <Link
            key={s}
            href={`/leads?stage=${s}`}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]',
              stage === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', STAGE_META[s].dot)} />
            {STAGE_META[s].label}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{byStage[s]}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
