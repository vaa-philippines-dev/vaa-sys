import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { assertCustomerInScope } from '@/lib/scope'
import { getServiceRequest } from '@/lib/service-requests'
import { departmentForService, departmentInfo, managesDepartment, requestDepartment } from '@/lib/request-departments'
import { staffNames } from '@/lib/workforce'
import { dayString, manilaDate, manilaDateTime } from '@/lib/customer-fields'
import { REQUEST_GROUP_LABELS, SERVICE_OFFERINGS, subTicketCode, timeZoneOptions, type RequestGroup } from '@/lib/onboarding-fields'
import { ScheduleSummary } from '@/components/requests/ScheduleSummary'
import { RaStatusPill } from '@/components/requests/RaStatusPill'
import type { RaStatus } from '@/lib/rate-agreement-fields'
import { CHANGE_KIND_LABELS, REVIEWER, changeText, scheduleEditOf, snapshotOf } from '@/lib/request-schedule-fields'
import { ScheduleCheck, ScheduleEditor } from '@/components/requests/ScheduleControls'
import { CalendarClock } from 'lucide-react'
import {
  ACTIVE_STAGES,
  CANDIDATE_STAGE_LABELS,
  OPEN_PHASES,
  ROLE_LABELS,
  SR_PHASE_LABELS,
  SR_PHASE_OWNERS,
  SR_TYPE_LABELS,
  isClosed,
  srCode,
  type CandidateRole,
  type CandidateStage,
  type SrPhase,
  type SrType,
} from '@/lib/service-request-fields'
import { ActivityTable } from '@/components/cms/ActivityTable'
import { PhasePill } from '@/components/requests/PhasePill'
import { AddVaForm, CandidateActions, CloseLostForm, RequestServiceChange } from '@/components/requests/ServiceRequestControls'
import { SortableTable } from '@/components/ui/sortable-table'
import { cn } from '@/lib/utils'

const day = (d: Date) => d.toLocaleDateString('en-PH', { ...manilaDate, timeZone: 'UTC' })

