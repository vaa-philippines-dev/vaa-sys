'use client'

import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type LeadTab = { key: string; label: string; count?: number; content: React.ReactNode }

// The lead page's information tabs. Every panel is rendered on the server
// and only shown or hidden here, so switching tabs doesn't fetch anything.
export function LeadTabs({ tabs }: { tabs: LeadTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key)
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // Arrow keys move between tabs, as screen-reader users expect of a tablist.
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (next === null) return
    e.preventDefault()
    const n = (next + tabs.length) % tabs.length
    setActive(tabs[n].key)
    buttons.current[n]?.focus()
  }

  return (
    <section className="space-y-4">
      <div role="tablist" aria-label="Lead information" className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((t, i) => {
          const selected = t.key === active
          return (
            <button
              key={t.key}
              ref={(el) => {
                buttons.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium',
                selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none tabular-nums text-muted-foreground">{t.count}</span>}
            </button>
          )
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`${id}-panel-${t.key}`} aria-labelledby={`${id}-tab-${t.key}`} hidden={t.key !== active}>
          {t.content}
        </div>
      ))}
    </section>
  )
}
