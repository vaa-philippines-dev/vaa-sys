import { Moon, Star } from 'lucide-react'
import { RequestGroupSelect } from '@/components/customers/RequestGroupSelect'
import { CopyButton } from '@/components/leads/OnboardingLinkPanel'
import { manilaDate, manilaDateTime } from '@/lib/customer-fields'
import { onboardingUrl } from '@/lib/onboarding'
import {
  PART3_SCENARIOS,
  PART3_STYLE_LABELS,
  PART3_STYLES,
  PAYMENT_LABELS,
  REQUEST_GROUP_LABELS,
  SCHEDULE_LABELS,
  part3Totals,
  phtToZoneTime,
  time12,
  timeZoneLabel,
  zoneOnDate,
  subTicketCode,
  ticketCode,
  type Part3Answers,
} from '@/lib/onboarding-fields'
import { cn } from '@/lib/utils'
import type { getCustomer } from '@/lib/customers'

type Account = NonNullable<Awaited<ReturnType<typeof getCustomer>>>['accounts'][number]
type Request = Account['tickets'][number]['requests'][number]

function Rows({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
    </dl>
  )
}

const hours = (v: unknown) => (v == null ? null : Number(v))

function schedule(r: Request, timeZone: string | null) {
  if (r.scheduleType === 'WEEKLY_FLEXIBLE') return `${hours(r.hoursPerWeek)} h a week, any time`
  if (r.scheduleType === 'MONTHLY') return `${hours(r.hoursPerMonth)} h a month, any time`
  if (r.scheduleType === 'PROJECT') return `${hours(r.projectHours)} h in total`
  const days = r.workDays.join(', ')
  if (r.scheduleType === 'DAILY_FLEXIBLE') return `${hours(r.hoursPerDay)} h a day, any time · ${days}`
  const pht = `${time12(r.startTimePht ?? '')}–${time12(r.endTimePht ?? '')} PH time (${hours(r.hoursPerDay)} h)`
  // The customer entered it in their own zone; show that too.
  const start = r.targetStartDate.toISOString().slice(0, 10)
  const local =
    timeZone && timeZone !== 'Asia/Manila'
      ? ` = ${time12(phtToZoneTime(r.startTimePht ?? '', timeZone, start))}–${time12(phtToZoneTime(r.endTimePht ?? '', timeZone, start))} ${zoneOnDate(timeZone, start)}`
      : ''
  return `${pht}${local} · ${days}`
}

