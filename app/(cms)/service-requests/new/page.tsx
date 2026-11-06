import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertAccountInScope } from '@/lib/scope'
import { SR_TYPES, type SrType } from '@/lib/service-request-fields'
import { NewServiceRequestForm } from '@/components/requests/NewServiceRequestForm'

// Opening a service request on an account (/service-requests/new?account=…).
// Every account has a New one (the onboarding form's, or one opened here);
// after that it's Additional, Replacement or Reliever.
export default async function NewServiceRequestPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account: accountId } = await searchParams
  const user = await requireCan('serviceRequests', 'create', '/service-requests')
  if (!accountId || !(await assertAccountInScope(user, accountId))) notFound()
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, accountCode: true, customer: { select: { name: true } }, _count: { select: { tickets: { where: { type: 'NEW' } } } } },
  })
  if (!account) notFound()
  const types: SrType[] = account._count.tickets > 0 ? SR_TYPES.filter((t) => t !== 'NEW') : ['NEW']

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <Link href={`/accounts/${account.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {account.name}
      </Link>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Service Requests · {account.accountCode} · {account.customer.name}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold">New service request</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {types.includes('NEW')
            ? 'This account has no New service request yet, so this one is its New ticket.'
            : 'Additional VAs, a Replacement for a VA leaving, or a Reliever covering one. Each VA becomes its own VA request on the ticket.'}
        </p>
      </div>
      <NewServiceRequestForm accountId={account.id} types={types} />
    </main>
  )
}
