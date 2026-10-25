'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Search, X } from 'lucide-react'
import { NewLeadForm } from '@/components/leads/NewLeadForm'
import { STAGE_COLUMNS, STAGE_META, initialsFrom } from '@/components/lms/stage-meta'
import type { OnboardingStage } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

export type BoardLead = {
  id: string
  name: string
  code: string
  email: string | null
  stage: OnboardingStage
  day: number
}

// The LMS Kanban board, with onboarding stages as its columns, plus the
// right-hand "New lead" drawer.
export function LeadsBoard({ leads, stage, openNew }: { leads: BoardLead[]; stage: OnboardingStage | null; openNew: boolean }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(openNew)

  const closeDrawer = () => {
    setDrawerOpen(false)
    if (openNew) router.replace(stage ? `/leads?stage=${stage}` : '/leads')
  }

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? leads.filter((l) => `${l.name} ${l.code} ${l.email ?? ''}`.toLowerCase().includes(q)) : leads
  }, [leads, query])

  const columns = stage ? [stage] : STAGE_COLUMNS
  const submitted = leads.filter((l) => l.stage === 'SUBMITTED').length

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Image src="/vaaleadms.png" alt="" width={40} height={40} className="h-5 w-5 object-contain" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              {stage ? STAGE_META[stage].label : 'Leads'}
              {stage && (
                <Link href="/leads" className="rounded-full p-1 text-muted-foreground hover:bg-muted" title="Show all stages" aria-label="Show all stages">
                  <X className="h-3.5 w-3.5" />
                </Link>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {leads.length} {leads.length === 1 ? 'lead' : 'leads'} in onboarding · {submitted} {submitted === 1 ? 'form' : 'forms'} submitted
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-xl border bg-card px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="sr-only">Search leads</span>
            <input
              id="lead-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads…"
              className="w-40 bg-transparent text-[13px] outline-none sm:w-56"
            />
          </label>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New lead
          </button>
        </div>
      </div>

      {leads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {stage ? 'No leads at this stage right now.' : 'No leads yet. Add the first one with “New lead” above, then send them their onboarding link.'}
        </p>
      ) : (
        <div className="no-scrollbar flex flex-1 gap-6 overflow-x-auto pb-2">
          {columns.map((s) => {
            const meta = STAGE_META[s]
            const columnLeads = filtered.filter((l) => l.stage === s)
            return (
              <section key={s} aria-label={meta.label} className="flex w-[268px] shrink-0 flex-col gap-3">
                <h2 className="flex items-center gap-1.5 px-0.5 text-[13px] font-medium">
                  <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
                  {meta.label}
                  <span className="tabular-nums text-muted-foreground">{columnLeads.length}</span>
                </h2>
                <div className="flex flex-col gap-2.5">
                  {columnLeads.map((l) => (
                    <Link key={l.id} href={`/leads/${l.id}`} className="relative flex flex-col gap-3 rounded-xl border bg-card px-4 py-3.5 transition-shadow hover:shadow-md">
                      <span className="truncate pr-4 text-[13.5px] font-medium">{l.name}</span>
                      <p className="truncate text-[12.5px] text-muted-foreground">{l.email || 'No email yet'}</p>
                      <div className="flex items-center justify-between pt-0.5 text-[11.5px] text-muted-foreground">
                        <span>Day {l.day}</span>
                        <span className="font-mono">{l.code}</span>
                      </div>
                      <span
                        className={cn('absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-card', meta.soft)}
                        aria-hidden
                      >
                        {initialsFrom(l.name)}
                      </span>
                    </Link>
                  ))}
                  {s === 'NEW' && (
                    <button
                      type="button"
                      onClick={() => setDrawerOpen(true)}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                    >
                      <Plus className="h-3.5 w-3.5" /> New lead
                    </button>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <div className={cn('fixed inset-0 z-40', !drawerOpen && 'pointer-events-none')} aria-hidden={!drawerOpen}>
        <div onClick={closeDrawer} className={cn('absolute inset-0 bg-black/40 transition-opacity', drawerOpen ? 'opacity-100' : 'opacity-0')} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-lead-title"
          className={cn('absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-card shadow-2xl transition-transform', drawerOpen ? 'translate-x-0' : 'translate-x-full')}
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b px-5">
            <h2 id="new-lead-title" className="text-base font-semibold">
              New lead
            </h2>
            <button type="button" onClick={closeDrawer} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted" aria-label="Close">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          {drawerOpen && <NewLeadForm onCancel={closeDrawer} />}
        </aside>
      </div>
    </>
  )
}
