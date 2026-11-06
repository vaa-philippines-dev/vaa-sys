import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, LockKeyhole, TriangleAlert } from 'lucide-react'
import { rateViewerEmail, requireCan } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { contractDefaults, getRateAgreement, listHrPeople, mayConfirmSchedule, mayReadRa, mayWorkRa, canAssignRa } from '@/lib/rate-agreements'
import { departmentInfo, requestDepartment } from '@/lib/request-departments'
import { staffNames, vaFileLinks } from '@/lib/workforce'
import { vaBaseRateForService } from '@/lib/workforce-org'
import { RATE_PROBLEMS } from '@/lib/workforce-org-fields'
import { dayString, manilaDate, manilaDateTime, manilaToday } from '@/lib/customer-fields'
import { subTicketCode } from '@/lib/onboarding-fields'
import { snapshotOf } from '@/lib/request-schedule-fields'
import { ROLE_LABELS, SR_TYPE_LABELS, srCode, type CandidateRole, type SrType } from '@/lib/service-request-fields'
import { RA_BOND_LABELS, RA_STATUS_LABELS, RA_STEPS, RA_STEP_ACTIONS, nextRaStep, raTermsLocked, type RaBond, type RaStatus } from '@/lib/rate-agreement-fields'
import { RaAssignSelect, RaStepForm, RaTermsForm, RevealRate } from '@/components/requests/RateAgreementControls'
import { RaStatusPill } from '@/components/requests/RaStatusPill'
import { ScheduleSummary } from '@/components/requests/ScheduleSummary'
import { ActivityTable } from '@/components/cms/ActivityTable'
import { cn } from '@/lib/utils'

const day = (d: Date) => d.toLocaleDateString('en-PH', { ...manilaDate, timeZone: 'UTC' })

