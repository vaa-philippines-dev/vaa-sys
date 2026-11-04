'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, Plus, Search, Upload, X } from 'lucide-react'
import { NewLeadForm } from '@/components/leads/NewLeadForm'
import { COLUMN_META, type BoardColumn } from '@/components/lms/stage-meta'
import { PHASE_LABELS } from '@/lib/lead-phase-fields'
import { cn } from '@/lib/utils'

export type TableLead = {
  id: string
  name: string
  code: string
  email: string | null
  column: BoardColumn
  special: boolean
  day: number
  addedOn: string
  addedBy: string
}

// The Leads list as a table: one row per lead, newest first, with its phase
// (Customer Intake's step, or the phase after the form), request type and
// age. `stage` in the URL (the sidebar's views) filters it to one column of
// the old board. Admins also get the import template and upload.
export function LeadsTable({ leads, column: stage, openNew, canImport }: { leads: TableLead[]; column: BoardColumn | null; openNew: boolean; canImport: boolean }) {
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

  const submitted = leads.filter((l) => COLUMN_META[l.column].phase !== 'CUSTOMER_INTAKE').length

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Image src="/vaaleadms.png" alt="" width={40} height={40} className="h-5 w-5 object-contain" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              {stage ? COLUMN_META[stage].label : 'Leads'}
              {stage && (
                <Link href="/leads" className="rounded-full p-1 text-muted-foreground hover:bg-muted" title="Show all leads" aria-label="Show all leads">
                  <X className="h-3.5 w-3.5" />
                </Link>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {leads.length} {leads.length === 1 ? 'lead' : 'leads'} in onboarding · {submitted} past Customer Intake
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
          {canImport && (
            <>
              <a
                href="/leads/import/template"
                download
                className="flex h-9 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-medium hover:bg-muted"
                title="Excel template for adding or updating leads"
              >
                <Download className="h-4 w-4" /> Template
              </a>
              <Link href="/leads/import" className="flex h-9 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-medium hover:bg-muted">
                <Upload className="h-4 w-4" /> Import
              </Link>
            </>
          )}
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
          {stage ? 'No leads here right now.' : 'No leads yet. Add the first one with “New lead” above, then send them their onboarding link.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-[12px] text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-medium">Lead</th>
                <th className="px-4 py-2.5 font-medium">Customer ID</th>
                <th className="px-4 py-2.5 font-medium">Phase</th>
                <th className="px-4 py-2.5 font-medium">Request</th>
                <th className="px-4 py-2.5 text-right font-medium">Day</th>
                <th className="px-4 py-2.5 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const meta = COLUMN_META[l.column]
                const intake = meta.phase === 'CUSTOMER_INTAKE'
                return (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-2.5">
                      <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                      <p className="truncate text-[12px] text-muted-foreground">{l.email || 'No email yet'}</p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">{l.code}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium', meta.soft)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden />
                        {intake ? `${PHASE_LABELS.CUSTOMER_INTAKE} · ${meta.label}` : meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {l.special ? <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[12px] font-medium text-warning">Special</span> : <span className="text-muted-foreground">Regular</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{l.day}</td>
                    <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                      {l.addedOn}
                      <span className="block truncate" title={l.addedBy}>
                        {l.addedBy}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No leads match “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
