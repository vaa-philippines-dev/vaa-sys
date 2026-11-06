'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// Every table in vaa-sys sorts by any column (asked for on Nov 5, 2026).
// The page renders each row as it always did (server or client), and says
// what each column sorts by; this only puts the rows in order. Clicking a
// header sorts by it, clicking again flips it, and a third click goes back
// to the table's own order (newest first, the department tree, and so on).
//
// Blank values always go last, whichever way the column is sorted.

export type SortValue = string | number | boolean | Date | null | undefined
export type SortDir = 'asc' | 'desc'

export type SortColumn = {
  key: string
  label: ReactNode
  className?: string
  align?: 'left' | 'right'
  // false for a column with nothing to sort by (buttons, an edit link).
  sortable?: boolean
  // The first click's direction: 'desc' suits dates and amounts.
  firstDir?: SortDir
}

export type SortRow = {
  id: string
  // One value per sortable column key.
  values: Record<string, SortValue>
  // The row itself: a complete <tr>.
  node: ReactNode
  // Anything that must stay under this row, such as an open edit form.
  after?: ReactNode
}

const blank = (v: SortValue) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))
const text = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function compare(a: SortValue, b: SortValue): number {
  if (a instanceof Date) a = a.getTime()
  if (b instanceof Date) b = b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1
  return text.compare(String(a), String(b))
}

export function sortRows<T extends { values: Record<string, SortValue> }>(rows: T[], sort: { key: string; dir: SortDir } | null): T[] {
  if (!sort) return rows
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const a = x.r.values[sort.key]
      const b = y.r.values[sort.key]
      if (blank(a) || blank(b)) return blank(a) === blank(b) ? x.i - y.i : blank(a) ? 1 : -1
      return compare(a, b) * sign || x.i - y.i
    })
    .map(({ r }) => r)
}

export function SortableTable({
  columns,
  rows,
  initialSort = null,
  className,
  theadClassName,
  headRowClassName,
  tbodyClassName,
  empty,
}: {
  columns: SortColumn[]
  rows: SortRow[]
  initialSort?: { key: string; dir: SortDir } | null
  className?: string
  theadClassName?: string
  headRowClassName?: string
  tbodyClassName?: string
  // A complete <tr> shown when there are no rows.
  empty?: ReactNode
}) {
  const [sort, setSort] = useState(initialSort)
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])

  const click = (c: SortColumn) => {
    const first = c.firstDir ?? 'asc'
    setSort((s) => {
      if (!s || s.key !== c.key) return { key: c.key, dir: first }
      if (s.dir === first) return { key: c.key, dir: first === 'asc' ? 'desc' : 'asc' }
      return null
    })
  }

  return (
    <table className={className}>
      <thead className={theadClassName}>
        <tr className={headRowClassName}>
          {columns.map((c) => {
            const active = sort?.key === c.key
            const right = c.align === 'right'
            if (c.sortable === false)
              return (
                <th key={c.key} className={cn(c.className, right && 'text-right')}>
                  {c.label}
                </th>
              )
            const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
            return (
              <th key={c.key} className={cn(c.className, right && 'text-right')} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button
                  type="button"
                  onClick={() => click(c)}
                  className={cn('inline-flex items-center gap-1 rounded hover:text-foreground', active && 'text-foreground', right && 'flex-row-reverse')}
                >
                  {c.label}
                  <Icon className={cn('h-3 w-3 shrink-0', !active && 'opacity-40')} aria-hidden />
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody className={tbodyClassName}>
        {sorted.map((r) => (
          <Fragment key={r.id}>
            {r.node}
            {r.after}
          </Fragment>
        ))}
        {rows.length === 0 && empty}
      </tbody>
    </table>
  )
}
