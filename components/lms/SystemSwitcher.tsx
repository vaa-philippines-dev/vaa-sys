'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ExternalLink } from 'lucide-react'
import type { SystemLink } from '@/components/lms/systems'

// From the original lead-management-sys: a dropdown to jump between VAA
// systems. In-app areas open here; the other systems open in a new tab.

export function SystemSwitcher({ current, others }: { current: string; others: SystemLink[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[13px] font-medium hover:bg-muted"
      >
        <span className="truncate">{current}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-xl border bg-card py-1 shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 text-sm font-medium">
            {current}
            <Check className="h-3.5 w-3.5" />
          </div>
          {others.map((s) =>
            s.external ? (
              <a
                key={s.href}
                role="menuitem"
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {s.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <Link key={s.href} role="menuitem" href={s.href} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                {s.label}
              </Link>
            )
          )}
        </div>
      )}
    </div>
  )
}
