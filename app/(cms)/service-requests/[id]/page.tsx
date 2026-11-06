import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { assertCustomerInScope } from '@/lib/scope'
import { getServiceRequest, listServiceManagers } from '@/lib/service-requests'
import { departmentNames, staffNames } from '@/lib/workforce'
import { manilaDate, manilaDateTime } from '@/lib/customer-fields'
import { SCHEDULE_LABELS, subTicketCode } from '@/lib/onboarding-fields'
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
import { AddVaForm, AssignManagerForm, CandidateActions, CloseLostForm } from '@/components/requests/ServiceRequestControls'
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

  const phase = t.phase as SrPhase
  const closed = isClosed(phase)
  const me = user.email.toLowerCase()
  const isAdmin = user.role === 'ADMIN'
  const canCs = isAdmin || user.role === 'CS_MANAGER' || (user.role === 'CUSTOMER_SPECIALIST' && (await assertCustomerInScope(user, t.customerId)))
  const canManager = isAdmin || (user.role === 'SERVICE_MANAGER' && t.managerEmail === me)
  const canHr = isAdmin || user.role === 'HR_SPECIALIST' || user.role === 'HR_MANAGER'
  const seesCustomers = can(user.role, 'customers')

  const [managers, activity] = await Promise.all([
    canCs && !closed ? listServiceManagers() : Promise.resolve([]),
    prisma.activityLog.findMany({ where: { entityType: { in: ['ServiceRequest', 'VaConnection'] }, OR: [{ entityId: id }, { notes: { contains: srCode(t.ticketNumber) } }] }, orderBy: { createdAt: 'desc' }, take: 60 }),
  ])
  const [names, departments] = await Promise.all([
    staffNames([t.managerEmail ?? '', t.customer.assignedSpecialistEmail ?? '', ...managers.map((m) => m.email)]),
    departmentNames([t.departmentId ?? '', ...managers.map((m) => m.departmentId ?? '')].filter(Boolean)),
  ])
  const name = (e: string | null) => (e ? (names.get(e) ?? e) : null)
  const phaseIndex = OPEN_PHASES.indexOf(phase)

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
            <dt className="text-xs text-muted-foreground">Service Department Manager</dt>
            <dd className="mt-0.5">
              {name(t.managerEmail) ?? 'Not assigned yet'}
              {t.departmentId && <span className="block text-xs text-muted-foreground">{departments.get(t.departmentId) ?? 'Department'}</span>}
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
        </dl>

        {!closed && canCs && (
          <div className="border-t pt-4">
            <AssignManagerForm
              ticketId={t.id}
              current={t.managerEmail}
              managers={managers.map((m) => ({ email: m.email, label: `${name(m.email)}${m.departmentId ? ` · ${departments.get(m.departmentId) ?? 'department'}` : ''}` }))}
            />
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">VA requests</h2>
        {t.requests.map((r) => {
          const candidates = t.candidates.filter((c) => c.requestId === r.id)
          const started = candidates.find((c) => c.stage === 'STARTED')
          const hasMain = candidates.some((c) => c.role === 'MAIN' && ACTIVE_STAGES.includes(c.stage as CandidateStage))
          return (
            <article key={r.id} className="space-y-3 rounded-xl border bg-card p-4">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{subTicketCode(t.ticketNumber, r.lineNo)}</p>
                  <p className="font-medium">{r.service}</p>
                  <p className="text-xs text-muted-foreground">
                    {SCHEDULE_LABELS[r.scheduleType]} · target start {day(r.targetStartDate)}
                  </p>
                </div>
                {started ? (
                  <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">Filled: {started.vaName}</span>
                ) : (
                  !closed && phase !== 'NEW' && canManager && <AddVaForm ticketId={t.id} requestId={r.id} departmentId={t.departmentId} hasMain={hasMain} />
                )}
              </header>
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
                            </td>
                            <td className="px-3 py-2">{!closed && <CandidateActions candidateId={c.id} stage={stage} name={c.vaName} can={{ manager: canManager, hr: canHr, cs: canCs }} />}</td>
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
