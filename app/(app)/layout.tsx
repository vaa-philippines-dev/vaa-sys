import Image from 'next/image'
import Link from 'next/link'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { SignOutButton } from '@/components/layout/SignOutButton'
import { NavLinks } from '@/components/layout/NavLinks'
import { requireSignedIn, displayName } from '@/lib/auth'
import { canUse, homeFor, ROLE_LABELS } from '@/lib/access-fields'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSignedIn()

  const links = [
    canUse(user.role, 'customers') && { href: '/customers', label: 'Customers' },
    canUse(user.role, 'leads') && { href: '/leads', label: 'Leads' },
    canUse(user.role, 'access') && { href: '/access', label: 'Access' },
  ].filter((l): l is { href: string; label: string } => !!l)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href={homeFor(user.role)} className="flex shrink-0 items-center gap-2.5">
            <Image src="/blackLogo.png" alt="VAA Philippines" width={120} height={46} className="h-7 w-auto dark:hidden" priority />
            <Image src="/whiteLogo.png" alt="VAA Philippines" width={120} height={46} className="hidden h-7 w-auto dark:block" priority />
            <span className="hidden border-l pl-2.5 text-sm font-semibold sm:inline">VAA Systems</span>
          </Link>

          <NavLinks links={links} />

          <div className="ml-auto flex items-center gap-1">
            <div className="mr-2 hidden text-right leading-tight md:block">
              <p className="text-xs font-medium">{displayName(user)}</p>
              <p className="text-[11px] text-muted-foreground">{ROLE_LABELS[user.role]}</p>
            </div>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