// One VA's Rate Agreement (Nov 6, 2026): the summary HR sends from, the
// terms, and its steps. "Confirm Rate Agreement" on a service request opens it.
export default async function RateAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireCan('rateAgreements', 'read', `/rate-agreements/${id}`)
  const ra = await getRateAgreement(id)
  if (!ra || !(await mayReadRa(user, ra.ticket.customerId))) notFound()

  const t = ra.ticket
  const r = ra.request
  const c = ra.candidate
  const status = ra.status as RaStatus
  const live = status !== 'CANCELLED' && t.phase !== 'CLOSED_LOST' && c.stage === 'RATE_AGREEMENT'
  const canWork = live && mayWorkRa(user, ra)
  const next = live ? nextRaStep(status) : null
  const canStep = next && next !== 'PREPARED' ? (next === 'SCHEDULE_CONFIRMED' ? await mayConfirmSchedule(user, ra, t.customerId) : canWork) : false
  const canAssign = status !== 'CANCELLED' && t.phase !== 'CLOSED_LOST' && canAssignRa(user)

  const [info, links, rate, people, activity] = await Promise.all([
    departmentInfo(),
    vaFileLinks(c.vaProfileId),
    vaBaseRateForService(r.service, rateViewerEmail(user)),
    canAssign ? listHrPeople() : Promise.resolve([]),
    prisma.activityLog.findMany({ where: { entityType: 'RateAgreement', entityId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ])
  const dept = requestDepartment(info, r)
  const deptName = dept ? (info.departments.find((d) => d.id === dept)?.name ?? 'Unknown department') : null
  const names = await staffNames([ra.assignedToEmail, ra.preparedByEmail, ra.scheduleConfirmedByEmail, ra.payrollAckByEmail, ra.sentByEmail, ra.vaAckByEmail, t.customer.assignedSpecialistEmail].filter((e): e is string => !!e))
  const name = (e: string | null) => (e ? (names.get(e) ?? e) : null)
  const contract = t.account.contract
  const defaults = contractDefaults(contract, r)
  const schedule = snapshotOf(r)
  const zone = r.timeZone ?? t.account.timeZone
  const sections = [...(contract?.sections ?? [])].sort((a, b) => a.sectionDef.sortOrder - b.sectionDef.sortOrder)

  // When and by whom each step was recorded.
  const stamps: Record<RaStatus, { at: Date | null; by: string | null }> = {
    WAITING: { at: ra.createdAt, by: null },
    PREPARED: { at: ra.preparedAt, by: ra.preparedByEmail },
    SCHEDULE_CONFIRMED: { at: ra.scheduleConfirmedAt, by: ra.scheduleConfirmedByEmail },
    PAYROLL_ACKNOWLEDGED: { at: ra.payrollAckAt, by: ra.payrollAckByEmail },
    SENT_TO_VA: { at: ra.sentOn, by: ra.sentByEmail },
    VA_ACKNOWLEDGED: { at: ra.vaAckAt, by: ra.vaAckByEmail },
    CANCELLED: { at: ra.cancelledAt, by: null },
  }
  const reached = status === 'CANCELLED' ? -1 : RA_STEPS.indexOf(status)

  const summary: [string, React.ReactNode][] = [
    ['Department', deptName ?? 'Not set'],
    [
      'Customer',
      can(user.role, 'customers') ? (
        <Link href={`/customers/${t.customer.id}`} className="hover:underline">
          {t.customer.name}
        </Link>
      ) : (
        t.customer.name
      ),
    ],
    [
      'Account',
      <>
        {can(user.role, 'accounts') ? (
          <Link href={`/accounts/${t.account.id}`} className="hover:underline">
            {t.account.name}
          </Link>
        ) : (
          t.account.name
        )}
        <span className="block text-xs text-muted-foreground">{t.account.accountCode}</span>
      </>,
    ],
    [
      'Contract of client',
      contract ? (
        <>
          {contract.templateUrl ? (
            <a href={contract.templateUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              {contract.name} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            contract.name
          )}
          <span className="block text-xs text-muted-foreground">
            {contract.contractCode}
            {sections.map((s) => ` · ${s.sectionDef.name}: ${s.value}${s.sectionDef.fieldType === 'PERCENTAGE' && !s.value.includes('%') ? '%' : ''}`).join('')}
          </span>
        </>
      ) : (
        <span className="text-warning">No contract on the account</span>
      ),
    ],
    ['VA type', `${SR_TYPE_LABELS[t.type as SrType]} · ${ROLE_LABELS[c.role as CandidateRole]}`],
    [
      'VA name',
      <>
        {c.vaName}
        {c.vaEmail && <span className="block text-xs text-muted-foreground">{c.vaEmail}</span>}
      </>,
    ],
    [
      '201 file',
      links.file201 ? (
        <a href={links.file201} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          Open {links.file201Label} <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="text-muted-foreground">Not on their VA Workforce profile yet</span>
      ),
    ],
    [
      'Payout summary',
      links.payoutSummary ? (
        <a href={links.payoutSummary} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          Open payout summary <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="text-muted-foreground">Not on their VA Workforce profile yet</span>
      ),
    ],
    [
      'Rate (confidential)',
      !rate ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <LockKeyhole className="h-3 w-3" /> Only people allowed to see the rates
        </span>
      ) : rate.problem ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <LockKeyhole className="h-3 w-3" /> {RATE_PROBLEMS[rate.problem]}
        </span>
      ) : rate.value == null ? (
        <span className="text-muted-foreground">No VA Base Rate set for {r.service}</span>
      ) : (
        <>
          <RevealRate value={rate.value} />
          <span className="block text-xs text-muted-foreground">The VA Base Rate of {r.service}</span>
        </>
      ),
    ],
  ]

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <Link href="/rate-agreements" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Rate Agreements
      </Link>

      <section className="space-y-5 rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">
              <Link href={`/service-requests/${t.id}`} className="hover:underline">
                {srCode(t.ticketNumber)}
              </Link>{' '}
              · {subTicketCode(t.ticketNumber, r.lineNo)} · {r.service}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold">Rate Agreement · {c.vaName}</h1>
            <p className="text-sm text-muted-foreground">
              {t.account.name} · {t.customer.name}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 text-right">
            <RaStatusPill status={status} className="h-7 px-3 text-sm" />
            <p className="text-xs text-muted-foreground">since {ra.statusChangedAt.toLocaleDateString('en-PH', manilaDate)}</p>
          </div>
        </div>

        {status === 'CANCELLED' && (
          <p role="status" className="rounded-xl border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
            Cancelled{ra.cancelledReason ? `: ${ra.cancelledReason}` : ''}.
          </p>
        )}

        {/* The steps, with when and by whom each was recorded. */}
        <ol className="grid gap-2 text-[12px] sm:grid-cols-5" aria-label="Rate Agreement steps">
          {RA_STEPS.map((s, i) => {
            const done = i <= reached
            const stamp = stamps[s]
            return (
              <li key={s} aria-current={s === status ? 'step' : undefined} className={cn('rounded-lg border px-2.5 py-2', done ? 'border-primary/40 bg-primary/10' : 'text-muted-foreground')}>
                <p className="font-medium">{RA_STATUS_LABELS[s]}</p>
                {done && stamp.at && (
                  <p className="text-[11px] text-muted-foreground">
                    {s === 'SENT_TO_VA' ? `Sent ${day(stamp.at)}` : stamp.at.toLocaleString('en-PH', manilaDateTime)}
                    {stamp.by && ` · ${name(stamp.by)}`}
                  </p>
                )}
              </li>
            )
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-4 text-sm">
          <span className="text-xs text-muted-foreground">HR Specialist</span>
          {canAssign ? (
            <RaAssignSelect id={ra.id} current={ra.assignedToEmail} people={people} />
          ) : ra.assignedToEmail ? (
            <span className="font-medium">{name(ra.assignedToEmail)}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
              <TriangleAlert className="h-3 w-3" /> Not assigned yet: an HR Manager assigns it
            </span>
          )}
          {ra.assignedAt && ra.assignedByEmail && <span className="text-xs text-muted-foreground">assigned {ra.assignedAt.toLocaleDateString('en-PH', manilaDate)}</span>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Summary</h2>
        <dl className="grid gap-x-6 gap-y-3 rounded-2xl border bg-card p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {summary.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
        <ScheduleSummary schedule={schedule} timeZone={zone} timeZoneIsAccounts={!r.timeZone} targetStartDate={dayString(r.targetStartDate)} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Terms</h2>
        <div className="rounded-2xl border bg-card p-5">
          {canWork && !raTermsLocked(status) ? (
            <RaTermsForm
              id={ra.id}
              status={status}
              initial={{
                bond: (ra.bond as RaBond | null) ?? defaults.bond.value,
                nightDifferential: ra.nightDifferential ?? defaults.nightDifferential.value,
                incrementalWage: ra.incrementalWage ?? defaults.incrementalWage.value,
                notes: ra.notes ?? '',
              }}
              hints={{
                bond: ra.bond ? 'Set by HR.' : defaults.bond.why,
                nightDifferential: ra.nightDifferential != null ? `Set by HR. ${defaults.nightDifferential.why}` : defaults.nightDifferential.why,
                incrementalWage: ra.incrementalWage != null ? `Set by HR. ${defaults.incrementalWage.why}` : defaults.incrementalWage.why,
              }}
              canEdit
            />
          ) : (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Training or Performance Bond</dt>
                <dd className="mt-0.5">{ra.bond ? RA_BOND_LABELS[ra.bond as RaBond] : <span className="text-muted-foreground">Not set yet</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Night Differential applies</dt>
                <dd className="mt-0.5">{ra.nightDifferential == null ? <span className="text-muted-foreground">Not set yet ({defaults.nightDifferential.why})</span> : ra.nightDifferential ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Incremental Wage Increase applies</dt>
                <dd className="mt-0.5">{ra.incrementalWage == null ? <span className="text-muted-foreground">Not set yet ({defaults.incrementalWage.why})</span> : ra.incrementalWage ? 'Yes' : 'No'}</dd>
              </div>
              {ra.notes && (
                <div className="sm:col-span-3">
                  <dt className="text-xs text-muted-foreground">Notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap">{ra.notes}</dd>
                </div>
              )}
            </dl>
          )}
          {live && !canWork && (
            <p className="mt-3 text-xs text-muted-foreground">
              {ra.assignedToEmail ? `Only ${name(ra.assignedToEmail)} (or an HR Manager) changes the terms.` : 'An HR Manager assigns it to an HR Specialist, who sets the terms.'}
            </p>
          )}
        </div>
      </section>

      {next && next !== 'PREPARED' && (
        <section className="space-y-3">
          <h2 className="font-semibold">Next step: {RA_STATUS_LABELS[next]}</h2>
          <div className="rounded-2xl border bg-card p-5">
            {canStep ? (
              <RaStepForm id={ra.id} to={next} label={RA_STEP_ACTIONS[next]} today={manilaToday()} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {next === 'SCHEDULE_CONFIRMED' ? `The customer’s CS (${name(t.customer.assignedSpecialistEmail) ?? 'unassigned'}) or the HR Specialist records it.` : 'The HR Specialist it’s assigned to records it.'}
              </p>
            )}
            {next === 'VA_ACKNOWLEDGED' && <p className="mt-2 text-xs text-muted-foreground">Once the VA acknowledges it, they move on to the Kick-off Call.</p>}
          </div>
        </section>
      )}
      {status === 'VA_ACKNOWLEDGED' && (
        <p className="text-sm text-muted-foreground">
          The VA acknowledged it and moved on to the Kick-off Call{' '}
          <Link href={`/service-requests/${t.id}`} className="text-primary hover:underline">
            on {srCode(t.ticketNumber)}
          </Link>
          .
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">History</h2>
        <ActivityTable rows={activity} />
      </section>
    </main>
  )
}
