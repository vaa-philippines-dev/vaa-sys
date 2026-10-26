import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Hourglass, RotateCcw } from 'lucide-react'
import { StatusChanger } from '@/components/customers/StatusChanger'
import { AccountsView } from '@/components/customers/AccountsView'
import { CustomerEditForm, NotesPanel, SpecialistSelect } from '@/components/customers/CustomerPanels'
import { ReviewButtons } from '@/components/cms/ReviewButtons'
import { ActivityTable } from '@/components/cms/ActivityTable'
import { OnboardingLinkPanel } from '@/components/leads/OnboardingLinkPanel'
import { OnboardingStepper } from '@/components/lms/OnboardingStepper'
import { STAGE_META, initialsFrom } from '@/components/lms/stage-meta'
import { STATUS_META } from '@/components/cms/status-meta'
import { StatusRibbon } from '@/components/cms/StatusRibbon'
import { cn } from '@/lib/utils'
import { canUse, type AccessRole } from '@/lib/access-fields'
import { STATUS_LABELS, WARNING_LABELS, dayString, isTerminal, manilaDate, manilaDateTime, type CustomerWarning } from '@/lib/customer-fields'
import { onboardingEmail, onboardingUrl } from '@/lib/onboarding'
import type { getCustomer } from '@/lib/customers'
import type { SettingOptionLite } from '@/lib/settings-fields'
import type { ActivityLog } from '@/src/generated/prisma/client'

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>

// What Customer Management adds to the page, worked out on the server.
export type CustomerCmsData = {
  canEdit: boolean
  canAssign: boolean
  canReview: boolean
  reviewed: boolean
  team: { email: string; name: string }[]
  specialistName: string | null
  reviewByName: string | null
  terminationReasons: SettingOptionLite[]
  warnings: CustomerWarning[]
  activity: ActivityLog[]
  takeovers: { id: string; specialistName: string; startDate: Date; endDate: Date; state: string }[]
}

