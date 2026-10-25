'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname()
  return (
    <nav className="ml-1 flex items-center gap-0.5 text-sm">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`)
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground',
              active && 'bg-muted font-medium text-foreground'
            )}
          >
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
