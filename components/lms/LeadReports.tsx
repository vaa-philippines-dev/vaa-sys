import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SortableTable } from '@/components/ui/sortable-table'
import { RANGE_PRESETS, type DemandRow, type FunnelStep, type PeriodRow, type RangePreset, type ReportRange } from '@/lib/lead-reports'
import { cn } from '@/lib/utils'

// The pieces of /leads/reports. Server components: every figure is shown as
// text next to its mark (hover a bar for its exact value), and each chart has
// a table beside or under it, so nothing is read from colour or height alone.
// One series per chart, in the .lms palette's ink (bg-primary).

export function ReportSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-2xl border bg-card px-5 py-5 sm:px-6">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function RangeFilter({ range }: { range: ReportRange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(RANGE_PRESETS) as RangePreset[]).map((p) => (
        <Link
          key={p}
          href={`/leads/reports?range=${p}`}
          className={cn(
            'rounded-lg px-3 py-1.5 text-[13px] font-medium',
            range.preset === p ? 'bg-primary text-primary-foreground' : 'border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {RANGE_PRESETS[p]}
        </Link>
      ))}
      <form action="/leads/reports" className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <label className="sr-only" htmlFor="from">
          From
        </label>
        <input id="from" name="from" type="date" defaultValue={range.from} required className="h-8 rounded-lg border bg-card px-2 text-[13px]" />
        <span className="text-[13px] text-muted-foreground">to</span>
        <label className="sr-only" htmlFor="to">
          To
        </label>
        <input id="to" name="to" type="date" defaultValue={range.to} required className="h-8 rounded-lg border bg-card px-2 text-[13px]" />
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>
    </div>
  )
}

export function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[22px] font-semibold tabular-nums tracking-tight">{value}</span>
      <span className="text-[12px] leading-tight text-muted-foreground">{label}</span>
    </div>
  )
}

export function formatDays(days: number | null) {
  if (days === null) return '—'
  if (days < 1) return 'under a day'
  const rounded = Math.round(days * 10) / 10
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`
}

// One row per step; the bar is the step's count against the leads added.
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, steps[0]?.count ?? 0)
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[10rem_minmax(0,1fr)_7rem]">
          <span className="text-[13.5px] font-medium">{s.label}</span>
          <div className="order-last col-span-2 h-6 rounded-[4px] bg-muted sm:order-none sm:col-span-1" aria-hidden>
            <div
              className="h-full rounded-[4px] bg-primary"
              style={{ width: `${(s.count / max) * 100}%`, minWidth: s.count > 0 ? 4 : 0 }}
              title={`${s.label}: ${s.count}`}
            />
          </div>
          <span className="text-right text-[13.5px] tabular-nums">
            <span className="font-semibold">{s.count}</span>
            {s.pctOfAdded !== null && <span className="text-muted-foreground"> · {s.pctOfAdded}%</span>}
          </span>
          {i > 0 && (
            <span className="order-last col-span-2 text-[12px] text-muted-foreground sm:order-none sm:col-span-1 sm:col-start-2">
              {s.pctOfPrevious === null ? 'No leads reached the step before.' : `${s.pctOfPrevious}% of “${steps[i - 1].label}” · median ${formatDays(s.medianDays)} after it`}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

// Vertical bars, one per week or month, with a light 0 / half / max scale.
export function PeriodChart({ periods, unit }: { periods: PeriodRow[]; unit: ReportRange['unit'] }) {
  const max = Math.max(4, ...periods.map((p) => p.newLeads))
  const every = Math.ceil(periods.length / 12)
  const prefix = unit === 'week' ? 'Week of ' : ''
  return (
    <div className="flex items-end gap-3" role="img" aria-label={`New leads per ${unit}: ${periods.map((p) => `${prefix}${p.label} ${p.newLeads}`).join(', ')}`}>
      <div className="flex h-[148px] flex-col justify-between pb-5 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden>
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="flex h-[148px] min-w-0 flex-1 items-end gap-[3px] border-b border-border/0" aria-hidden>
        {periods.map((p, i) => (
          <div key={p.key} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${prefix}${p.label}: ${p.newLeads} new ${p.newLeads === 1 ? 'lead' : 'leads'}`}>
            <div className="flex h-[124px] w-full max-w-8 items-end">
              <div
                className="w-full rounded-t-[4px] bg-primary group-hover:opacity-80"
                style={{ height: `${(p.newLeads / max) * 100}%`, minHeight: p.newLeads > 0 ? 4 : 0 }}
              />
            </div>
            <span className={cn('h-3.5 whitespace-nowrap text-[11px] text-muted-foreground', i % every !== 0 && 'invisible')}>{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PeriodTable({ periods, unit }: { periods: PeriodRow[]; unit: ReportRange['unit'] }) {
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">Show the numbers per {unit}</summary>
      <div className="mt-3 overflow-x-auto">
        <SortableTable
          className="w-full min-w-[480px] text-left text-[13px]"
          theadClassName="text-[12px] text-muted-foreground"
          headRowClassName="border-b"
          tbodyClassName="tabular-nums"
          columns={[
            { key: 'period', label: unit === 'week' ? 'Week of' : 'Month', className: 'py-2 pr-4 font-medium' },
            { key: 'newLeads', label: 'New leads', align: 'right', firstDir: 'desc', className: 'py-2 pr-4 font-medium' },
            { key: 'linksSent', label: 'Links sent', align: 'right', firstDir: 'desc', className: 'py-2 pr-4 font-medium' },
            { key: 'formsSubmitted', label: 'Forms submitted', align: 'right', firstDir: 'desc', className: 'py-2 pr-4 font-medium' },
            { key: 'linksExpired', label: 'Links expired unused', align: 'right', firstDir: 'desc', className: 'py-2 font-medium' },
          ]}
          rows={periods.map((p, i) => ({
            id: p.key,
            values: { period: i, newLeads: p.newLeads, linksSent: p.linksSent, formsSubmitted: p.formsSubmitted, linksExpired: p.linksExpired },
            node: (
              <tr key={p.key} className="border-b last:border-0">
                <td className="py-2 pr-4">{p.label}</td>
                <td className="py-2 pr-4 text-right">{p.newLeads}</td>
                <td className="py-2 pr-4 text-right">{p.linksSent}</td>
                <td className="py-2 pr-4 text-right">{p.formsSubmitted}</td>
                <td className="py-2 text-right">{p.linksExpired}</td>
              </tr>
            ),
          }))}
        />
      </div>
    </details>
  )
}

// Horizontal bars for a breakdown, longest first unless the list has a
// fixed order. Values are VAs requested.
export function BarList({ title, rows }: { title: string; rows: DemandRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.vas))
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">None in this range.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-col gap-1" title={`${r.label}: ${r.vas} ${r.vas === 1 ? 'VA' : 'VAs'}`}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{r.label}</span>
                <span className="shrink-0 font-semibold tabular-nums">{r.vas}</span>
              </div>
              <div className="h-1.5 rounded-[4px] bg-muted" aria-hidden>
                <div className="h-full rounded-[4px] bg-primary" style={{ width: `${(r.vas / max) * 100}%`, minWidth: r.vas > 0 ? 4 : 0 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
