import { Check, Circle, ExternalLink, Mail } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { CopyButton } from '@/components/leads/OnboardingLinkPanel'
import { ConfirmContractForm, ContractPicker, MarkContractSent, RequestTypeSwitch } from '@/components/leads/LeadWorkflowControls'
import { cn } from '@/lib/utils'
import { dayString, manilaDate, manilaDateTime } from '@/lib/customer-fields'
import { formatSectionValue } from '@/lib/contract-fields'
import { PHASE_LABELS, REQUEST_TYPE_LABELS, contractEmail, phaseOrder, type LeadPhase } from '@/lib/lead-phase-fields'
import type { getCustomer } from '@/lib/customers'
import type { ContractChoice } from '@/lib/contracts'

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>

const when = (d: Date) => d.toLocaleString('en-PH', manilaDateTime)
const day = (d: Date) => new Date(`${dayString(d)}T00:00:00+08:00`).toLocaleDateString('en-PH', manilaDate)

const short = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })

function firstDate(dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d !== null)
  return real.length ? new Date(Math.min(...real.map((d) => d.getTime()))) : null
}

// Lead Management's workflow on the lead's page: the phases in the order
// this lead goes through them (Customer Intake with its onboarding steps),
// the request type, then what the current phase needs (pick and send the
// contract, confirm the signed contract and first payment). `intake` (the
// onboarding link) goes right under the phases. The CS team's handoff
// happens in Customer Management.
export function LeadWorkflow({
  customer,
  choices,
  senderName,
  canEdit,
  intake,
}: {
  customer: Customer
  choices: ContractChoice[]
  senderName: string
  canEdit: boolean
  intake?: React.ReactNode
}) {
  // An imported lead can be past Customer Intake without the form.
  const formSubmitted = customer.submissions.length > 0 || !!customer.intakeCompletedAt
  const phase = customer.leadPhase
  const submittedAt = firstDate(customer.submissions.map((s) => s.submittedAt))
  const intakeSteps = [
    { label: 'Lead added', at: customer.createdAt },
    { label: 'Link sent', at: firstDate(customer.onboardingLinks.map((l) => l.createdAt)) },
    { label: 'Form opened', at: firstDate(customer.onboardingLinks.map((l) => l.openedAt)) },
    { label: 'Form submitted', at: submittedAt },
  ]
  const imported = !submittedAt && customer.intakeCompletedAt
  const order = phaseOrder(customer.requestType)
  const at = order.indexOf(phase)
  const doneAt: Partial<Record<LeadPhase, Date | null>> = {
    CUSTOMER_INTAKE: customer.submissions[0]?.submittedAt ?? customer.intakeCompletedAt,
    CONTRACT_BILLING_INITIATION: customer.contractSentAt,
    CONTRACT_PAYMENT_CONFIRMATION: customer.contractConfirmedAt,
    CUSTOMER_SUCCESS_HANDOFF: customer.handoffCompletedAt,
  }

  const account = customer.accounts.find((a) => a.submission) ?? customer.accounts[0] ?? null
  // A lead without an account (imported) keeps its contract on the customer.
  const contractId = account ? account.contractId : customer.contractId
  const contract = contractId ? (choices.find((c) => c.id === contractId) ?? null) : null
  const pickedName = account ? account.contract && `${account.contract.contractCode} · ${account.contract.name}` : null
  const terms = contract?.terms.map((t) => ({ name: t.name, value: formatSectionValue(t.fieldType, t.value) })) ?? []
  const email = contract
    ? contractEmail({ customerName: customer.name, senderName, contractName: contract.name, contractCode: contract.contractCode, templateUrl: contract.templateUrl, terms })
    : null
  const mailto = email ? `mailto:${encodeURIComponent(customer.email ?? '')}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}` : null
  const confirmed = !!customer.contractConfirmedAt
  const sentOther = !!customer.contractSentAt && !!contractId && customer.contractSentId !== contractId
  // Special Request is chosen in Contract & Billing Initiation only, before
  // the contract goes out. A Special Request lead goes straight to Customer
  // Success Handoff, so it can be put back to Regular there, until the CS
  // team has onboarded the customer.
  const mayChangeType =
    canEdit &&
    !customer.handoffCompletedAt &&
    (customer.requestType === 'REGULAR' ? phase === 'CONTRACT_BILLING_INITIATION' : phase === 'CUSTOMER_SUCCESS_HANDOFF')

  return (
    <div className="space-y-6">
      <section className="space-y-5 rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Workflow</h2>
            <p className="text-sm text-muted-foreground">
              Now in <span className="font-medium text-foreground">{PHASE_LABELS[phase]}</span>
              {customer.leadPhaseChangedAt && phase !== 'CUSTOMER_INTAKE' && ` since ${when(customer.leadPhaseChangedAt)}`}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-3 py-1 text-xs font-medium', customer.requestType === 'SPECIAL' ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground')}>
              {REQUEST_TYPE_LABELS[customer.requestType]}
            </span>
            {mayChangeType && <RequestTypeSwitch customerId={customer.id} current={customer.requestType} />}
          </div>
        </div>
        <ol className="grid gap-3 sm:grid-cols-5">
          {order.map((p, i) => {
            const done = i < at || phase === 'NEW_CUSTOMER_ONBOARDED'
            const current = i === at && phase !== 'NEW_CUSTOMER_ONBOARDED'
            const date = doneAt[p]
            return (
              <li
                key={p}
                className={cn('flex gap-2.5 rounded-xl border p-3 sm:flex-col', current && 'border-primary bg-primary/5', !done && !current && 'text-muted-foreground')}
                aria-current={current ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                    done ? 'border-primary bg-primary text-primary-foreground' : current ? 'border-primary text-foreground' : 'border-border'
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-tight">{PHASE_LABELS[p]}</span>
                  <span className="text-[11px] text-muted-foreground">{done ? (date ? when(date) : 'Moved on') : current ? 'Now' : 'Not yet'}</span>
                  {p === 'CUSTOMER_INTAKE' && (
                    // The onboarding steps, each done when it actually happened.
                    <ul className="mt-2 space-y-1">
                      {intakeSteps.map((s) => (
                        <li key={s.label} className={cn('flex items-center gap-1.5 text-[11px]', s.at ? 'text-foreground' : 'text-muted-foreground')} title={s.at ? when(s.at) : undefined}>
                          {s.at ? <Check className="h-3 w-3 shrink-0 text-primary" /> : <Circle className="h-3 w-3 shrink-0" />}
                          <span className="min-w-0 flex-1 truncate">{s.label}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{s.at ? short.format(s.at) : '–'}</span>
                        </li>
                      ))}
                      {imported && <li className="text-[11px] text-muted-foreground">Marked done on import, {short.format(imported)}</li>}
                    </ul>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
        {customer.requestType === 'SPECIAL' && (
          <p className="text-xs text-muted-foreground">Special Request: the customer meets the VA first, so the contract and payment are confirmed after the Customer Success Handoff.</p>
        )}
        {canEdit && customer.requestType === 'REGULAR' && formSubmitted && phase !== 'CONTRACT_BILLING_INITIATION' && phase !== 'NEW_CUSTOMER_ONBOARDED' && (
          <p className="text-xs text-muted-foreground">A Special Request can only be chosen in Contract &amp; Billing Initiation, before the contract is sent.</p>
        )}
      </section>

      {intake}

      {formSubmitted && (
        <section className="space-y-4 rounded-2xl border bg-card p-6">
          <div>
            <h2 className="text-base font-semibold">Contract</h2>
            <p className="text-sm text-muted-foreground">
              Contract &amp; Billing Initiation: pick the contract for {account ? account.name : customer.name}, send it, then mark it as sent.
            </p>
          </div>

          {canEdit && !confirmed ? (
            <ContractPicker customerId={customer.id} current={contractId} choices={choices.map((c) => ({ id: c.id, label: `${c.contractCode} · ${c.name}` }))} />
          ) : (
            <p className="text-sm">
              {contract ? `${contract.contractCode} · ${contract.name}` : pickedName ?? <span className="text-muted-foreground">No contract picked.</span>}
            </p>
          )}
          {contractId && !contract && <p className="text-xs text-muted-foreground">This contract is switched off, so it can’t be sent. Pick another one.</p>}

          {contract && (
            <div className="space-y-3">
              {terms.length > 0 ? (
                <dl className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                  {terms.map((t) => (
                    <div key={t.name} className="contents">
                      <dt className="text-muted-foreground">{t.name}</dt>
                      <dd>{t.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">This contract has no terms filled in.</p>
              )}
              {contract.templateUrl ? (
                <a href={contract.templateUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Open the template
                </a>
              ) : (
                <p className="text-xs text-warning">This contract has no template link yet. Add one under Contracts before sending.</p>
              )}
            </div>
          )}

          {email && mailto && !confirmed && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Email to send</p>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="mb-2">
                  <span className="text-muted-foreground">Subject: </span>
                  {email.subject}
                </p>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm">{email.body}</pre>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={`Subject: ${email.subject}\n\n${email.body}`} label="Copy email" />
                <a href={mailto} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <Mail /> Open in email app
                </a>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
            {customer.contractSentAt ? (
              <p className="text-muted-foreground">
                Sent {when(customer.contractSentAt)} by {customer.contractSentByEmail}
                {customer.contractSent && ` (${customer.contractSent.contractCode})`}.
                {sentOther && ' The contract has changed since, so send the new one.'}
              </p>
            ) : (
              <p className="text-muted-foreground">Not sent yet.</p>
            )}
            {canEdit && !confirmed && contract && (!customer.contractSentAt || sentOther) && <MarkContractSent customerId={customer.id} again={!!customer.contractSentAt} />}
          </div>
          <p className="text-xs text-muted-foreground">Initial billing will be generated and sent from the Accounting system once it is connected.</p>
        </section>
      )}

      {customer.contractSentAt && (
        <section className="space-y-3 rounded-2xl border bg-card p-6">
          <div>
            <h2 className="text-base font-semibold">Contract &amp; payment confirmation</h2>
            <p className="text-sm text-muted-foreground">When the customer has signed the contract and made their first payment.</p>
          </div>
          {confirmed ? (
            <p className="text-sm">
              Confirmed {when(customer.contractConfirmedAt!)} by {customer.contractConfirmedByEmail}
              {customer.contractSignedOn && ` · signed ${day(customer.contractSignedOn)}`}
              {customer.paymentDate && ` · first payment ${day(customer.paymentDate)}`}.
            </p>
          ) : canEdit ? (
            <ConfirmContractForm customerId={customer.id} paymentDate={customer.paymentDate && !customer.noPaymentYet ? dayString(customer.paymentDate) : null} />
          ) : (
            <p className="text-sm text-muted-foreground">Not confirmed yet.</p>
          )}
        </section>
      )}

      {(phase === 'CUSTOMER_SUCCESS_HANDOFF' || customer.handoffCompletedAt) && (
        <section className="space-y-2 rounded-2xl border bg-card p-6">
          <h2 className="text-base font-semibold">Customer Success Handoff</h2>
          <p className="text-sm text-muted-foreground">
            {customer.handoffCompletedAt
              ? `Onboarded by the CS team ${when(customer.handoffCompletedAt)} (${customer.handoffCompletedByEmail}).`
              : 'Waiting for the CS team to onboard the customer officially. They mark it done on the customer’s page in Customer Management.'}
          </p>
        </section>
      )}

      {customer.phaseLogs.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Phase history</h2>
          <ol className="space-y-3 border-l pl-4">
            {customer.phaseLogs.map((log) => (
              <li key={log.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />
                <p className="font-medium">
                  {PHASE_LABELS[log.fromPhase]} → {PHASE_LABELS[log.toPhase]}
                </p>
                {log.note && <p className="text-muted-foreground">{log.note}</p>}
                <p className="text-xs text-muted-foreground">
                  {when(log.changedAt)} · {log.changedByEmail}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