// One service request: where it is, who acts next, and its VA candidates.
export default async function ServiceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireCan('serviceRequests', 'read', `/service-requests/${id}`)
  const t = await getServiceRequest(id)
  if (!t) notFound()
  // A CS Specialist sees their own customers' tickets only.
  if (user.role === 'CUSTOMER_SPECIALIST' && !(await assertCustomerInScope(user, t.customerId))) notFound()
  // HR sees only tickets that reached Rate Agreement (Nov 6, 2026).
  if ((user.role === 'HR_SPECIALIST' || user.role === 'HR_MANAGER') && t.rateAgreements.length === 0) notFound()

  const phase = t.phase as SrPhase
  const closed = isClosed(phase)
  const isAdmin = user.role === 'ADMIN'
  const canCs = isAdmin || user.role === 'CS_MANAGER' || (user.role === 'CUSTOMER_SPECIALIST' && (await assertCustomerInScope(user, t.customerId)))
  const canHr = isAdmin || user.role === 'HR_SPECIALIST' || user.role === 'HR_MANAGER'
  const seesCustomers = can(user.role, 'customers')
  const canSeeRa = can(user.role, 'rateAgreements')

  // Each VA request's department and its Service Department Managers (any
  // active Service Manager of it; Nov 6, 2026). Nobody assigns them.
  const [info, activity] = await Promise.all([
    departmentInfo(),
    prisma.activityLog.findMany({ where: { entityType: { in: ['ServiceRequest', 'VaConnection'] }, OR: [{ entityId: id }, { notes: { contains: srCode(t.ticketNumber) } }] }, orderBy: { createdAt: 'desc' }, take: 60 }),
  ])
  const names = await staffNames([t.customer.assignedSpecialistEmail ?? ''])
  const name = (e: string | null) => (e ? (names.get(e) ?? e) : null)
  const deptName = (id: string | null) => (id ? (info.departments.find((d) => d.id === id)?.name ?? 'Unknown department') : null)
  const deptOf = new Map(t.requests.map((r) => [r.id, requestDepartment(info, r)]))
  const managesRequest = (requestId: string) => managesDepartment(user, deptOf.get(requestId) ?? null)
  const ticketDepartments = [...new Set([...deptOf.values()])]
  const phaseIndex = OPEN_PHASES.indexOf(phase)
  // Each service's own department, for the service change form.
  const serviceDepartments = Object.fromEntries(SERVICE_OFFERINGS.map((s) => [s, departmentForService(info, s)]))

  // Schedules (Nov 6, 2026): the customer's CS or a manager of the request's
  // department can change one, also after the VA is connected (kept as its history).
  const canEditSchedule = (requestId: string) => phase !== 'CLOSED_LOST' && (canCs || managesRequest(requestId))
  const canCheck = can(user.role, 'scheduleReviews', 'update')
  const waiting = t.scheduleChanges.filter((c) => c.needsReview && !c.reviewedAt)
  const changers = await staffNames(t.scheduleChanges.flatMap((c) => [c.changedByEmail, c.reviewedByEmail ?? '']))
  const zones = t.requests.some((r) => canEditSchedule(r.id)) ? timeZoneOptions() : []
  const focal = t.account.contacts[0]
  const focalPerson = t.focalName
    ? { name: t.focalName, detail: [t.focalRole, t.focalEmail, t.focalPhone].filter(Boolean).join(' · '), source: 'For this request' }
    : focal
      ? { name: `${focal.firstName} ${focal.lastName}`.trim(), detail: [focal.role, focal.email, focal.whatsapp].filter(Boolean).join(' · '), source: 'The account’s focal contact' }
      : null

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <Link href="/service-requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Service Requests
      </Link>

      <section className="space-y-5 rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">
              {srCode(t.ticketNumber)} · {SR_TYPE_LABELS[t.type as SrType]} service request
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold">
              {seesCustomers ? (
                <Link href={`/accounts/${t.account.id}`} className="hover:underline">
                  {t.account.name}
                </Link>
              ) : (
                t.account.name
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t.account.accountCode} · customer{' '}
              {seesCustomers ? (
                <Link href={`/customers/${t.customer.id}`} className="hover:underline">
                  {t.customer.name}
                </Link>
              ) : (
                t.customer.name
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 text-right">
            <PhasePill phase={phase} className="h-7 px-3 text-sm" />
            <p className="text-xs text-muted-foreground">
              since {t.phaseChangedAt.toLocaleDateString('en-PH', manilaDate)}
              {!closed && SR_PHASE_OWNERS[phase] && ` · with the ${SR_PHASE_OWNERS[phase]}`}
            </p>
          </div>
        </div>

        {/* The workflow, with this ticket's phase marked. */}
        <ol className="flex flex-wrap gap-1.5 text-[11px]" aria-label="Workflow">
          {OPEN_PHASES.map((p, i) => (
            <li
              key={p}
              aria-current={p === phase ? 'step' : undefined}
              className={cn(
                'rounded-full border px-2.5 py-1',
                p === phase ? 'border-primary bg-primary text-primary-foreground' : phase === 'CLOSED_WON' || i < phaseIndex ? 'bg-muted text-foreground' : 'text-muted-foreground'
              )}
            >
              {SR_PHASE_LABELS[p]}
            </li>
          ))}
        </ol>

        <dl className="grid gap-x-6 gap-y-3 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">CS assigned</dt>
            <dd className="mt-0.5">{name(t.customer.assignedSpecialistEmail) ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{ticketDepartments.length === 1 ? 'Department' : 'Departments'}</dt>
            <dd className="mt-0.5">
              {ticketDepartments.map((d) => deptName(d) ?? 'Not set').join(', ') || 'Not set'}
              {ticketDepartments.some((d) => !d || !info.managers.get(d)?.length) && (
                <span className="block text-xs text-warning">No Service Department Manager for {ticketDepartments.filter((d) => !d || !info.managers.get(d)?.length).map((d) => deptName(d) ?? 'one VA request').join(', ')}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Opened</dt>
            <dd className="mt-0.5">
              {t.createdAt.toLocaleDateString('en-PH', manilaDate)}
              <span className="block text-xs text-muted-foreground">{t.createdByEmail === 'onboarding-form' ? 'From the onboarding form' : `by ${t.createdByEmail}`}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{closed ? 'Closed' : 'VA requests'}</dt>
            <dd className="mt-0.5">
              {closed && t.closedAt ? t.closedAt.toLocaleDateString('en-PH', manilaDate) : `${t.requests.length} VA${t.requests.length === 1 ? '' : 's'} needed`}
              {t.closedReason && <span className="block text-xs text-muted-foreground">{t.closedReason}</span>}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Focal person</dt>
            <dd className="mt-0.5">
              {focalPerson ? (
                <>
                  {focalPerson.name}
                  <span className="block text-xs text-muted-foreground">
                    {focalPerson.detail}
                    {focalPerson.detail && ' · '}
                    {focalPerson.source}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Client time zone</dt>
            <dd className="mt-0.5">{t.account.timeZone ? t.account.timeZone.replace(/_/g, ' ') : <span className="text-muted-foreground">Not set on the account</span>}</dd>
          </div>
        </dl>

        {waiting.length > 0 && (
          <div role="status" className="space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CalendarClock className="h-4 w-4 text-warning" />
              {waiting.length === 1 ? 'A change' : `${waiting.length} changes`} to {waiting.every((c) => c.kind === 'SERVICE') ? 'the service or department' : waiting.some((c) => c.kind === 'SERVICE') ? 'the schedule, service or department' : 'the schedule'} during this request{' '}
              {waiting.length === 1 ? 'waits' : 'wait'} for {REVIEWER}: it affects what the customer is billed.
            </p>
            <p className="text-xs text-muted-foreground">The VA can’t be marked started until every change is checked. Lead Management has been told.</p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">VA requests</h2>
        {t.requests.map((r) => {
          const candidates = t.candidates.filter((c) => c.requestId === r.id)
          const started = candidates.find((c) => c.stage === 'STARTED')
          const hasMain = candidates.some((c) => c.role === 'MAIN' && ACTIVE_STAGES.includes(c.stage as CandidateStage))
          const schedule = snapshotOf(r)
          const zone = r.timeZone ?? t.account.timeZone
          const history = t.scheduleChanges.filter((c) => c.requestId === r.id)
          const dept = deptOf.get(r.id) ?? null
          const deptManagers = dept ? (info.managers.get(dept) ?? []) : []
          const canManager = managesRequest(r.id)
          const facts: [string, React.ReactNode][] = [
            ['Request group', REQUEST_GROUP_LABELS[r.requestGroup as RequestGroup]],
            ['Time tracker', r.taskTracker == null ? 'Not asked' : r.taskTracker ? 'Yes' : 'No'],
            ['Tasks', r.tasks || '—'],
            ['Tools', r.tools || '—'],
            ['Must-haves or deal breakers', r.mustHaves || '—'],
          ]
          return (
            <article key={r.id} className="space-y-3 rounded-xl border bg-card p-4">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{subTicketCode(t.ticketNumber, r.lineNo)}</p>
                  <p className="font-medium">{r.service}</p>
                  <p className="text-xs text-muted-foreground">Target start {day(r.targetStartDate)}</p>
                </div>
                {started ? (
                  <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">Filled: {started.vaName}</span>
                ) : (
                  !closed && canManager && <AddVaForm ticketId={t.id} requestId={r.id} departmentId={dept} hasMain={hasMain} />
                )}
              </header>
              {/* The request's department and its Service Department Managers. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
                <span className="text-xs text-muted-foreground">Department</span>
                <span className="font-medium">{deptName(dept) ?? 'Not set'}</span>
                {deptManagers.length > 0 ? (
                  <span className="text-muted-foreground">
                    Service Department Manager{deptManagers.length === 1 ? '' : 's'}: <span className="text-foreground">{deptManagers.map((m) => m.name).join(', ')}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                    <TriangleAlert className="h-3 w-3" />
                    {dept ? `No Service Department Manager for ${deptName(dept)} yet. Add one on Access.` : 'No department: pick one so its Service Department Manager can act.'}
                  </span>
                )}
              </div>
              {/* The customer's CS changes the service or department, after confirming it. */}
              {canCs && !closed && !started && (
                <RequestServiceChange
                  requestId={r.id}
                  service={r.service}
                  departmentId={dept}
                  departments={info.departments}
                  services={SERVICE_OFFERINGS}
                  serviceDepartments={serviceDepartments}
                  isNew={t.type === 'NEW'}
                />
              )}
              <ScheduleSummary schedule={schedule} timeZone={zone} timeZoneIsAccounts={!r.timeZone} targetStartDate={dayString(r.targetStartDate)} />
              <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-[13px] sm:grid-cols-2">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] text-muted-foreground">{label}</dt>
                    <dd className="whitespace-pre-wrap">{value}</dd>
                  </div>
                ))}
              </dl>
              {canEditSchedule(r.id) && (
                <ScheduleEditor
                  requestId={r.id}
                  initial={scheduleEditOf(schedule, r.timeZone)}
                  accountTimeZone={t.account.timeZone}
                  timeZones={zones}
                  open={!closed}
                  targetStartDate={dayString(r.targetStartDate)}
                />
              )}
              {history.length > 0 && (
                <details className="rounded-lg border px-3 py-2 text-[13px]" open={history.some((c) => c.needsReview && !c.reviewedAt)}>
                  <summary className="cursor-pointer font-medium">Change history ({history.length})</summary>
                  <ol className="mt-2 space-y-2">
                    {history.map((c) => (
                      <li key={c.id} className="space-y-0.5 border-t pt-2 first:border-0 first:pt-0">
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">{CHANGE_KIND_LABELS[c.kind] ?? c.kind}</span> · {c.changedAt.toLocaleString('en-PH', manilaDateTime)} by{' '}
                          {changers.get(c.changedByEmail) ?? c.changedByEmail} · during {SR_PHASE_LABELS[c.phase as SrPhase] ?? c.phase}
                        </p>
                        <p className="text-muted-foreground line-through decoration-muted-foreground/50">{changeText(c.kind, c.before)}</p>
                        <p>{changeText(c.kind, c.after)}</p>
                        {c.needsReview && !c.reviewedAt ? (
                          canCheck ? (
                            <ScheduleCheck changeId={c.id} />
                          ) : (
                            <span className="inline-block rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">Waiting for {REVIEWER}</span>
                          )
                        ) : c.needsReview ? (
                          <p className="text-[11px] text-success">
                            Checked by {changers.get(c.reviewedByEmail ?? '') ?? c.reviewedByEmail} {c.reviewedAt?.toLocaleString('en-PH', manilaDateTime)}
                            {c.reviewNote && ` · ${c.reviewNote}`}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {phase === 'NEW' ? 'VAs are assigned once the Service Department Manager is.' : 'No VA assigned yet. The Service Department Manager assigns a main VA and buffers.'}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <SortableTable
                    className="w-full min-w-[640px] text-left text-[13px]"
                    theadClassName="border-b text-[11px] uppercase tracking-wide text-muted-foreground"
                    columns={[
                      { key: 'va', label: 'VA', className: 'px-3 py-2 font-medium' },
                      { key: 'role', label: 'Role', className: 'px-3 py-2 font-medium' },
                      { key: 'stage', label: 'Stage', className: 'px-3 py-2 font-medium' },
                      { key: 'actions', label: <span className="sr-only">Next step</span>, sortable: false, className: 'px-3 py-2' },
                    ]}
                    rows={candidates.map((c) => {
                      const stage = c.stage as CandidateStage
                      const conn = t.connections.find((x) => x.candidateId === c.id)
                      const ra = t.rateAgreements.find((x) => x.candidateId === c.id)
                      return {
                        id: c.id,
                        values: { va: c.vaName, role: c.role === 'MAIN' ? 0 : 1, stage: ['VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA', 'STARTED', 'DECLINED', 'WITHDRAWN'].indexOf(stage) },
                        node: (
                          <tr key={c.id} className={cn('border-b align-top last:border-0', !ACTIVE_STAGES.includes(stage) && stage !== 'STARTED' && 'text-muted-foreground')}>
                            <td className="px-3 py-2">
                              <span className="font-medium">{c.vaName}</span>
                              {c.vaEmail && <span className="block text-[11px] text-muted-foreground">{c.vaEmail}</span>}
                            </td>
                            <td className="px-3 py-2">{ROLE_LABELS[c.role as CandidateRole]}</td>
                            <td className="px-3 py-2">
                              {CANDIDATE_STAGE_LABELS[stage]}
                              <span className="block text-[11px] text-muted-foreground">
                                {stage === 'DECLINED' && c.declineReason
                                  ? c.declineReason
                                  : stage === 'STARTED' && c.startDate
                                    ? `Started ${day(c.startDate)}${conn ? ` · ${conn.connectionCode}` : ''}`
                                    : c.notes ?? `since ${c.stageChangedAt.toLocaleString('en-PH', manilaDateTime)}`}
                              </span>
                              {ra && canSeeRa && (
                                <Link href={`/rate-agreements/${ra.id}`} className="mt-1 inline-flex items-center gap-1.5 text-[11px] hover:underline">
                                  Rate Agreement <RaStatusPill status={ra.status as RaStatus} />
                                </Link>
                              )}
                            </td>
                            <td className="px-3 py-2">{!closed && <CandidateActions candidateId={c.id} stage={stage} name={c.vaName} can={{ manager: canManager, hr: canHr, cs: canCs }} rateAgreementId={ra?.id} />}</td>
                          </tr>
                        ),
                      }
                    })}
                  />
                </div>
              )}
            </article>
          )
        })}
      </section>

      {!closed && (isAdmin || user.role === 'CS_MANAGER') && (
        <div className="flex justify-end border-t pt-4">
          <CloseLostForm ticketId={t.id} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">History</h2>
        <ActivityTable rows={activity} />
      </section>
    </main>
  )
}
