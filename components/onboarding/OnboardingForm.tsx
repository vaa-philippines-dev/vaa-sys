'use client'

import { useState, useTransition } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, Moon, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { submitOnboarding, submitPart3 } from '@/app/onboarding/[token]/actions'
import {
  MAX_HOURS_PER_DAY,
  MAX_HOURS_PER_WEEK,
  MIN_HOURS_PER_DAY,
  MIN_HOURS_PER_WEEK,
  PART3_MAX,
  PART3_MIN,
  PART3_SCENARIOS,
  PAYMENT_LABELS,
  PLATFORMS,
  REGIONS,
  SCHEDULE_HINTS,
  SCHEDULE_LABELS,
  SCHEDULE_TYPES,
  SERVICE_OFFERINGS,
  TIME_ZONES,
  TIME_ZONE_LABELS,
  WORK_DAYS,
  emptyPart1,
  emptyPart3,
  emptyVaRequest,
  firstIssue,
  nightDifferentialHours,
  part3AnswersSchema,
  part1Schema,
  part2Schema,
  paymentMethodsFor,
  phtShiftInZone,
  shiftHours,
  type OnboardingInput,
  type Part1Draft,
  type Part3Answers,
  type Platform,
  type VaRequestDraft,
} from '@/lib/onboarding-fields'
import { cn } from '@/lib/utils'

const STEPS = ['Customer profile', 'Skill requirements', 'VA personality', 'Review'] as const
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

function Choice<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  required,
  stacked,
}: {
  name: string
  legend: string
  value: T | null
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  required?: boolean
  stacked?: boolean
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {legend} {required && <span className="text-destructive">*</span>}
      </legend>
      <div className={cn('text-sm', stacked ? 'space-y-2' : 'flex flex-wrap gap-x-5 gap-y-2')}>
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

function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <div className="mt-0.5 space-y-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {children}
    </section>
  )
}

const num = (v: string) => (v === '' ? null : Number(v))
const numValue = (v: number | null) => (v == null || Number.isNaN(v) ? '' : v)
const toggle = <T,>(list: T[], item: T, order: readonly T[]) => (list.includes(item) ? list.filter((x) => x !== item) : order.filter((x) => x === item || list.includes(x)))

function scheduleSummary(r: VaRequestDraft) {
  const days = r.workDays.join(', ')
  if (r.scheduleType === 'WEEKLY_FLEXIBLE') return `${r.hoursPerWeek} hours a week, flexible`
  if (r.scheduleType === 'DAILY_FLEXIBLE') return `${r.hoursPerDay} hours a day, flexible (${days})`
  if (r.scheduleType === 'DAILY_FIXED') return `${r.startTimePht}–${r.endTimePht} PH time (${days})`
  if (r.scheduleType === 'PROJECT') return `${r.projectHours} project hours`
  return ''
}

const RATINGS = Array.from({ length: PART3_MAX - PART3_MIN + 1 }, (_, i) => PART3_MIN + i)