// Part 3 of the onboarding form: the answers, or the link to finish it.
function Personality({ submission }: { submission: NonNullable<Account['submission']> }) {
  if (!submission.part3SubmittedAt) {
    const open = !submission.link.revokedAt
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">Not filled in yet. The customer chose to complete it later{open ? ' on the same onboarding link:' : '.'}</p>
        {open && (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={onboardingUrl(submission.link.token)}
              aria-label="Onboarding link for Part 3"
              className="h-8 min-w-0 flex-1 rounded-lg border bg-muted/40 px-2.5 font-mono text-xs"
            />
            <CopyButton text={onboardingUrl(submission.link.token)} label="Copy link" />
          </div>
        )}
      </div>
    )
  }
  const answers = (submission.part3 ?? {}) as Part3Answers
  const totals = part3Totals(answers)
  const top = Math.max(...totals.map((t) => t.total))
  const max = PART3_SCENARIOS.length * 5
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Filled in {submission.part3SubmittedAt.toLocaleString('en-PH', manilaDateTime)}</p>
      <div>
        <p className="mb-1.5 text-sm">Totals across the ten scenarios, out of {max}. Each scenario’s four statements follow the DISC styles, in order D, I, S, C.</p>
        <ul className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {totals.map((t) => (
            <li key={t.style} className={cn('rounded-lg border px-3 py-2', t.total === top && 'border-primary bg-primary/5')}>
              <p className="text-xs text-muted-foreground">
                {t.style} · {PART3_STYLE_LABELS[t.style]}
              </p>
              <p className="text-lg font-semibold tabular-nums">{t.total}</p>
            </li>
          ))}
        </ul>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">All ratings (1 least preferred, 5 most preferred)</summary>
        <ol className="mt-2 space-y-3">
          {PART3_SCENARIOS.map((sc, n) => (
            <li key={sc.id}>
              <p className="font-medium">
                {n + 1}. {sc.prompt}
              </p>
              <ul className="mt-1 space-y-0.5">
                {sc.statements.map((statement, i) => (
                  <li key={statement} className="flex justify-between gap-3 text-muted-foreground">
                    <span>
                      <span className="font-mono text-xs">{PART3_STYLES[i]}</span> {statement}
                    </span>
                    <span className="font-medium tabular-nums text-foreground">{answers[sc.id]?.[i] ?? '–'}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}

// The customer's accounts (Part 1 of the form), their tickets (Part 2) and
// the VA personality preference (Part 3).
export function AccountsView({ accounts, canSetGroup }: { accounts: Account[]; canSetGroup: boolean }) {
  return (
    <div className="space-y-6">
      {accounts.map((a) => {
        const primary = a.contacts.find((c) => c.kind === 'PRIMARY')
        const sent = a.submission?.submittedAt
        return (
          <article key={a.id} className="space-y-5 rounded-xl border bg-card p-5">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-mono text-xs text-muted-foreground">{a.accountCode}</p>
                <h3 className="font-semibold">{a.name}</h3>
              </div>
              {sent && <p className="text-xs text-muted-foreground">From the onboarding form, {sent.toLocaleString('en-PH', manilaDateTime)}</p>}
            </header>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company and billing</h4>
                <Rows
                  items={[
                    ['Company', a.companyName],
                    ['DBA name', a.dbaName],
                    ['Business address', a.businessAddress ? <span key="addr" className="whitespace-pre-wrap">{a.businessAddress}</span> : null],
                    ['Website', a.website],
                    ['Time zone', a.timeZone ? timeZoneLabel(a.timeZone) : null],
                    ['Lives in', primary?.region],
                    ['Platforms', (a.platforms ?? []).map((p) => (p === 'Other' && a.platformOther ? `Other: ${a.platformOther}` : p)).join(', ')],
                    ['Invoices to', `${a.invoiceContactName ?? ''}${a.invoiceContactRole ? `, ${a.invoiceContactRole}` : ''} (${a.invoiceContactEmail})`],
                    [
                      'Pays by',
                      `${a.paymentMethod === 'OTHER' && a.paymentMethodOther ? `Other: ${a.paymentMethodOther}` : PAYMENT_LABELS[a.paymentMethod]}${a.billingCountry ? ` from ${a.billingCountry}` : ''}`,
                    ],
                    ['Payoneer or Wise', a.hasPayoneerOrWise == null ? null : a.hasPayoneerOrWise ? 'Has an active account' : 'No active account'],
                    ['Other information', a.otherInfo ? <span key="info" className="whitespace-pre-wrap">{a.otherInfo}</span> : null],
                  ]}
                />
              </div>
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacts</h4>
                {a.contacts.map((c) => (
                  <div key={c.id} className="text-sm">
                    <p className="flex items-center gap-1.5 font-medium">
                      {c.firstName} {c.lastName}
                      {c.isFocal && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
                          <Star className="h-3 w-3" /> Main contact
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground">
                      {c.kind === 'PRIMARY' ? 'Primary' : 'Secondary'}
                      {c.role && ` · ${c.role}`}
                    </p>
                    <p className="text-muted-foreground">{[c.email, c.whatsapp].filter(Boolean).join(' · ')}</p>
                  </div>
                ))}
              </div>
            </div>

            {a.tickets.map((t) => (
              <div key={t.id} className="space-y-2">
                <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                  <span className="font-mono">{ticketCode(t.ticketNumber)}</span>
                  <span className="font-normal text-muted-foreground">
                    {t.requests.length} VA {t.requests.length === 1 ? 'request' : 'requests'} · opened {t.createdAt.toLocaleDateString('en-PH', manilaDate)}
                  </span>
                </h4>
                <ul className="space-y-2">
                  {t.requests.map((r) => (
                    <li key={r.id} className="rounded-lg border p-3">
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-mono text-xs text-muted-foreground">{subTicketCode(t.ticketNumber, r.lineNo)}</p>
                          <p className="text-sm font-medium">
                            {r.numberOfVas > 1 && `${r.numberOfVas} × `}
                            {r.service}
                            {r.platform && ` on ${r.platform}`}
                          </p>
                        </div>
                        {canSetGroup ? (
                          <RequestGroupSelect requestId={r.id} value={r.requestGroup} />
                        ) : (
                          <span className="rounded-full border px-2 text-xs">{REQUEST_GROUP_LABELS[r.requestGroup]}</span>
                        )}
                      </div>
                      <Rows
                        items={[
                          ['Schedule', `${SCHEDULE_LABELS[r.scheduleType]}: ${schedule(r, a.timeZone)}`],
                          [
                            'Night differential',
                            r.nightDifferential ? (
                              <span className="inline-flex items-center gap-1 text-warning">
                                <Moon className="h-3 w-3" /> Applies (works between 10 PM and 6 AM PH time)
                              </span>
                            ) : null,
                          ],
                          ['Additional hours', r.additionalHours ?? (r.additionalHoursPerDay != null ? `${hours(r.additionalHoursPerDay)} h a day` : null)],
                          ['Target start', r.targetStartDate.toLocaleDateString('en-PH', { ...manilaDate, timeZone: 'UTC' })],
                          ['Tasks', r.tasks ? <span key="t" className="whitespace-pre-wrap">{r.tasks}</span> : null],
                          ['Tools', r.tools],
                          ['Task tracker', r.taskTracker == null ? null : r.taskTracker ? 'Yes' : 'No'],
                          ['Group set by', r.requestGroupSetBy],
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {a.submission && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VA personality preference</h4>
                <Personality submission={a.submission} />
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
