'use client'

import { useState, useTransition } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, Moon, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { submitOnboarding } from '@/app/onboarding/[token]/actions'
import {
  PAYMENT_LABELS,
  PLATFORMS,
  REGIONS,
  SCHEDULE_HINTS,
  SCHEDULE_LABELS,
  SCHEDULE_TYPES,
  TIME_ZONES,
  TIME_ZONE_LABELS,
  WORK_DAYS,
  emptyPart1,
  emptyVaRequest,
  firstIssue,
  nightDifferentialHours,
  paymentMethodsFor,
  part1Schema,
  part2Schema,
  shiftHours,
  type OnboardingInput,
  type Part1Draft,
  type VaRequestDraft,
} from '@/lib/onboarding-fields'
import { cn } from '@/lib/utils'

const STEPS = ['Your profile', 'VA request', 'Review'] as const
const TIME_RE = /^\d{2}:\d{2}$/

function Field({ id, label, required, hint, className, children }: { id: string; label: string; required?: boolean; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label} {required ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Choice<T extends string>({ name, legend, value, options, onChange }: { name: string; legend: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="accent-primary" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

const num = (v: string) => (v === '' ? null : Number(v))
const numValue = (v: number | null) => (v == null || Number.isNaN(v) ? '' : v)

function scheduleSummary(r: VaRequestDraft) {
  if (r.scheduleType === 'WEEKLY_FLEXIBLE') return `${r.hoursPerWeek} hours a week, flexible`
  const days = r.workDays.join(', ')
  if (r.scheduleType === 'DAILY_FLEXIBLE') return `${r.hoursPerDay} hours a day, flexible (${days})`
  if (r.scheduleType === 'DAILY_FIXED') return `${r.startTimePht}–${r.endTimePht} PH time (${days})`
  return ''
}

export function OnboardingForm({
  token,
  customerName,
  customerCode,
  prefillEmail,
  services,
}: {
  token: string
  customerName: string
  customerCode: string
  prefillEmail: string | null
  services: string[]
}) {
  const [step, setStep] = useState(0)
  const [p1, setP1] = useState<Part1Draft>(() => emptyPart1(prefillEmail))
  const [requests, setRequests] = useState<VaRequestDraft[]>(() => [emptyVaRequest()])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [saving, start] = useTransition()

  const setPrimary = (patch: Partial<Part1Draft['primary']>) =>
    setP1((v) => {
      const primary = { ...v.primary, ...patch }
      // Changing region can rule out the chosen payment method (NIS is Israel only).
      const method = v.payment.method && !paymentMethodsFor(primary.region).includes(v.payment.method) ? '' : v.payment.method
      return { ...v, primary, payment: { ...v.payment, method } }
    })
  const setCompany = (patch: Partial<Part1Draft['company']>) => setP1((v) => ({ ...v, company: { ...v.company, ...patch } }))
  const setSecondary = (patch: Partial<Part1Draft['secondary']>) => setP1((v) => ({ ...v, secondary: { ...v.secondary, ...patch } }))
  const setInvoice = (patch: Partial<Part1Draft['invoice']>) => setP1((v) => ({ ...v, invoice: { ...v.invoice, ...patch } }))
  const setPayment = (patch: Partial<Part1Draft['payment']>) => setP1((v) => ({ ...v, payment: { ...v.payment, ...patch } }))
  const setHasSecondary = (hasSecondary: boolean) =>
    setP1((v) => ({
      ...v,
      hasSecondary,
      // Without a secondary contact, they can't be the focal person or the invoice contact.
      focalContact: hasSecondary ? v.focalContact : 'PRIMARY',
      invoice: hasSecondary || v.invoice.source !== 'SECONDARY' ? v.invoice : { ...v.invoice, source: 'PRIMARY' },
    }))
  const setRequest = (i: number, patch: Partial<VaRequestDraft>) => setRequests((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const toggleDay = (i: number, day: (typeof WORK_DAYS)[number]) =>
    setRequests((rs) =>
      rs.map((r, j) =>
        j === i ? { ...r, workDays: r.workDays.includes(day) ? r.workDays.filter((d) => d !== day) : WORK_DAYS.filter((d) => d === day || r.workDays.includes(d)) } : r
      )
    )

  const go = (next: number) => {
    setError(null)
    setStep(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const nextFromPart1 = () => {
    const parsed = part1Schema.safeParse(p1)
    if (!parsed.success) return setError(firstIssue(parsed.error))
    go(1)
  }
  const nextFromPart2 = () => {
    const parsed = part2Schema.safeParse({ requests })
    if (!parsed.success) return setError(firstIssue(parsed.error, 'VA request'))
    go(2)
  }
  const submit = () =>
    start(async () => {
      const result = await submitOnboarding(token, { part1: p1, part2: { requests } } as OnboardingInput)
      if (!result.ok) return setError(result.error)
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
          <Check className="h-5 w-5" />
        </span>
        <h1 className="text-lg font-semibold">Thank you, {p1.primary.firstName}!</h1>
        <p className="mt-2 text-sm text-muted-foreground">We’ve received your onboarding details. Our team will contact you about the next steps.</p>
      </div>
    )
  }

  const invoiceOptions = [
    { value: 'PRIMARY' as const, label: 'Same as primary contact' },
    ...(p1.hasSecondary ? [{ value: 'SECONDARY' as const, label: 'Same as secondary contact' }] : []),
    { value: 'OTHER' as const, label: 'Someone else' },
  ]
  const methods = paymentMethodsFor(p1.primary.region)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ fontFamily: 'var(--font-montserrat)' }}>
          Welcome, {customerName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customer ID <span className="font-mono">{customerCode}</span>. This takes about 10 minutes. Fields marked * are required.
        </p>
      </div>

      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-5 bg-border sm:w-8" />}
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold',
                i < step && 'border-primary bg-primary text-primary-foreground',
                i === step && 'border-primary text-primary',
                i > step && 'text-muted-foreground'
              )}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={i === step ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <Section title="Primary contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="p-first" label="First name" required>
                <Input id="p-first" value={p1.primary.firstName} onChange={(e) => setPrimary({ firstName: e.target.value })} autoComplete="given-name" />
              </Field>
              <Field id="p-last" label="Last name" required>
                <Input id="p-last" value={p1.primary.lastName} onChange={(e) => setPrimary({ lastName: e.target.value })} autoComplete="family-name" />
              </Field>
              <Field id="p-role" label="Role" required>
                <Input id="p-role" value={p1.primary.role} onChange={(e) => setPrimary({ role: e.target.value })} placeholder="e.g. Owner, Operations Manager" autoComplete="organization-title" />
              </Field>
              <Field id="p-email" label="Email" required>
                <Input id="p-email" type="email" value={p1.primary.email} onChange={(e) => setPrimary({ email: e.target.value })} autoComplete="email" />
              </Field>
              <Field id="p-wa" label="WhatsApp number" required hint="Include the country code.">
                <Input id="p-wa" type="tel" value={p1.primary.whatsapp} onChange={(e) => setPrimary({ whatsapp: e.target.value })} placeholder="+1 555 123 4567" autoComplete="tel" />
              </Field>
              <Field id="p-region" label="Where do you live?" required>
                <NativeSelect id="p-region" value={p1.primary.region} onChange={(e) => setPrimary({ region: e.target.value as Part1Draft['primary']['region'] })}>
                  <option value="">Choose a region</option>
                  {REGIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </Section>

          <Section title="Company">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="c-name" label="Company name" required>
                <Input id="c-name" value={p1.company.companyName} onChange={(e) => setCompany({ companyName: e.target.value })} autoComplete="organization" />
              </Field>
              <Field id="c-dba" label="Name on invoices (DBA)" hint="Your “doing business as” name. Leave blank to use the company name.">
                <Input id="c-dba" value={p1.company.dbaName} onChange={(e) => setCompany({ dbaName: e.target.value })} />
              </Field>
              <Field id="c-web" label="Website or store link">
                <Input id="c-web" value={p1.company.website} onChange={(e) => setCompany({ website: e.target.value })} placeholder="https://" />
              </Field>
              <Field id="c-tz" label="Your time zone">
                <NativeSelect id="c-tz" value={p1.company.timeZone} onChange={(e) => setCompany({ timeZone: e.target.value })}>
                  <option value="">Choose a time zone</option>
                  {TIME_ZONES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </Section>

          <Section title="Secondary contact">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={p1.hasSecondary} onChange={(e) => setHasSecondary(e.target.checked)} className="accent-primary" />
              Add a second person we can contact
            </label>
            {p1.hasSecondary && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-first" label="First name" required>
                  <Input id="s-first" value={p1.secondary.firstName} onChange={(e) => setSecondary({ firstName: e.target.value })} />
                </Field>
                <Field id="s-last" label="Last name" required>
                  <Input id="s-last" value={p1.secondary.lastName} onChange={(e) => setSecondary({ lastName: e.target.value })} />
                </Field>
                <Field id="s-role" label="Role">
                  <Input id="s-role" value={p1.secondary.role} onChange={(e) => setSecondary({ role: e.target.value })} />
                </Field>
                <Field id="s-email" label="Email" required>
                  <Input id="s-email" type="email" value={p1.secondary.email} onChange={(e) => setSecondary({ email: e.target.value })} />
                </Field>
                <Field id="s-wa" label="WhatsApp number">
                  <Input id="s-wa" type="tel" value={p1.secondary.whatsapp} onChange={(e) => setSecondary({ whatsapp: e.target.value })} placeholder="+1 555 123 4567" />
                </Field>
              </div>
            )}
            {p1.hasSecondary && (
              <Choice
                name="focal"
                legend="Who is the main person we work with day to day?"
                value={p1.focalContact}
                onChange={(focalContact) => setP1((v) => ({ ...v, focalContact }))}
                options={[
                  { value: 'PRIMARY', label: 'Primary contact' },
                  { value: 'SECONDARY', label: 'Secondary contact' },
                ]}
              />
            )}
          </Section>

          <Section title="Invoices and payment">
            <Choice name="invoice" legend="Who should invoices go to?" value={p1.invoice.source} onChange={(source) => setInvoice({ source })} options={invoiceOptions} />
            {p1.invoice.source === 'OTHER' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="i-name" label="Name" required>
                  <Input id="i-name" value={p1.invoice.name} onChange={(e) => setInvoice({ name: e.target.value })} />
                </Field>
                <Field id="i-email" label="Email" required>
                  <Input id="i-email" type="email" value={p1.invoice.email} onChange={(e) => setInvoice({ email: e.target.value })} />
                </Field>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="pay-method" label="How will you pay?" required hint={p1.primary.region ? undefined : 'Choose where you live first to see every option.'}>
                <NativeSelect id="pay-method" value={p1.payment.method} onChange={(e) => setPayment({ method: e.target.value as Part1Draft['payment']['method'] })}>
                  <option value="">Choose a payment method</option>
                  {methods.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="pay-country" label="Country you pay from">
                <Input id="pay-country" value={p1.payment.billingCountry} onChange={(e) => setPayment({ billingCountry: e.target.value })} autoComplete="country-name" />
              </Field>
            </div>
          </Section>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tell us about the VA you need. Add another request for a different platform, service or schedule. All working times are in{' '}
            <strong>Philippine time (UTC+8)</strong>.
          </p>
          {requests.map((r, i) => {
            const fixedTimes = r.scheduleType === 'DAILY_FIXED' && TIME_RE.test(r.startTimePht) && TIME_RE.test(r.endTimePht)
            const nightHours = fixedTimes ? nightDifferentialHours(r.startTimePht, r.endTimePht) : 0
            return (
              <section key={i} className="space-y-4 rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">VA request {i + 1}</h2>
                  {requests.length > 1 && (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRequests((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove VA request ${i + 1}`}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`r${i}-platform`} label="Platform" required>
                    <NativeSelect id={`r${i}-platform`} value={r.platform} onChange={(e) => setRequest(i, { platform: e.target.value as VaRequestDraft['platform'] })}>
                      <option value="">Choose a platform</option>
                      {PLATFORMS.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id={`r${i}-service`} label="Service" required>
                    <NativeSelect id={`r${i}-service`} value={r.service} onChange={(e) => setRequest(i, { service: e.target.value })}>
                      <option value="">Choose a service</option>
                      {services.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id={`r${i}-count`} label="Number of VAs" required>
                    <Input id={`r${i}-count`} type="number" min={1} max={50} value={numValue(r.numberOfVas)} onChange={(e) => setRequest(i, { numberOfVas: num(e.target.value) ?? Number.NaN })} />
                  </Field>
                  <Field id={`r${i}-date`} label="Target start date" required>
                    <Input id={`r${i}-date`} type="date" value={r.targetStartDate} onChange={(e) => setRequest(i, { targetStartDate: e.target.value })} />
                  </Field>
                  <Field id={`r${i}-schedule`} label="Schedule" required hint={r.scheduleType ? SCHEDULE_HINTS[r.scheduleType] : undefined} className="sm:col-span-2">
                    <NativeSelect id={`r${i}-schedule`} value={r.scheduleType} onChange={(e) => setRequest(i, { scheduleType: e.target.value as VaRequestDraft['scheduleType'] })}>
                      <option value="">Choose a schedule</option>
                      {SCHEDULE_TYPES.map((s) => (
                        <option key={s} value={s}>
                          {SCHEDULE_LABELS[s]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>

                  {r.scheduleType === 'WEEKLY_FLEXIBLE' && (
                    <Field id={`r${i}-hpw`} label="Hours per week" required>
                      <Input id={`r${i}-hpw`} type="number" min={1} max={60} value={numValue(r.hoursPerWeek)} onChange={(e) => setRequest(i, { hoursPerWeek: num(e.target.value) })} placeholder="e.g. 40" />
                    </Field>
                  )}
                  {r.scheduleType === 'DAILY_FLEXIBLE' && (
                    <Field id={`r${i}-hpd`} label="Hours per day" required>
                      <Input id={`r${i}-hpd`} type="number" min={1} max={12} step={0.5} value={numValue(r.hoursPerDay)} onChange={(e) => setRequest(i, { hoursPerDay: num(e.target.value) })} placeholder="e.g. 8" />
                    </Field>
                  )}
                  {r.scheduleType === 'DAILY_FIXED' && (
                    <div className="space-y-2 sm:col-span-2">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field id={`r${i}-start`} label="Start time (Philippine time)" required>
                          <Input id={`r${i}-start`} type="time" value={r.startTimePht} onChange={(e) => setRequest(i, { startTimePht: e.target.value })} />
                        </Field>
                        <Field id={`r${i}-end`} label="End time (Philippine time)" required>
                          <Input id={`r${i}-end`} type="time" value={r.endTimePht} onChange={(e) => setRequest(i, { endTimePht: e.target.value })} />
                        </Field>
                      </div>
                      {fixedTimes && (
                        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{shiftHours(r.startTimePht, r.endTimePht)} hours a day.</span>
                          {nightHours > 0 && (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <Moon className="h-3 w-3" /> {nightHours} of these hours fall between 10 PM and 6 AM Philippine time, so a night differential rate applies.
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {(r.scheduleType === 'DAILY_FLEXIBLE' || r.scheduleType === 'DAILY_FIXED') && (
                    <fieldset className="space-y-1.5 sm:col-span-2">
                      <legend className="text-sm font-medium">
                        Work days <span className="text-destructive">*</span>
                      </legend>
                      <div className="flex flex-wrap gap-1.5">
                        {WORK_DAYS.map((d) => {
                          const on = r.workDays.includes(d)
                          return (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggleDay(i, d)}
                              className={cn('h-8 min-w-11 rounded-lg border px-2 text-sm', on ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                            >
                              {d}
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>
                  )}
                  {r.scheduleType && r.scheduleType !== 'WEEKLY_FLEXIBLE' && (
                    <Field id={`r${i}-extra`} label="Additional hours per day" hint="Extra hours on top of the schedule, if needed.">
                      <Input id={`r${i}-extra`} type="number" min={0} max={8} step={0.5} value={numValue(r.additionalHoursPerDay)} onChange={(e) => setRequest(i, { additionalHoursPerDay: num(e.target.value) })} />
                    </Field>
                  )}

                  <Field id={`r${i}-tasks`} label="First tasks for the VA" required className="sm:col-span-2">
                    <Textarea id={`r${i}-tasks`} value={r.tasks} onChange={(e) => setRequest(i, { tasks: e.target.value })} placeholder="What should the VA start working on?" />
                  </Field>
                  <Field id={`r${i}-tools`} label="Tools the VA will use" className="sm:col-span-2">
                    <Input id={`r${i}-tools`} value={r.tools} onChange={(e) => setRequest(i, { tools: e.target.value })} placeholder="e.g. Seller Central, Helium 10, Google Sheets" />
                  </Field>
                </div>
              </section>
            )
          })}
          <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setRequests((rs) => [...rs, emptyVaRequest()])}>
            <Plus /> Add another VA request
          </Button>
        </div>
      )}

      {step === 2 && (
        <Section title="Check your details">
          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Primary contact</dt>
            <dd>
              {p1.primary.firstName} {p1.primary.lastName} ({p1.primary.role}) · {p1.primary.email} · {p1.primary.whatsapp} · {p1.primary.region}
            </dd>
            {p1.hasSecondary && (
              <>
                <dt className="text-muted-foreground">Secondary contact</dt>
                <dd>
                  {p1.secondary.firstName} {p1.secondary.lastName}
                  {p1.secondary.role && ` (${p1.secondary.role})`} · {p1.secondary.email}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Main contact</dt>
            <dd>{p1.focalContact === 'PRIMARY' ? 'Primary contact' : 'Secondary contact'}</dd>
            <dt className="text-muted-foreground">Company</dt>
            <dd>
              {p1.company.companyName}
              {p1.company.dbaName && ` (invoices as ${p1.company.dbaName})`}
              {p1.company.timeZone && ` · ${TIME_ZONE_LABELS[p1.company.timeZone] ?? p1.company.timeZone}`}
            </dd>
            <dt className="text-muted-foreground">Invoices to</dt>
            <dd>
              {p1.invoice.source === 'PRIMARY'
                ? `${p1.primary.firstName} ${p1.primary.lastName} (${p1.primary.email})`
                : p1.invoice.source === 'SECONDARY'
                  ? `${p1.secondary.firstName} ${p1.secondary.lastName} (${p1.secondary.email})`
                  : `${p1.invoice.name} (${p1.invoice.email})`}
            </dd>
            <dt className="text-muted-foreground">Payment</dt>
            <dd>
              {p1.payment.method && PAYMENT_LABELS[p1.payment.method]}
              {p1.payment.billingCountry && ` from ${p1.payment.billingCountry}`}
            </dd>
          </dl>
          <ul className="space-y-1 text-sm">
            {requests.map((r, i) => (
              <li key={i} className="rounded-lg border px-3 py-2">
                {r.numberOfVas} × {r.service} VA on {r.platform}: {scheduleSummary(r)}, starting {r.targetStartDate}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        {step > 0 ? (
          <Button variant="outline" size="lg" onClick={() => go(step - 1)} disabled={saving}>
            <ArrowLeft /> Back
          </Button>
        ) : (
          <span />
        )}
        {step === 0 && (
          <Button size="lg" onClick={nextFromPart1}>
            Next: VA request <ArrowRight />
          </Button>
        )}
        {step === 1 && (
          <Button size="lg" onClick={nextFromPart2}>
            Next: review <ArrowRight />
          </Button>
        )}
        {step === 2 && (
          <Button size="lg" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />} Submit
          </Button>
        )}
      </div>
    </div>
  )
}
