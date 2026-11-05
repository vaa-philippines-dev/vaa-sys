import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Receipt, Users, UserPlus } from 'lucide-react'
import { requireSignedIn, displayName } from '@/lib/auth'
import { homeFor } from '@/lib/access-fields'
import { countCustomers, REAL_CUSTOMERS } from '@/lib/customers'
import { prisma } from '@/lib/prisma'

// Admins land here and pick an area; everyone else goes straight to theirs.
export default async function HomePage() {
  const user = await requireSignedIn()
  if (user.role !== 'ADMIN') redirect(homeFor(user.role))
  const [counts, openBills] = await Promise.all([
    countCustomers(),
    prisma.invoice.count({ where: { status: { in: ['SENT', 'PARTIALLY_PAID'] }, customer: REAL_CUSTOMERS } }),
  ])

  const areas = [
    {
      href: '/customers',
      icon: Users,
      title: 'Customer Management',
      who: 'Customer Specialists and their manager',
      stat: `${counts.total} ${counts.total === 1 ? 'customer' : 'customers'}`,
    },
    {
      href: '/leads',
      icon: UserPlus,
      title: 'Lead Management',
      who: 'New customers and onboarding links',
      stat: `${counts.pending} in onboarding`,
    },
    {
      href: '/accounting',
      icon: Receipt,
      title: 'Accounting System',
      who: 'Bills, payments and Foregone Revenue',
      stat: `${openBills} ${openBills === 1 ? 'bill' : 'bills'} awaiting payment`,
    },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome, {user.firstName || displayName(user)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose where to work. Customer Specialists, Lead Managers and Accounting go straight to their own area.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((a) => (
          <Link key={a.href} href={a.href} className="group flex flex-col gap-3 rounded-xl border bg-card p-5 hover:border-primary/40 hover:bg-accent">
            <a.icon className="h-5 w-5 text-primary" />
            <div>
              <p className="font-semibold">{a.title}</p>
              <p className="text-sm text-muted-foreground">{a.who}</p>
            </div>
            <div className="mt-auto flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{a.stat}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
