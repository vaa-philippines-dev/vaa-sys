import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireCan } from '@/lib/auth'
import { staffNames } from '@/lib/workforce'
import { STATUS_LABELS, manilaDateTime } from '@/lib/customer-fields'
import { STATUS_META } from '@/components/cms/status-meta'
import { ReviewButtons } from '@/components/cms/ReviewButtons'
import { cn } from '@/lib/utils'

// Pauses, terminations and cancellations made by someone other than a CS
// Manager. They already apply; the CS Manager confirms them, or cancels
// them to put the old status back.
export default async function ApprovalsPage() {
  await requireCan('approvals', 'update', '/approvals')

  const [customers, accounts] = await Promise.all([
    prisma.customer.findMany({
      where: { reviewAction: { not: null } },
      orderBy: { reviewRequestedAt: 'asc' },
      select: {
        id: true,
        name: true,
        customerCode: true,
        status: true,
        reviewAction: true,
        statusBeforeReview: true,
        reviewRequestedByEmail: true,
        reviewRequestedAt: true,
        reviewReason: true,
        accounts: { where: { reviewFromCustomer: true }, select: { id: true, name: true, accountCode: true, statusBeforeReview: true } },
      },
    }),
    prisma.account.findMany({
      where: { reviewAction: { not: null }, reviewFromCustomer: false },
      orderBy: { reviewRequestedAt: 'asc' },
      select: {
        id: true,
        name: true,
        accountCode: true,
        status: true,
        reviewAction: true,
        statusBeforeReview: true,
        reviewRequestedByEmail: true,
        reviewRequestedAt: true,
        reviewReason: true,
        customer: { select: { id: true, name: true } },
      },
    }),
  ])
  const names = await staffNames([...customers, ...accounts].map((r) => r.reviewRequestedByEmail ?? ''))

  return (
    <main className="w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Status changes waiting for your review. They already apply. Confirm keeps the change; Cancel puts the previous status back, including on the accounts it changed.
        </p>
      </div>

      {customers.length + accounts.length === 0 && <p className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">Nothing is waiting for review.</p>}

      {customers.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Customers</h2>
          <ul className="space-y-3">
            {customers.map((c) => (
              <ReviewCard
                key={c.id}
                kind="customer"
                id={c.id}
                title={c.name}
                href={`/customers/${c.id}`}
                code={c.customerCode}
                from={c.statusBeforeReview!}
                to={c.reviewAction!}
                by={names.get(c.reviewRequestedByEmail ?? '') ?? c.reviewRequestedByEmail ?? ''}
                at={c.reviewRequestedAt}
                reason={c.reviewReason}
                extra={c.accounts.length > 0 ? `Also changed ${c.accounts.length} ${c.accounts.length === 1 ? 'account' : 'accounts'}: ${c.accounts.map((a) => a.name).join(', ')}` : null}
              />
            ))}
          </ul>
        </section>
      )}

      {accounts.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Accounts</h2>
          <ul className="space-y-3">
            {accounts.map((a) => (
              <ReviewCard
                key={a.id}
                kind="account"
                id={a.id}
                title={`${a.name} · ${a.customer.name}`}
                href={`/accounts/${a.id}`}
                code={a.accountCode}
                from={a.statusBeforeReview!}
                to={a.reviewAction!}
                by={names.get(a.reviewRequestedByEmail ?? '') ?? a.reviewRequestedByEmail ?? ''}
                at={a.reviewRequestedAt}
                reason={a.reviewReason}
                extra={null}
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function ReviewCard(props: {
  kind: 'customer' | 'account'
  id: string
  title: string
  href: string
  code: string
  from: keyof typeof STATUS_LABELS
  to: keyof typeof STATUS_LABELS
  by: string
  at: Date | null
  reason: string | null
  extra: string | null
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-card p-4">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[11px] text-muted-foreground">{props.code}</p>
        <Link href={props.href} className="font-medium hover:underline">
          {props.title}
        </Link>
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_META[props.from].soft)}>{STATUS_LABELS[props.from]}</span>→
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_META[props.to].soft)}>{STATUS_LABELS[props.to]}</span>
        </p>
        {props.reason && <p className="whitespace-pre-wrap text-sm text-muted-foreground">“{props.reason}”</p>}
        {props.extra && <p className="text-xs text-muted-foreground">{props.extra}</p>}
        <p className="text-xs text-muted-foreground">
          By {props.by}
          {props.at && ` · ${props.at.toLocaleString('en-PH', manilaDateTime)}`}
        </p>
      </div>
      <ReviewButtons kind={props.kind} id={props.id} />
    </li>
  )
}