// One customer page for both areas. From Lead Management it leads with the
// onboarding link; from Customer Management with the status controls.
export function CustomerDetail({
  customer,
  role,
  senderName,
  from,
  cms,
}: {
  customer: Customer
  role: AccessRole
  senderName: string
  from: 'customers' | 'leads'
  cms?: CustomerCmsData
}) {
  const now = new Date()
  const liveLink = customer.onboardingLinks.find((l) => !l.revokedAt && !l.submittedAt && l.expiresAt > now) ?? null
  const latestSubmission = customer.submissions[0] ?? null
  const mayManageLinks = canUse(role, 'leads') && customer.status === 'PENDING' && !latestSubmission
  const mayChangeStatus = canUse(role, 'customerStatus') && !!cms
  const day = (d: Date) => new Date(`${dayString(d)}T00:00:00+08:00`).toLocaleDateString('en-PH', manilaDate)

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
          {customer.reviewAction && customer.statusBeforeReview && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
              <p className="flex items-start gap-2">
                <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  Changed from {STATUS_LABELS[customer.statusBeforeReview]} to {STATUS_LABELS[customer.reviewAction]} by {cms?.reviewByName ?? customer.reviewRequestedByEmail}
                  {customer.reviewRequestedAt && ` on ${customer.reviewRequestedAt.toLocaleDateString('en-PH', manilaDate)}`}. Waiting for a CS Manager’s review.
                </span>
              </p>
              {cms?.canReview && <ReviewButtons kind="customer" id={customer.id} />}
            </div>
          )}
          <StatusRibbon logs={customer.statusLogs} now={now} />
          {cms && (
            <dl className="grid gap-x-6 gap-y-3 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">CS Specialist</dt>
                <dd className="mt-0.5">
                  {cms.canAssign ? <SpecialistSelect customerId={customer.id} current={customer.assignedSpecialistEmail} team={cms.team} /> : (cms.specialistName ?? 'Unassigned')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">First payment</dt>
                <dd className="mt-0.5">{customer.noPaymentYet || !customer.paymentDate ? 'No payment yet' : day(customer.paymentDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Terminations</dt>
                <dd className="mt-0.5 font-display tabular-nums">{customer.terminationCount}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <RotateCcw className="h-3 w-3" /> Reactivations
                </dt>
                <dd className="mt-0.5 font-display tabular-nums">{customer.reactivationCount}</dd>
              </div>
            </dl>
          )}
          {cms && cms.warnings.length > 0 && (
            <ul className="space-y-1">
              {cms.warnings.map((w) => (
                <li key={w} className="flex items-center gap-2 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4" /> {WARNING_LABELS[w]}
                </li>
              ))}
            </ul>
          )}
          {cms && cms.takeovers.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {cms.takeovers.map((t) => `${t.state === 'ACTIVE' ? 'Covered' : 'To be covered'} by ${t.specialistName}, ${day(t.startDate)} – ${day(t.endDate)}`).join(' · ')}
            </p>
          )}
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

          {cms && customer.accounts.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold">Accounts</h2>
              <ul className="divide-y rounded-xl border bg-card">
                {customer.accounts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_META[a.status].dot)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">
                        {a.name}
                      </Link>
                      <p className="font-mono text-[11px] text-muted-foreground">{a.accountCode}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{[a.category?.label, a.type?.label, a.countryRegion?.label].filter(Boolean).join(' · ')}</span>
                    {a.isReturning && <span className="rounded-full bg-info/12 px-2 py-0.5 text-[11px] font-medium text-info">Returning</span>}
                    {a.reviewAction && <Hourglass className="h-3.5 w-3.5 text-warning" aria-label="Waiting for review" />}
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_META[a.status].soft)}>{STATUS_LABELS[a.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-semibold">{cms ? 'Onboarding details and tickets' : 'Accounts and tickets'}</h2>
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

          {cms && (
            <section className="space-y-3">
              <h2 className="font-semibold">Customer notes</h2>
              <NotesPanel customerId={customer.id} accountId={null} notes={customer.notesLog} canAdd={cms.canEdit} />
            </section>
          )}

          {cms && (
            <section className="space-y-3">
              <h2 className="font-semibold">History</h2>
              <ActivityTable rows={cms.activity} />
            </section>
          )}
        </div>

        <aside className="space-y-6">
          {mayChangeStatus && cms && (
            <section className="space-y-3 rounded-xl border bg-card p-4">
              <h2 className="font-semibold">Status</h2>
              {customer.reviewAction ? (
                <p className="text-sm text-muted-foreground">Status changes are on hold until the pending review is confirmed or cancelled.</p>
              ) : (
                <StatusChanger
                  kind="customer"
                  id={customer.id}
                  current={customer.status}
                  terminationReasons={cms.terminationReasons}
                  reviewed={cms.reviewed}
                  reactivatable={customer.accounts.filter((a) => isTerminal(a.status)).map((a) => ({ id: a.id, name: a.name, status: a.status }))}
                />
              )}
            </section>
          )}

          {cms?.canEdit && (
            <section className="space-y-3 rounded-xl border bg-card p-4">
              <h2 className="font-semibold">Details</h2>
              <CustomerEditForm
                customerId={customer.id}
                initial={{
                  name: customer.name,
                  email: customer.email,
                  notes: customer.notes,
                  noPaymentYet: customer.noPaymentYet,
                  paymentDate: customer.paymentDate ? dayString(customer.paymentDate) : null,
                }}
              />
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
                  {log.terminationReason && <p className="text-muted-foreground">{log.terminationReason.label}</p>}
                  {log.reason && <p className="whitespace-pre-wrap text-muted-foreground">{log.reason}</p>}
                  {log.effectiveDate && <p className="text-xs text-muted-foreground">Effective {log.effectiveDate.toLocaleDateString('en-PH', manilaDate)}</p>}
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
