import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AccountInfoCards, ServiceRequestCards } from '@/components/customers/AccountsView'
import { LeadWorkflow } from '@/components/leads/LeadWorkflow'
import { LeadTabs } from '@/components/leads/LeadTabs'
import { OnboardingLinkPanel } from '@/components/leads/OnboardingLinkPanel'
import { DeleteTestLead } from '@/components/leads/DeleteTestLead'
import { TestBadge } from '@/components/leads/TestBadge'
import { COLUMN_META, STAGE_META, boardColumnOf, initialsFrom } from '@/components/lms/stage-meta'
import { STATUS_META } from '@/components/cms/status-meta'
import { STATUS_LABELS, manilaDate, manilaDateTime } from '@/lib/customer-fields'
import { PHASE_LABELS } from '@/lib/lead-phase-fields'
import { onboardingEmail, onboardingUrl } from '@/lib/onboarding'
import { cn } from '@/lib/utils'
import type { getCustomer } from '@/lib/customers'
import type { ContractChoice } from '@/lib/contracts'

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>

// A lead's page in Lead Management: the workflow first (Customer Intake's
// onboarding steps and link, then the contract steps), then the lead's
// information in three tabs: the customer, its account (Part 1 of the form)
// and its service requests (Parts 2 and 3). Customer Management has its own
// layout for the same customer (components/customers/CustomerDetail.tsx).
export function LeadDetail({
  customer,
  choices,
  senderName,
  canEdit,
  canDeleteTest,
  addedByName,
}: {
  customer: Customer
  choices: ContractChoice[]
  senderName: string
  canEdit: boolean
  canDeleteTest: boolean
  addedByName: string
}) {
  const now = new Date()
  const liveLink = customer.onboardingLinks.find((l) => !l.revokedAt && !l.submittedAt && l.expiresAt > now) ?? null
  const submission = customer.submissions[0] ?? null
  const mayManageLinks = canEdit && customer.status === 'PENDING' && !submission
  const badge =
    customer.leadPhase === 'NEW_CUSTOMER_ONBOARDED'
      ? { label: PHASE_LABELS.NEW_CUSTOMER_ONBOARDED, soft: STAGE_META.SUBMITTED.soft }
      : COLUMN_META[boardColumnOf(customer.stage, customer.leadPhase)]

  const linkInfo = liveLink
    ? {
        url: onboardingUrl(liveLink.token),
        createdAt: liveLink.createdAt.toISOString(),
        expiresAt: liveLink.expiresAt.toISOString(),
        openedAt: liveLink.openedAt?.toISOString() ?? null,
        email: onboardingEmail({ customerName: customer.name, link: onboardingUrl(liveLink.token), senderName, expiresAt: liveLink.expiresAt }),
      }
    : null

  const onboardingLink = mayManageLinks && (
    <section className="space-y-3">
      <h2 className="font-semibold">Onboarding link</h2>
      <OnboardingLinkPanel customerId={customer.id} customerEmail={customer.email} link={linkInfo} hadLinks={customer.onboardingLinks.length > 0} collapsible />
    </section>
  )

  const noAccount = (
    <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
      {customer.stage === 'NEW'
        ? 'No onboarding link has been sent yet. The first account and its ticket are created when the customer submits the onboarding form.'
        : 'Waiting for the customer to submit the onboarding form. Their first account and its ticket are created from it.'}
    </p>
  )
  const requestCount = customer.accounts.reduce((n, a) => n + a.tickets.reduce((m, t) => m + t.requests.length, 0), 0)

  const customerInfo = (
    <div className="space-y-6 rounded-xl border bg-card p-5">
      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {(
          [
            ['Customer ID', <span key="id" className="font-mono text-xs">{customer.customerCode}</span>],
            ['Name', customer.name],
            ['Email', customer.email ?? <span key="e" className="text-muted-foreground">No email yet</span>],
            ['Notes', customer.notes ? <span key="n" className="whitespace-pre-wrap">{customer.notes}</span> : null],
            ['Request type', customer.requestType === 'SPECIAL' ? 'Special Request' : 'Regular Request'],
            [
              'Status',
              <span key="s" className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_META[customer.status].soft)}>
                {STATUS_LABELS[customer.status]}
              </span>,
            ],
            ['Onboarding form', submission ? `Submitted ${submission.submittedAt.toLocaleString('en-PH', manilaDateTime)}` : 'Not submitted yet'],
            ['Added', `${customer.createdAt.toLocaleDateString('en-PH', manilaDate)} by ${addedByName}`],
          ] as [string, React.ReactNode][]
        )
          .filter(([, v]) => v !== null)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
      </dl>
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status log</h3>
        <ol className="space-y-3 border-l pl-4">
          {customer.statusLogs.map((log) => (
            <li key={log.id} className="relative text-sm">
              <span className={cn('absolute -left-[21px] top-1.5 h-2 w-2 rounded-full', STATUS_META[log.toStatus].dot)} aria-hidden />
              <p className="font-medium">{log.fromStatus ? `${STATUS_LABELS[log.fromStatus]} → ${STATUS_LABELS[log.toStatus]}` : `Created as ${STATUS_LABELS[log.toStatus]}`}</p>
              {log.reason && <p className="whitespace-pre-wrap text-muted-foreground">{log.reason}</p>}
              <p className="text-xs text-muted-foreground">
                {log.changedAt.toLocaleString('en-PH', manilaDateTime)} · {log.changedByEmail}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold', badge.soft)} aria-hidden>
            {initialsFrom(customer.name)}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">
              {customer.name}
              {customer.isTest && <TestBadge className="ml-2" />}
            </h1>
            <p className="font-mono text-xs text-muted-foreground">{customer.customerCode}</p>
          </div>
        </div>
        <span className={cn('rounded-full px-3 py-1.5 text-xs font-medium', badge.soft)}>
          {customer.leadPhase === 'CUSTOMER_INTAKE' ? `${PHASE_LABELS.CUSTOMER_INTAKE} · ${badge.label}` : badge.label}
        </span>
        {customer.isTest && (
          <div className="flex basis-full flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm text-muted-foreground">
            <p>Test lead: left out of reports and counts.</p>
            {canDeleteTest && <DeleteTestLead customerId={customer.id} name={customer.name} />}
          </div>
        )}
      </header>

      <LeadWorkflow customer={customer} choices={choices} senderName={senderName} canEdit={canEdit} intake={onboardingLink} />

      <LeadTabs
        tabs={[
          { key: 'customer', label: 'Customer information', content: customerInfo },
          { key: 'account', label: 'Account information', count: customer.accounts.length, content: customer.accounts.length ? <AccountInfoCards accounts={customer.accounts} /> : noAccount },
          {
            key: 'requests',
            label: 'Service requests',
            count: requestCount,
            content: customer.accounts.length ? <ServiceRequestCards accounts={customer.accounts} canSetGroup={canEdit} /> : noAccount,
          },
        ]}
      />
    </div>
  )
}