// The Part 3 scenarios, shared by the full form and the Part-3-only form:
// each statement rated 1 (least preferred) to 5 (most preferred).
function Part3Ratings({ answers, onChange }: { answers: Part3Answers; onChange: (scenarioId: string, index: number, rating: number) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        For each scenario, rate the responses from <strong className="font-medium text-foreground">Most Preferred ({PART3_MAX})</strong> to{' '}
        <strong className="font-medium text-foreground">Least Preferred ({PART3_MIN})</strong> based on how you’d ideally like your VA to respond or behave. Please answer honestly, based on
        what you believe would work best for your personal or business needs. Every statement needs a rating.
      </p>
      {PART3_SCENARIOS.map((sc, n) => (
        <fieldset key={sc.id} className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">
            {n + 1}. {sc.prompt} <span className="text-destructive">*</span>
          </legend>
          {sc.statements.map((statement, i) => {
            const value = answers[sc.id]?.[i] ?? null
            return (
              <div key={statement} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <p className="text-sm">{statement}</p>
                <div role="radiogroup" aria-label={statement} className="flex shrink-0 gap-1">
                  {RATINGS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={value === r}
                      aria-label={`${r}${r === PART3_MIN ? ', least preferred' : r === PART3_MAX ? ', most preferred' : ''}`}
                      onClick={() => onChange(sc.id, i, r)}
                      className={cn(
                        'h-8 w-9 rounded-lg border text-sm',
                        value === r ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          <p className="flex justify-end gap-1 text-[11px] text-muted-foreground sm:pr-0">
            {PART3_MIN} = least preferred · {PART3_MAX} = most preferred
          </p>
        </fieldset>
      ))}
    </div>
  )
}

const PART3_INTRO = (
  <>
    <p>
      This section is an important part of selecting the right Virtual Assistant for you. While you may skip it for now, you’ll still be asked to complete it later as we move forward in the
      process. It only takes a few minutes and is highly recommended for the most accurate VA match.
    </p>
    <p>
      You’ll share your preferences on work style, communication and personality traits. This helps us match you with a VA who not only has the right skills but also aligns with your
      preferred way of working.
    </p>
  </>
)

function setRating(answers: Part3Answers, scenarioId: string, index: number, rating: number): Part3Answers {
  const row = [...(answers[scenarioId] ?? [])]
  row[index] = rating
  return { ...answers, [scenarioId]: row }
}

function Thanks({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
      <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
        <Check className="h-5 w-5" />
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  )
}

export function OnboardingForm({
  token,
  customerName,
  customerCode,
  prefillEmail,
  part3Only,
}: {
  token: string
  customerName: string
  customerCode: string
  prefillEmail: string | null
  // The form is in and only Part 3 is left. The page re-renders with this
  // set right after a submission that skipped Part 3, so the thank-you
  // screen below stays up instead of jumping straight to Part 3.
  part3Only?: boolean
}) {
  const [step, setStep] = useState(0)
  const [p1, setP1] = useState<Part1Draft>(() => emptyPart1(prefillEmail))
  const [requests, setRequests] = useState<VaRequestDraft[]>(() => [emptyVaRequest()])
  const [part3Now, setPart3Now] = useState<'YES' | 'NO' | null>(null)
  const [answers, setAnswers] = useState<Part3Answers>(emptyPart3)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [showPart3, setShowPart3] = useState(false)
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
  const setBusiness = (patch: Partial<Part1Draft['business']>) => setP1((v) => ({ ...v, business: { ...v.business, ...patch } }))
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
  // A secondary focal person means there is a secondary contact to fill in.
  const setFocal = (focalContact: Part1Draft['focalContact']) => setP1((v) => ({ ...v, focalContact, hasSecondary: v.hasSecondary || focalContact === 'SECONDARY' }))
  const setRequest = (i: number, patch: Partial<VaRequestDraft>) => setRequests((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const toggleDay = (i: number, day: (typeof WORK_DAYS)[number]) => setRequests((rs) => rs.map((r, j) => (j === i ? { ...r, workDays: toggle(r.workDays, day, WORK_DAYS) } : r)))
  const setAnswer = (scenarioId: string, index: number, rating: number) => setAnswers((a) => setRating(a, scenarioId, index, rating))

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
    if (!parsed.success) return setError(firstIssue(parsed.error, 'VA service'))
    go(2)
  }
  const nextFromPart3 = () => {
    if (!part3Now) return setError('Choose whether you’d like to complete this section now.')
    if (part3Now === 'YES') {
      const parsed = part3AnswersSchema.safeParse(answers)
      if (!parsed.success) return setError(firstIssue(parsed.error))
    }
    go(3)
  }
  const submit = () =>
    start(async () => {
      const part3 = part3Now === 'YES' ? { completeNow: true as const, answers } : { completeNow: false as const }
      const result = await submitOnboarding(token, { part1: p1, part2: { requests }, part3 } as OnboardingInput)
      if (!result.ok) return setError(result.error)
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })

  if (showPart3 || (part3Only && !done)) return <Part3Form token={token} customerName={customerName} returning={!done} />

  if (done) {
    return (
      <Thanks title={`Thank you, ${p1.primary.firstName}!`}>
        <p>Parts 1 and 2 have been successfully recorded and will be used in preparing your contract. Our team will contact you about the next steps.</p>
        {part3Now === 'NO' && (
          <>
            <p>You can complete Part 3, the VA personality preference, any time by opening the same link again, or we’ll let you know when it’s time to fill it out.</p>
            <Button variant="outline" onClick={() => setShowPart3(true)}>
              Complete it now <ArrowRight />
            </Button>
          </>
        )}
      </Thanks>
    )
  }

  const invoiceOptions = [
    { value: 'PRIMARY' as const, label: 'Same as primary contact' },
    ...(p1.hasSecondary ? [{ value: 'SECONDARY' as const, label: 'Same as secondary contact' }] : []),
    { value: 'OTHER' as const, label: 'Someone else' },
  ]
  const israel = p1.primary.region === 'Israel'
  const methods = paymentMethodsFor(p1.primary.region)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ fontFamily: 'var(--font-montserrat)' }}>
          Welcome, {customerName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customer ID <span className="font-mono">{customerCode}</span>. This form helps us prepare your contract and match you with the right Virtual Assistant. Parts 1 and 2 are
          essential for your contract and setup. Part 3 is optional for now, but we strongly recommend it. Fields marked * are required.
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
          <p className="text-sm text-muted-foreground">
            Please complete this part with accurate and complete information. The details you provide will be used to prepare your contract, so kindly review your entries carefully.
          </p>
          <Section title="Primary contact" description="The main account holder who will sign the contract.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="p-first" label="First name" required>
                <Input id="p-first" value={p1.primary.firstName} onChange={(e) => setPrimary({ firstName: e.target.value })} autoComplete="given-name" />
              </Field>
              <Field id="p-last" label="Last name" required>
                <Input id="p-last" value={p1.primary.lastName} onChange={(e) => setPrimary({ lastName: e.target.value })} autoComplete="family-name" />
              </Field>
              <Field id="p-role" label="Role" required>
                <Input id="p-role" value={p1.primary.role} onChange={(e) => setPrimary({ role: e.target.value })} placeholder="e.g. Owner, CEO" autoComplete="organization-title" />
              </Field>
              <Field id="p-email" label="Email" required>
                <Input id="p-email" type="email" value={p1.primary.email} onChange={(e) => setPrimary({ email: e.target.value })} autoComplete="email" />
              </Field>
              <Field id="p-wa" label="WhatsApp number" required hint="Include the country code.">
                <Input id="p-wa" type="tel" value={p1.primary.whatsapp} onChange={(e) => setPrimary({ whatsapp: e.target.value })} placeholder="+1 555 123 4567" autoComplete="tel" />
              </Field>
              <Field id="p-region" label="Region of residence" required>
                <NativeSelect id="p-region" value={p1.primary.region} onChange={(e) => setPrimary({ region: e.target.value as Part1Draft['primary']['region'] })}>
                  <option value="">Choose a region</option>
                  {REGIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Choice
              name="focal"
              legend="Is the primary contact the focal person for this account?"
              required
              value={p1.focalContact}
              onChange={setFocal}
              options={[
                { value: 'PRIMARY', label: 'Yes' },
                { value: 'SECONDARY', label: 'No, it will be the secondary contact person' },
              ]}
            />
          </Section>

          <Section title="Company">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="c-name" label="Company name" required>
                <Input id="c-name" value={p1.company.companyName} onChange={(e) => setCompany({ companyName: e.target.value })} autoComplete="organization" />
              </Field>
              <Field id="c-dba" label="DBA name" hint="Your “doing business as” name, also called a trade name or assumed name.">
                <Input id="c-dba" value={p1.company.dbaName} onChange={(e) => setCompany({ dbaName: e.target.value })} />
              </Field>
              <Field id="c-address" label="Company business address" required hint="Unit, Bldg, Street, City, State, Country, Zip Code" className="sm:col-span-2">
                <Textarea id="c-address" rows={2} value={p1.company.businessAddress} onChange={(e) => setCompany({ businessAddress: e.target.value })} autoComplete="street-address" />
              </Field>
              <Field id="c-web" label="Website URL" hint="If applicable.">
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

          <Section title="Secondary contact" description="The person we will be directly communicating with. If the primary and secondary contact are the same, leave this out.">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={p1.hasSecondary} onChange={(e) => setHasSecondary(e.target.checked)} className="accent-primary" />
              Add a secondary contact
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
          </Section>

          <Section title="Your business">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Which platforms will the VA work on? <span className="text-destructive">*</span>
              </legend>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                {PLATFORMS.map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={p1.business.platforms.includes(p)}
                      onChange={() => setBusiness({ platforms: toggle<Platform>(p1.business.platforms, p, PLATFORMS) })}
                      className="accent-primary"
                    />
                    {p}
                  </label>
                ))}
              </div>
              {p1.business.platforms.includes('Other') && (
                <Input aria-label="Other platform" value={p1.business.platformOther} onChange={(e) => setBusiness({ platformOther: e.target.value })} placeholder="Which other platform?" className="sm:max-w-sm" />
              )}
            </fieldset>
            <Field id="b-other" label="Any other information you would like to share?" hint="Are you doing FBA or FBM? Are you a Private Label Seller or Reseller?">
              <Textarea id="b-other" value={p1.business.otherInfo} onChange={(e) => setBusiness({ otherInfo: e.target.value })} />
            </Field>
          </Section>

          <Section title="Invoice contact">
            <Choice name="invoice" legend="Who should invoices go to?" value={p1.invoice.source} onChange={(source) => setInvoice({ source })} options={invoiceOptions} />
            {p1.invoice.source === 'OTHER' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="i-first" label="First name" required>
                  <Input id="i-first" value={p1.invoice.firstName} onChange={(e) => setInvoice({ firstName: e.target.value })} />
                </Field>
                <Field id="i-last" label="Last name">
                  <Input id="i-last" value={p1.invoice.lastName} onChange={(e) => setInvoice({ lastName: e.target.value })} />
                </Field>
                <Field id="i-role" label="Role" required>
                  <Input id="i-role" value={p1.invoice.role} onChange={(e) => setInvoice({ role: e.target.value })} placeholder="e.g. Accountant" />
                </Field>
                <Field id="i-email" label="Email" required>
                  <Input id="i-email" type="email" value={p1.invoice.email} onChange={(e) => setInvoice({ email: e.target.value })} />
                </Field>
              </div>
            )}
          </Section>

          <Section
            title="Payment details"
            description={
              israel ? (
                <p>We can also do bank transfers in NIS currency. Let us know which payment method is convenient for you and we will share the details with you later on.</p>
              ) : (
                <>
                  <p>If you don’t have Payoneer or Wise, you can pay by credit card, with a 3% transaction fee that you will need to pay.</p>
                  <p>We also have ACH and SWIFT transfers; the transaction fee depends on the bank you use. Let us know which payment method is convenient for you and we will share the details with you later on.</p>
                </>
              )
            }
          >
            {!israel && (
              <Choice
                name="payoneer-wise"
                legend="Do you have an active (with funds available) account in Payoneer or Wise?"
                required
                value={p1.payment.hasPayoneerOrWise == null ? null : p1.payment.hasPayoneerOrWise ? 'YES' : 'NO'}
                onChange={(v) => setPayment({ hasPayoneerOrWise: v === 'YES' })}
                options={[
                  { value: 'YES', label: 'Yes' },
                  { value: 'NO', label: 'No' },
                ]}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="pay-method" label="Payment method" required hint={p1.primary.region ? undefined : 'Choose the primary contact’s region of residence first to see every option.'}>
                <NativeSelect id="pay-method" value={p1.payment.method} onChange={(e) => setPayment({ method: e.target.value as Part1Draft['payment']['method'] })}>
                  <option value="">Choose a payment method</option>
                  {methods.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {p1.payment.method === 'OTHER' && (
                <Field id="pay-other" label="Which payment method?" required>
                  <Input id="pay-other" value={p1.payment.methodOther} onChange={(e) => setPayment({ methodOther: e.target.value })} />
                </Field>
              )}
              {p1.payment.method === 'CREDIT_CARD' && (
                <Field id="pay-country" label="Country and state of residence" required hint="We need this to send you a credit card payment request.">
                  <Input id="pay-country" value={p1.payment.billingCountry} onChange={(e) => setPayment({ billingCountry: e.target.value })} placeholder="e.g. United States, Texas" autoComplete="country-name" />
                </Field>
              )}
            </div>
          </Section>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tell us about the services you would like to avail. This guides us in matching you with a Virtual Assistant whose skills best fit your needs. Add a separate VA service for each
            service type. All working times are in <strong>Philippine time (UTC+8)</strong>.
          </p>
          {requests.map((r, i) => {
            const fixedTimes = r.scheduleType === 'DAILY_FIXED' && TIME_RE.test(r.startTimePht) && TIME_RE.test(r.endTimePht)
            const nightHours = fixedTimes ? nightDifferentialHours(r.startTimePht, r.endTimePht) : 0
            const local = fixedTimes ? phtShiftInZone(r.startTimePht, r.endTimePht, p1.company.timeZone) : null
            const daily = r.scheduleType === 'DAILY_FIXED' || r.scheduleType === 'DAILY_FLEXIBLE'
            return (
              <section key={i} className="space-y-4 rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">VA service {i + 1}</h2>
                  {requests.length > 1 && (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRequests((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove VA service ${i + 1}`}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`r${i}-service`} label="Service offering" required>
                    <NativeSelect id={`r${i}-service`} value={r.service} onChange={(e) => setRequest(i, { service: e.target.value as VaRequestDraft['service'] })}>
                      <option value="">Choose a service</option>
                      {SERVICE_OFFERINGS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id={`r${i}-count`} label="Quantity" required hint="Number of VAs for the selected service.">
                    <Input id={`r${i}-count`} type="number" min={1} max={50} value={numValue(r.numberOfVas)} onChange={(e) => setRequest(i, { numberOfVas: num(e.target.value) ?? Number.NaN })} />
                  </Field>
                  <Field
                    id={`r${i}-date`}
                    label="Target start date"
                    required
                    hint="Please allow time to sign the contract, make the payment, and meet our manager and the VA. We recommend starting up to five days after the onboarding meeting."
                    className="sm:col-span-2"
                  >
                    <Input id={`r${i}-date`} type="date" value={r.targetStartDate} onChange={(e) => setRequest(i, { targetStartDate: e.target.value })} className="sm:max-w-xs" />
                  </Field>
                </div>

                <div className="space-y-4 rounded-lg bg-muted/40 p-4">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      <strong className="font-medium text-foreground">Schedule.</strong> Minimum is {MIN_HOURS_PER_DAY}H a day, 5 days a week ({MIN_HOURS_PER_WEEK}H per week); maximum is{' '}
                      {MAX_HOURS_PER_DAY}H a day, 5 days a week ({MAX_HOURS_PER_WEEK}H per week).
                    </p>
                    <p className="flex items-start gap-1">
                      <Moon className="mt-0.5 h-3 w-3 shrink-0" /> Any hours that fall between 10 PM and 6 AM Philippine time are subject to night differential rates.
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id={`r${i}-schedule`} label="Work hour type" required hint={r.scheduleType ? SCHEDULE_HINTS[r.scheduleType] : undefined} className="sm:col-span-2">
                      <NativeSelect id={`r${i}-schedule`} value={r.scheduleType} onChange={(e) => setRequest(i, { scheduleType: e.target.value as VaRequestDraft['scheduleType'] })} className="sm:max-w-xs">
                        <option value="">Choose a work hour type</option>
                        {SCHEDULE_TYPES.map((s) => (
                          <option key={s} value={s}>
                            {SCHEDULE_LABELS[s]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>

                    {r.scheduleType === 'WEEKLY_FLEXIBLE' && (
                      <Field id={`r${i}-hpw`} label="Work hours per week" required>
                        <Input
                          id={`r${i}-hpw`}
                          type="number"
                          min={MIN_HOURS_PER_WEEK}
                          max={MAX_HOURS_PER_WEEK}
                          value={numValue(r.hoursPerWeek)}
                          onChange={(e) => setRequest(i, { hoursPerWeek: num(e.target.value) })}
                          placeholder="e.g. 40"
                        />
                      </Field>
                    )}
                    {r.scheduleType === 'DAILY_FLEXIBLE' && (
                      <Field id={`r${i}-hpd`} label="Work hours per day" required>
                        <Input
                          id={`r${i}-hpd`}
                          type="number"
                          min={MIN_HOURS_PER_DAY}
                          max={MAX_HOURS_PER_DAY}
                          step={0.5}
                          value={numValue(r.hoursPerDay)}
                          onChange={(e) => setRequest(i, { hoursPerDay: num(e.target.value) })}
                          placeholder="e.g. 5"
                        />
                      </Field>
                    )}
                    {r.scheduleType === 'PROJECT' && (
                      <Field id={`r${i}-project`} label="Project hours" required>
                        <Input id={`r${i}-project`} type="number" min={1} value={numValue(r.projectHours)} onChange={(e) => setRequest(i, { projectHours: num(e.target.value) })} placeholder="e.g. 20" />
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
                            <span>
                              {shiftHours(r.startTimePht, r.endTimePht)} hours a day
                              {local && `, which is ${local[0]} – ${local[1]} ${TIME_ZONE_LABELS[p1.company.timeZone]} time`}.
                            </span>
                            {nightHours > 0 && (
                              <span className="inline-flex items-center gap-1 text-warning">
                                <Moon className="h-3 w-3" /> {nightHours === 1 ? '1 of these hours falls' : `${nightHours} of these hours fall`} between 10 PM and 6 AM Philippine time, so a night differential rate applies.
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                    {daily && (
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
                                className={cn('h-8 min-w-11 rounded-lg border px-2 text-sm', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}
                              >
                                {d}
                              </button>
                            )
                          })}
                        </div>
                      </fieldset>
                    )}
                    {r.scheduleType && (
                      <Field id={`r${i}-extra`} label="Additional hours" hint="Optional if needed, e.g. 1H Sat or Sun." className="sm:col-span-2">
                        <Input id={`r${i}-extra`} value={r.additionalHours} onChange={(e) => setRequest(i, { additionalHours: e.target.value })} className="sm:max-w-sm" />
                      </Field>
                    )}
                  </div>
                </div>

                <div className="grid gap-4">
                  <Field id={`r${i}-tasks`} label="What will be the tasks/requests for your VA?" required>
                    <Textarea id={`r${i}-tasks`} value={r.tasks} onChange={(e) => setRequest(i, { tasks: e.target.value })} />
                  </Field>
                  <Field id={`r${i}-tools`} label="What are the tools that will be used by the VA?">
                    <Input id={`r${i}-tools`} value={r.tools} onChange={(e) => setRequest(i, { tools: e.target.value })} placeholder="e.g. Seller Central, Helium 10, Google Sheets" />
                  </Field>
                </div>
              </section>
            )
          })}
          <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setRequests((rs) => [...rs, emptyVaRequest()])}>
            <Plus /> Add another service
          </Button>
        </div>
      )}

      {step === 2 && (
        <Section title="VA personality preference" description={PART3_INTRO}>
          <Choice
            name="part3-now"
            legend="Would you like to complete this section now?"
            required
            stacked
            value={part3Now}
            onChange={setPart3Now}
            options={[
              { value: 'YES', label: 'Yes, I’d like to fill it out now' },
              { value: 'NO', label: 'No, I’ll skip for now and complete it later' },
            ]}
          />
          {part3Now === 'YES' && (
            <div className="border-t pt-5">
              <Part3Ratings answers={answers} onChange={setAnswer} />
            </div>
          )}
        </Section>
      )}

      {step === 3 && (
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
            <dt className="text-muted-foreground">Focal person</dt>
            <dd>{p1.focalContact === 'PRIMARY' ? 'Primary contact' : 'Secondary contact'}</dd>
            <dt className="text-muted-foreground">Company</dt>
            <dd>
              {p1.company.companyName}
              {p1.company.dbaName && ` (DBA ${p1.company.dbaName})`}
              {p1.company.timeZone && ` · ${TIME_ZONE_LABELS[p1.company.timeZone] ?? p1.company.timeZone}`}
            </dd>
            <dt className="text-muted-foreground">Business address</dt>
            <dd className="whitespace-pre-wrap">{p1.company.businessAddress}</dd>
            <dt className="text-muted-foreground">Platforms</dt>
            <dd>{p1.business.platforms.map((p) => (p === 'Other' && p1.business.platformOther ? p1.business.platformOther : p)).join(', ')}</dd>
            {p1.business.otherInfo && (
              <>
                <dt className="text-muted-foreground">Other information</dt>
                <dd className="whitespace-pre-wrap">{p1.business.otherInfo}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Invoices to</dt>
            <dd>
              {p1.invoice.source === 'PRIMARY'
                ? `${p1.primary.firstName} ${p1.primary.lastName} (${p1.primary.email})`
                : p1.invoice.source === 'SECONDARY'
                  ? `${p1.secondary.firstName} ${p1.secondary.lastName} (${p1.secondary.email})`
                  : `${[p1.invoice.firstName, p1.invoice.lastName].filter(Boolean).join(' ')}, ${p1.invoice.role} (${p1.invoice.email})`}
            </dd>
            <dt className="text-muted-foreground">Payment</dt>
            <dd>
              {p1.payment.method === 'OTHER' ? p1.payment.methodOther : p1.payment.method && PAYMENT_LABELS[p1.payment.method]}
              {p1.payment.method === 'CREDIT_CARD' && p1.payment.billingCountry && ` from ${p1.payment.billingCountry}`}
              {!israel && p1.payment.hasPayoneerOrWise != null && ` · ${p1.payment.hasPayoneerOrWise ? 'has' : 'no'} active Payoneer or Wise account`}
            </dd>
            <dt className="text-muted-foreground">VA personality</dt>
            <dd>{part3Now === 'YES' ? 'Filled in now' : 'Will complete later'}</dd>
          </dl>
          <ul className="space-y-1 text-sm">
            {requests.map((r, i) => (
              <li key={i} className="rounded-lg border px-3 py-2">
                {r.numberOfVas} × {r.service}: {scheduleSummary(r)}
                {r.additionalHours && ` + ${r.additionalHours}`}, starting {r.targetStartDate}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ErrorNote error={error} />

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
            Next: skill requirements <ArrowRight />
          </Button>
        )}
        {step === 1 && (
          <Button size="lg" onClick={nextFromPart2}>
            Next: VA personality <ArrowRight />
          </Button>
        )}
        {step === 2 && (
          <Button size="lg" onClick={nextFromPart3}>
            Next: review <ArrowRight />
          </Button>
        )}
        {step === 3 && (
          <Button size="lg" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />} Submit
          </Button>
        )}
      </div>
    </div>
  )
}

// Part 3 alone, for a customer who skipped it on first submission and came
// back on the same link.
export function Part3Form({ token, customerName, returning = true }: { token: string; customerName: string; returning?: boolean }) {
  const [answers, setAnswers] = useState<Part3Answers>(emptyPart3)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [saving, start] = useTransition()

  const submit = () => {
    const parsed = part3AnswersSchema.safeParse(answers)
    if (!parsed.success) return setError(firstIssue(parsed.error))
    setError(null)
    start(async () => {
      const result = await submitPart3(token, answers)
      if (!result.ok) return setError(result.error)
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  if (done) {
    return (
      <Thanks title="Thank you!">
        <p>We’ve received your VA personality preferences. They’ll help us match you with the VA who best fits your way of working.</p>
      </Thanks>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ fontFamily: 'var(--font-montserrat)' }}>
          {returning ? `Welcome back, ${customerName}` : 'VA personality preference'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">We have your customer profile and skill requirements. This last step takes only a few minutes. Fields marked * are required.</p>
      </div>
      <Section title="VA personality preference" description={PART3_INTRO}>
        <Part3Ratings answers={answers} onChange={(id, index, rating) => setAnswers((a) => setRating(a, id, index, rating))} />
      </Section>
      <ErrorNote error={error} />
      <div className="flex justify-end">
        <Button size="lg" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />} Submit
        </Button>
      </div>
    </div>
  )
}

