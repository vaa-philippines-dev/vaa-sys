import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { requireCan } from '@/lib/auth'
import { activityScopeWhere } from '@/lib/scope'
import { ACTION_LABELS, ACTIVITY_ACTIONS, ENTITY_TYPES } from '@/lib/activity-fields'
import { manilaStartOf, manilaToday } from '@/lib/customer-fields'
import { ActivityTable } from '@/components/cms/ActivityTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'

const PAGE_SIZE = 100
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')

type Params = { from?: string; to?: string; entity?: string; action?: string; user?: string; q?: string; page?: string }

// The generic activity log, newest first. Browsing defaults to the last 7
// days (legacy getLogs); every filter goes in the URL so a view can be
// shared.
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireCan('activityLogs', 'read', '/activity')
  const sp = await searchParams
  const now = new Date()
  const today = manilaToday(now)
  const weekAgo = manilaToday(new Date(now.getTime() - 6 * 86_400_000))
  const from = day(sp.from) || weekAgo
  const to = day(sp.to) || today
  const page = Math.max(1, Number(sp.page) || 1)

  const scope = await activityScopeWhere(user)
  const where: Prisma.ActivityLogWhereInput = {
    AND: [
      scope ?? {},
      { createdAt: { gte: manilaStartOf(from), lt: new Date(manilaStartOf(to).getTime() + 86_400_000) } },
      sp.entity ? { entityType: sp.entity } : {},
      sp.action ? { action: sp.action } : {},
      sp.user ? { actorEmail: { contains: sp.user.trim().toLowerCase() } } : {},
      sp.q
        ? {
            OR: [
              { entityLabel: { contains: sp.q, mode: 'insensitive' } },
              { entityId: sp.q },
              { field: { contains: sp.q, mode: 'insensitive' } },
              { oldValue: { contains: sp.q, mode: 'insensitive' } },
              { newValue: { contains: sp.q, mode: 'insensitive' } },
              { notes: { contains: sp.q, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  }
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    prisma.activityLog.count({ where }),
  ])
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const query = (p: number) => {
    const qs = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])
    return `/activity?${qs.toString()}`
  }

  return (
    <main className="w-full space-y-5 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Activity log</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every change, who made it and when. Dates are Philippine time.</p>
      </div>

      <form action="/activity" className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-3 lg:grid-cols-7 lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" name="from" type="date" defaultValue={from} max={today} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" name="to" type="date" defaultValue={to} max={today} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-entity">Record</Label>
          <NativeSelect id="f-entity" name="entity" defaultValue={sp.entity ?? ''}>
            <option value="">All</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-action">Action</Label>
          <NativeSelect id="f-action" name="action" defaultValue={sp.action ?? ''}>
            <option value="">All</option>
            {ACTIVITY_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-user">By (email)</Label>
          <Input id="f-user" name="user" defaultValue={sp.user ?? ''} placeholder="name@" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-q">Search</Label>
          <Input id="f-q" name="q" defaultValue={sp.q ?? ''} placeholder="Name, value, note" />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <Link href="/activity" className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted">
            Reset
          </Link>
        </div>
      </form>

      <p className="text-sm text-muted-foreground">
        {total} {total === 1 ? 'entry' : 'entries'}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </p>
      <ActivityTable rows={rows} />

      {pages > 1 && (
        <div className="flex justify-between text-sm">
          {page > 1 ? <Link href={query(page - 1)} className="text-primary hover:underline">← Newer</Link> : <span />}
          {page < pages ? <Link href={query(page + 1)} className="text-primary hover:underline">Older →</Link> : <span />}
        </div>
      )}
    </main>
  )
}
