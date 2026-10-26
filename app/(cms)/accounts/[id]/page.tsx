import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, Hourglass } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { requireCan } from '@/lib/auth'
import { accountNotes, getAccount } from '@/lib/accounts'
import { can, needsStatusReview } from '@/lib/permissions'
import { assertAccountInScope } from '@/lib/scope'
import { settingOptions } from '@/lib/settings'
import { staffNames } from '@/lib/workforce'
import { STATUS_LABELS, manilaDate, manilaDateTime } from '@/lib/customer-fields'
import { formatSectionValue } from '@/lib/contract-fields'
import { STATUS_META } from '@/components/cms/status-meta'
import { StatusRibbon } from '@/components/cms/StatusRibbon'
import { ActivityTable } from '@/components/cms/ActivityTable'
import { ReviewButtons } from '@/components/cms/ReviewButtons'
import { StatusChanger } from '@/components/customers/StatusChanger'
import { AccountsView } from '@/components/customers/AccountsView'
import { NotesPanel } from '@/components/customers/CustomerPanels'
import { AccountEditForm, AccountManagers } from '@/components/customers/AccountPanels'
import { cn } from '@/lib/utils'

// One account's profile (legacy account view): status and its history,
// Customer Management fields, account managers, contract, notes (its own
// and its customer's), onboarding details and tickets, and the activity.
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireCan('accounts', 'read', `/accounts/${id}`)
  if (!(await assertAccountInScope(user, id))) notFound()
  const account = await getAccount(id)
  if (!account) notFound()

  const canEdit = can(user.role, 'accounts', 'update')
  const [notes, activity, categories, types, regions, terminationReasons, contracts, names] = await Promise.all([
    accountNotes(id, account.customerId),
    prisma.activityLog.findMany({ where: { entityType: 'Account', entityId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    settingOptions('Category', account.categoryId),
    settingOptions('Type', account.typeId),
    settingOptions('CountryRegion', account.countryRegionId),
    settingOptions('TerminationReason'),
    prisma.contract.findMany({ where: { OR: [{ isActive: true }, { id: account.contractId ?? '' }] }, orderBy: { contractCode: 'asc' }, select: { id: true, contractCode: true, name: true, isActive: true } }),
    staffNames([account.customer.assignedSpecialistEmail ?? '', account.reviewRequestedByEmail ?? '']),
  ])
  const now = new Date()
  const localTime = account.countryRegion?.timezone
    ? now.toLocaleTimeString('en-US', { timeZone: account.countryRegion.timezone, hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <Link href={`/customers/${account.customer.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {account.customer.name}
      </Link>

      <section className="space-y-5 rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{account.accountCode}</p>
            <h1 className="mt-1 font-display text-2xl font-semibold">{account.name}</h1>
            <p className="text-sm text-muted-foreground">
              {account.companyName}
              {account.dbaName && ` (DBA ${account.dbaName})`} · customer{' '}
              <Link href={`/customers/${account.customer.id}`} className="hover:underline">
                {account.customer.name}
              </Link>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 text-right">
            <span className="flex items-center gap-1.5">
              {account.isReturning && <span className="rounded-full bg-info/12 px-2.5 py-1 text-xs font-medium text-info">Returning</span>}
              <span className={cn('inline-flex h-7 items-center rounded-full px-3 text-sm font-medium', STATUS_META[account.status].soft)}>{STATUS_LABELS[account.status]}</span>
            </span>
            <p className="text-xs text-muted-foreground">since {account.statusChangedAt.toLocaleDateString('en-PH', manilaDate)}</p>
          </div>
        </div>

        {account.reviewAction && account.statusBeforeReview && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
            <p className="flex items-start gap-2">
              <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                Changed from {STATUS_LABELS[account.statusBeforeReview]} to {STATUS_LABELS[account.reviewAction]} by{' '}
                {names.get(account.reviewRequestedByEmail ?? '') ?? account.reviewRequestedByEmail}
                {account.reviewFromCustomer ? ', with its customer' : ''}. Waiting for a CS Manager’s review.
              </span>
            </p>
            {can(user.role, 'approvals', 'update') && !account.reviewFromCustomer && <ReviewButtons kind="account" id={account.id} />}
          </div>
        )}

        <StatusRibbon logs={account.statusLogs} now={now} />

        <dl className="grid gap-x-6 gap-y-3 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Category · Type</dt>
            <dd className="mt-0.5">{[account.category?.label, account.type?.label].filter(Boolean).join(' · ') || 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Country / region</dt>
            <dd className="mt-0.5">
              {account.countryRegion?.label ?? 'Not set'}
              {localTime && <span className="text-muted-foreground"> · {localTime} there</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">CS Specialist</dt>
            <dd className="mt-0.5">{account.customer.assignedSpecialistEmail ? (names.get(account.customer.assignedSpecialistEmail) ?? account.customer.assignedSpecialistEmail) : 'Unassigned'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Links</dt>
            <dd className="mt-0.5 space-y-0.5">
              {account.sellerOnboardingLink ? (
                <a href={account.sellerOnboardingLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                  Seller onboarding <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="block text-muted-foreground">No seller onboarding link</span>
              )}
              {account.contractLink ? (
                <a href={account.contractLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                  Signed contract <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="block text-muted-foreground">No contract link</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-3">
            <h2 className="font-semibold">Contract</h2>
            {account.contract ? (
              <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
                <p>
                  <span className="font-mono text-xs text-muted-foreground">{account.contract.contractCode}</span>{' '}
                  <Link href="/contracts" className="font-medium hover:underline">
                    {account.contract.name}
                  </Link>
                  <span className="text-muted-foreground"> · reviewed {account.contract.period.toLowerCase()}</span>
                  {!account.contract.isActive && <span className="ml-2 text-xs text-muted-foreground">(switched off)</span>}
                </p>
                {account.contract.sections.length > 0 && (
                  <dl className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-4 gap-y-1">
                    {account.contract.sections
                      .sort((a, b) => a.sectionDef.sortOrder - b.sectionDef.sortOrder)
                      .map((sec) => (
                        <div key={sec.id} className="contents">
                          <dt className="text-muted-foreground">{sec.sectionDef.name}</dt>
                          <dd>{formatSectionValue(sec.sectionDef.fieldType, sec.value)}</dd>
                        </div>
                      ))}
                  </dl>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No contract picked yet.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Notes</h2>
            <p className="text-xs text-muted-foreground">This account’s notes and its customer’s.</p>
            <NotesPanel
              customerId={account.customerId}
              accountId={account.id}
              notes={notes.map((n) => ({ ...n, accountLabel: n.account ? null : 'Customer note' }))}
              canAdd={canEdit}
            />
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Onboarding details and tickets</h2>
            <AccountsView accounts={[account]} canSetGroup={can(user.role, 'leads', 'update')} />
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">History</h2>
            <ActivityTable rows={activity} />
          </section>
        </div>

        <aside className="space-y-6">
          {canEdit && (
            <section className="space-y-3 rounded-xl border bg-card p-4">
              <h2 className="font-semibold">Status</h2>
              {account.reviewAction ? (
                <p className="text-sm text-muted-foreground">Status changes are on hold until the pending review is confirmed or cancelled.</p>
              ) : (
                <StatusChanger kind="account" id={account.id} current={account.status} terminationReasons={terminationReasons} reviewed={needsStatusReview(user.role)} />
              )}
            </section>
          )}

          {canEdit && (
            <section className="space-y-3 rounded-xl border bg-card p-4">
              <h2 className="font-semibold">Account details</h2>
              <AccountEditForm
                accountId={account.id}
                initial={account}
                categories={categories}
                types={types}
                regions={regions}
                contracts={contracts.map((c) => ({ id: c.id, label: `${c.contractCode} · ${c.name}`, isActive: c.isActive }))}
              />
            </section>
          )}

          <section className="space-y-3 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Account managers</h2>
            <AccountManagers accountId={account.id} managers={account.managers} canEdit={canEdit} />
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Status log</h2>
            <ol className="space-y-3 border-l pl-4">
              {account.statusLogs.map((log) => (
                <li key={log.id} className="relative text-sm">
                  <span className={cn('absolute -left-[21px] top-1.5 h-2 w-2 rounded-full', STATUS_META[log.toStatus].dot)} aria-hidden />
                  <p className="font-medium">{log.fromStatus ? `${STATUS_LABELS[log.fromStatus]} → ${STATUS_LABELS[log.toStatus]}` : `Created as ${STATUS_LABELS[log.toStatus]}`}</p>
                  {log.terminationReason && <p className="text-muted-foreground">{log.terminationReason.label}</p>}
                  {log.reason && <p className="whitespace-pre-wrap text-muted-foreground">{log.reason}</p>}
                  <p className="text-xs text-muted-foreground">
                    {(log.effectiveDate ?? log.changedAt).toLocaleString('en-PH', manilaDateTime)} · {log.changedByEmail}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  )
}
