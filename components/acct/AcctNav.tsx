'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Banknote, FileText, HandCoins, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AcctNavItem = { href: string; label: string; icon: 'invoices' | 'payments' | 'foregone' | 'settings'; count?: number }

const ICONS = { invoices: FileText, payments: Banknote, foregone: HandCoins, settings: Settings }

// The Accounting System's sidebar. Bills owns its own pages (a bill's page
// counts as Bills).
export function AcctNav({ items }: { items: AcctNavItem[] }) {
  const pathname = usePathname()
  const active = (href: string) => (href === '/accounting' ? pathname === '/accounting' || pathname.startsWith('/accounting/invoices') : pathname.startsWith(href))
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((i) => {
        const Icon = ICONS[i.icon]
        const on = active(i.href)
        return (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium',
              on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
            {i.label}
            {i.count !== undefined && i.count > 0 && (
              <span className={cn('ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums', on ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {i.count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
