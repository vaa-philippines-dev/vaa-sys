import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { StatusChanger } from '@/components/customers/StatusChanger'
import { AccountsView } from '@/components/customers/AccountsView'
import { OnboardingLinkPanel } from '@/components/leads/OnboardingLinkPanel'
import { OnboardingStepper } from '@/components/lms/OnboardingStepper'
import { STAGE_META, initialsFrom } from '@/components/lms/stage-meta'
import { STATUS_META } from '@/components/cms/status-meta'
import { StatusRibbon } from '@/components/cms/StatusRibbon'
import { cn } from '@/lib/utils'
import { canUse, type AccessRole } from '@/lib/access-fields'
import { STATUS_LABELS, manilaDate, manilaDateTime } from '@/lib/customer-fields'
import { onboardingEmail, onboardingUrl } from '@/lib/onboarding'
import type { getCustomer } from '@/lib/customers'

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>

// One customer page for both areas. From Lead Management it leads with the
// onboarding link; from Customer Management with the status controls.
export function CustomerDetail({
  customer,
  role,
  senderName,
  from,
}: {
  customer: Customer
  role: AccessRole
  senderName: string
  from: 'customers' | 'leads'
}) {
  const now = new Date()
  const liveLink = customer.onboardingLinks.find((l) => !l.revokedAt && !l.submittedAt && l.expiresAt > now) ?? null
  const latestSubmission = customer.submissions[0] ?? null
  const mayManageLinks = canUse(role, 'leads') && customer.status === 'PENDING' && !latestSubmission
  const mayChangeStatus = canUse(role, 'customerStatus')

  const linkInfo = liveLink
    ? {
        url: onboardingUrl(liveLink.token),
        createdAt: liveLink.createdAt.toISOString(),
        expiresAt: liveLink.expiresAt.toISOString(),
        openedAt: liveLink.openedAt?.toISOString() ?? null,
        email: onboardingEmail({ customerName: customer.name, link: onboardingUrl(liveLink.token), senderName, expiresAt: liveLink.expiresAt }),
      }
    : null

  return (
    <div className="space-y-6">
      <Link href={from === 'leads' ? '/leads' : '/customers'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {from === 'leads' ? 'Leads' : 'Customers'}
      </Link>

      {from === 'leads' ? (
        <>
          {/* Lead Management: the LMS lead header and progress stepper. */}
          <section className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-card p-5">
            <div className="flex min-w-0 items-start gap-4">
              <span className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold', STAGE_META[customer.stage].soft)} aria-hidden>
                {initialsFrom(customer.name)}
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold">{customer.name}</h1>
                <p className="font-mono text-xs text-muted-foreground">{customer.customerCode}</p>
                {customer.email && <p className="mt-2 inline-flex rounded-full border px-3 py-1 text-xs">{customer.email}</p>}
                {customer.notes && <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-muted-foreground">{customer.notes}</p>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className={cn('inline-block rounded-full px-3 py-1.5 text-xs font-medium', STAGE_META[customer.stage].soft)}>{STAGE_META[customer.stage].label}</span>
              <p className="mt-2 text-xs text-muted-foreground">
                Added {customer.createdAt.toLocaleDateString('en-PH', manilaDate)} by {customer.createdByEmail}
              </p>
            </div>
          </section>
          <OnboardingStepper
            addedAt={customer.createdAt}
            linkSentAt={firstDate(customer.onboardingLinks.map((l) => l.createdAt))}
            openedAt={firstDate(customer.onboardingLinks.map((l) => l.openedAt))}
            submittedAt={latestSubmission?.submittedAt ?? null}
          />
        </>
      ) : (
        /* Customer Management: name and status up front, then the ribbon of
           every status the customer has been through. */
        <section className="space-y-5 rounded-2xl border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground">{customer.customerCode}</p>
              <h1 className="mt-1 font-display text-2xl font-semibold">{customer.name}</h1>
              {customer.email && <p className="text-sm text-muted-foreground">{customer.email}</p>}
              {customer.notes && <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-muted-foreground">{customer.notes}</p>}
            </div>
            <div className="flex flex-col items-end gap-1.5 text-right">
              <span className={cn('inline-flex h-7 items-center rounded-full px-3 text-sm font-medium', STATUS_META[customer.status].soft)}>{STATUS_META[customer.status].label}</span>
              <p className="text-xs text-muted-foreground">
                since {customer.statusChangedAt.toLocaleDateString('en-PH', manilaDate)}
                {customer.status === 'PENDING' && ` · ${STAGE_META[customer.stage].label.toLowerCase()}`}
              </p>
            </div>
          </div>
          <StatusRibbon logs={customer.statusLogs} now={now} />
          <p className="text-xs text-muted-foreground">
            Added {customer.createdAt.toLocaleDateString('en-PH', manilaDate)} by {customer.createdByEmail}
          </p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {mayManageLinks && (
            <section className="space-y-3">
              <h2 className="font-semibold">Onboarding link</h2>
              <OnboardingLinkPanel customerId={customer.id} customerEmail={customer.email} link={linkInfo} hadLinks={customer.onboardingLinks.length > 0} />
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-semibold">Accounts and tickets</h2>
            {customer.accounts.length > 0 ? (
              <AccountsView accounts={customer.accounts} canSetGroup={canUse(role, 'leads')} />
            ) : (
              <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                {customer.stage === 'NEW'
                  ? 'No onboarding link has been sent yet. The first account and its ticket are created when the customer submits the onboarding form.'
                  : 'Waiting for the customer to submit the onboarding form. Their first account and its ticket are created from it.'}
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          {mayChangeStatus && (
            <section className="space-y-3 rounded-xl border bg-card p-4">
              <h2 className="font-semibold">Status</h2>
              <StatusChanger customerId={customer.id} current={customer.status} />
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-semibold">Status log</h2>
            <ol className="space-y-3 border-l pl-4">
              {customer.statusLogs.map((log) => (
                <li key={log.id} className="relative text-sm">
                  <span className={cn('absolute -left-[21px] top-1.5 h-2 w-2 rounded-full', STATUS_META[log.toStatus].dot)} aria-hidden />
                  <p className="font-medium">
                    {log.fromStatus ? `${STATUS_LABELS[log.fromStatus]} → ${STATUS_LABELS[log.toStatus]}` : `Created as ${STATUS_LABELS[log.toStatus]}`}
                  </p>
                  {log.reason && <p className="whitespace-pre-wrap text-muted-foreground">{log.reason}</p>}
                  <p className="text-xs text-muted-foreground">
                    {log.changedAt.toLocaleString('en-PH', manilaDateTime)} · {log.changedByEmail}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

function firstDate(dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d !== null)
  return real.length ? new Date(Math.min(...real.map((d) => d.getTime()))) : null
}
