'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { CustomerEditForm } from '@/components/customers/CustomerPanels'
import { updateAccountDetails, updateVaRequest } from '@/app/(cms)/accounts/actions'
import { INVOICE_SOURCES, NO_DAY_HOURS, PAYMENT_LABELS, PAYMENT_METHODS, PLATFORMS, REGIONS, SERVICE_OFFERINGS, timeZoneOptions, workDaysOf } from '@/lib/onboarding-fields'
import { ScheduleFields } from '@/components/requests/ScheduleFields'
import type { AccountDetailsInput, ContactEdit, EditableAccount, EditableRequest } from '@/lib/account-details-fields'

// The Details section on a customer's and an account's page in Customer
// Management: the onboarding details and tickets, read-only (children)
// until Edit is clicked (asked for on Nov 5, 2026). Edit shows the
// customer's own fields (customer page only), each account's company,
// billing and contacts, and each ticket's VA requests, each saved on its own.

type CustomerFields = { id: string; initial: { name: string; email: string | null; notes: string | null; noPaymentYet: boolean; paymentDate: string | null } }

export function DetailsEditor({ canEdit, customer, accounts, children }: { canEdit: boolean; customer?: CustomerFields; accounts: EditableAccount[]; children: ReactNode }) {
  const [editing, setEditing] = useState(false)
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Details</h2>
        {canEdit &&
          (editing ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X /> Done editing
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          ))}
      </div>
      {!editing ? (
        children
      ) : (
        <div className="space-y-6">
          {customer && (
            <article className="space-y-3 rounded-xl border bg-card p-5">
              <h3 className="font-semibold">Customer</h3>
              <CustomerEditForm customerId={customer.id} initial={customer.initial} />
            </article>
          )}
          {accounts.map((a) => (
            <article key={a.id} className="space-y-6 rounded-xl border bg-card p-5">
              <header>
                <p className="font-mono text-xs text-muted-foreground">{a.code}</p>
                <h3 className="font-semibold">{a.name}</h3>
              </header>
              <AccountDetailsForm account={a} />
              {a.tickets.map((t) =>
                t.requests.map((r) => (
                  <div key={r.id} className="space-y-2 border-t pt-5">
                    <h4 className="text-sm font-semibold">
                      VA request <span className="font-mono font-normal text-muted-foreground">{r.code}</span>
                    </h4>
                    <VaRequestForm accountId={a.id} request={r} />
                  </div>
                ))
              )}
            </article>
          ))}
          {accounts.length === 0 && <p className="text-sm text-muted-foreground">No accounts yet, so there are no onboarding details to edit.</p>}
        </div>
      )}
    </section>
  )
}

function Field({ id, label, children, wide }: { id: string; label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

const emptyContact = (): ContactEdit => ({ firstName: '', lastName: '', role: '', email: '', whatsapp: '', region: '' })

function ContactFields({ prefix, label, value, onChange, onRemove, disabled }: { prefix: string; label: string; value: ContactEdit; onChange: (c: ContactEdit) => void; onRemove?: () => void; disabled: boolean }) {
  const set = (k: keyof ContactEdit) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium">{label}</legend>
        {onRemove && (
          <Button type="button" size="sm" variant="ghost" onClick={onRemove} disabled={disabled}>
            <X /> Remove
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-first`} label="First name">
          <Input id={`${prefix}-first`} value={value.firstName} onChange={set('firstName')} disabled={disabled} />
        </Field>
        <Field id={`${prefix}-last`} label="Last name">
          <Input id={`${prefix}-last`} value={value.lastName} onChange={set('lastName')} disabled={disabled} />
        </Field>
        <Field id={`${prefix}-role`} label="Role">
          <Input id={`${prefix}-role`} value={value.role} onChange={set('role')} disabled={disabled} />
        </Field>
        <Field id={`${prefix}-email`} label="Email">
          <Input id={`${prefix}-email`} type="email" value={value.email} onChange={set('email')} disabled={disabled} />
        </Field>
        <Field id={`${prefix}-wa`} label="WhatsApp">
          <Input id={`${prefix}-wa`} value={value.whatsapp} onChange={set('whatsapp')} placeholder="+1 555 123 4567" disabled={disabled} />
        </Field>
        <Field id={`${prefix}-region`} label="Lives in">
          <NativeSelect id={`${prefix}-region`} value={value.region} onChange={set('region')} disabled={disabled}>
            <option value="">Not recorded</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </fieldset>
  )
}

function AccountDetailsForm({ account }: { account: EditableAccount }) {
  const router = useRouter()
  const [v, setV] = useState<AccountDetailsInput>(account.details)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const zones = useMemo(() => timeZoneOptions(), [])
  const p = `ad-${account.id}`
  const set = (k: keyof AccountDetailsInput) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))

  const save = () =>
    start(async () => {
      const result = await updateAccountDetails(account.id, v)
      if (!result.ok) return setError(result.error)
      setError(null)
      toast.success(`${account.name}: details saved.`)
      router.refresh()
    })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="space-y-5"
    >
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company and billing</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${p}-company`} label="Company">
            <Input id={`${p}-company`} value={v.companyName} onChange={set('companyName')} required disabled={pending} />
          </Field>
          <Field id={`${p}-dba`} label="DBA name">
            <Input id={`${p}-dba`} value={v.dbaName} onChange={set('dbaName')} disabled={pending} />
          </Field>
          <Field id={`${p}-address`} label="Business address" wide>
            <Textarea id={`${p}-address`} value={v.businessAddress} onChange={set('businessAddress')} rows={2} disabled={pending} />
          </Field>
          <Field id={`${p}-website`} label="Website">
            <Input id={`${p}-website`} value={v.website} onChange={set('website')} placeholder="https://" disabled={pending} />
          </Field>
          <Field id={`${p}-tz`} label="Time zone">
            <NativeSelect id={`${p}-tz`} value={v.timeZone} onChange={set('timeZone')} disabled={pending}>
              <option value="">Not recorded</option>
              {v.timeZone && !zones.some((z) => z.value === v.timeZone) && <option value={v.timeZone}>{v.timeZone}</option>}
              {zones.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Platforms</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {PLATFORMS.map((pl) => (
              <label key={pl} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={v.platforms.includes(pl)}
                  onChange={(e) => setV((s) => ({ ...s, platforms: e.target.checked ? [...s.platforms, pl] : s.platforms.filter((x) => x !== pl) }))}
                  disabled={pending}
                />
                {pl}
              </label>
            ))}
          </div>
          {v.platforms.includes('Other') && <Input aria-label="Other platform" value={v.platformOther} onChange={set('platformOther')} placeholder="Which platform?" disabled={pending} />}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${p}-inv`} label="Invoices go to">
            <NativeSelect id={`${p}-inv`} value={v.invoiceSource} onChange={set('invoiceSource')} disabled={pending}>
              {INVOICE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s === 'PRIMARY' ? 'The primary contact' : s === 'SECONDARY' ? 'The secondary contact' : 'Someone else'}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {v.invoiceSource === 'OTHER' && (
            <>
              <Field id={`${p}-inv-name`} label="Invoice contact name">
                <Input id={`${p}-inv-name`} value={v.invoiceName} onChange={set('invoiceName')} disabled={pending} />
              </Field>
              <Field id={`${p}-inv-role`} label="Invoice contact role">
                <Input id={`${p}-inv-role`} value={v.invoiceRole} onChange={set('invoiceRole')} disabled={pending} />
              </Field>
              <Field id={`${p}-inv-email`} label="Invoice contact email">
                <Input id={`${p}-inv-email`} type="email" value={v.invoiceEmail} onChange={set('invoiceEmail')} disabled={pending} />
              </Field>
            </>
          )}
          <Field id={`${p}-pay`} label="Pays by">
            <NativeSelect id={`${p}-pay`} value={v.paymentMethod} onChange={set('paymentMethod')} disabled={pending}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {v.paymentMethod === 'OTHER' && (
            <Field id={`${p}-pay-other`} label="Other payment method">
              <Input id={`${p}-pay-other`} value={v.paymentMethodOther} onChange={set('paymentMethodOther')} disabled={pending} />
            </Field>
          )}
          <Field id={`${p}-country`} label="Billing country">
            <Input id={`${p}-country`} value={v.billingCountry} onChange={set('billingCountry')} disabled={pending} />
          </Field>
          <Field id={`${p}-pw`} label="Payoneer or Wise">
            <NativeSelect
              id={`${p}-pw`}
              value={v.hasPayoneerOrWise == null ? '' : v.hasPayoneerOrWise ? 'yes' : 'no'}
              onChange={(e) => setV((s) => ({ ...s, hasPayoneerOrWise: e.target.value === '' ? null : e.target.value === 'yes' }))}
              disabled={pending}
            >
              <option value="">Not asked or not recorded</option>
              <option value="yes">Has an active account</option>
              <option value="no">No active account</option>
            </NativeSelect>
          </Field>
          <Field id={`${p}-info`} label="Other information" wide>
            <Textarea id={`${p}-info`} value={v.otherInfo} onChange={set('otherInfo')} rows={2} disabled={pending} />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacts</h4>
        {v.primary ? (
          <ContactFields prefix={`${p}-pri`} label="Primary contact" value={v.primary} onChange={(c) => setV((s) => ({ ...s, primary: c }))} disabled={pending} />
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setV((s) => ({ ...s, primary: emptyContact() }))} disabled={pending}>
            Add primary contact
          </Button>
        )}
        {v.secondary ? (
          <ContactFields
            prefix={`${p}-sec`}
            label="Secondary contact"
            value={v.secondary}
            onChange={(c) => setV((s) => ({ ...s, secondary: c }))}
            onRemove={() => setV((s) => ({ ...s, secondary: null, focal: s.focal === 'SECONDARY' ? 'NONE' : s.focal, invoiceSource: s.invoiceSource === 'SECONDARY' ? 'OTHER' : s.invoiceSource }))}
            disabled={pending}
          />
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setV((s) => ({ ...s, secondary: emptyContact() }))} disabled={pending}>
            Add secondary contact
          </Button>
        )}
        <Field id={`${p}-focal`} label="Main contact (the one VAA works with day to day)">
          <NativeSelect id={`${p}-focal`} value={v.focal} onChange={set('focal')} disabled={pending}>
            <option value="PRIMARY">Primary contact</option>
            <option value="SECONDARY">Secondary contact</option>
            <option value="NONE">Not set</option>
          </NativeSelect>
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Save account details
      </Button>
    </form>
  )
}

function VaRequestForm({ accountId, request }: { accountId: string; request: EditableRequest }) {
  const router = useRouter()
  const [r, setR] = useState(request)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const p = `vr-${request.id}`
  const setText = (k: keyof EditableRequest) => (e: { target: { value: string } }) => setR((s) => ({ ...s, [k]: e.target.value }))
  const setNum = (k: 'numberOfVas') => (e: { target: { value: string } }) => setR((s) => ({ ...s, [k]: e.target.value === '' ? Number.NaN : Number(e.target.value) }))
  const zones = useMemo(() => timeZoneOptions(), [])

  const save = () =>
    start(async () => {
      // The form's own fields only; id and code aren't part of the input.
      const { id, code, ...input } = r
      void id
      void code
      const result = await updateVaRequest(accountId, request.id, input)
      if (!result.ok) return setError(result.error)
      setError(null)
      toast.success(`${request.code} saved.`)
      router.refresh()
    })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${p}-svc`} label="Service">
          <NativeSelect id={`${p}-svc`} value={r.service} onChange={setText('service')} disabled={pending}>
            {!(SERVICE_OFFERINGS as readonly string[]).includes(r.service) && <option value={r.service}>{r.service}</option>}
            {SERVICE_OFFERINGS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={`${p}-vas`} label="Number of VAs">
          <Input id={`${p}-vas`} type="number" min={1} step={1} value={Number.isNaN(r.numberOfVas) ? '' : r.numberOfVas} onChange={setNum('numberOfVas')} disabled={pending} />
        </Field>
        <Field id={`${p}-start`} label="Target start">
          <Input id={`${p}-start`} type="date" value={r.targetStartDate} onChange={setText('targetStartDate')} disabled={pending} />
        </Field>
        <Field id={`${p}-tz`} label="Client time zone">
          <NativeSelect id={`${p}-tz`} value={r.timeZone ?? ''} onChange={setText('timeZone')} disabled={pending}>
            <option value="">The account’s</option>
            {zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {/* A schedule saved here goes into the request's schedule history
          (and, while its service request is open, waits for Executive Support). */}
      <ScheduleFields
        id={`${p}-schedule`}
        value={{
          scheduleType: r.scheduleType,
          hoursPerDay: r.hoursPerDay ?? null,
          hoursPerWeek: r.hoursPerWeek ?? null,
          hoursPerMonth: r.hoursPerMonth ?? null,
          projectHours: r.projectHours ?? null,
          startTimePht: r.startTimePht,
          endTimePht: r.endTimePht,
          dayHours: r.dayHours ?? [...NO_DAY_HOURS],
          additionalHours: r.additionalHours,
        }}
        onChange={(s) => setR((x) => ({ ...x, ...s, scheduleType: s.scheduleType || x.scheduleType, workDays: workDaysOf(s.dayHours) }))}
        disabled={pending}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {r.scheduleType !== 'DAILY_FIXED' && (
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={r.nightDifferential} onChange={(e) => setR((s) => ({ ...s, nightDifferential: e.target.checked }))} disabled={pending} />
            Night differential applies
          </label>
        )}
        <Field id={`${p}-tt`} label="Time tracker">
          <NativeSelect
            id={`${p}-tt`}
            value={r.taskTracker == null ? '' : r.taskTracker ? 'yes' : 'no'}
            onChange={(e) => setR((s) => ({ ...s, taskTracker: e.target.value === '' ? null : e.target.value === 'yes' }))}
            disabled={pending}
          >
            <option value="">Not answered</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </NativeSelect>
        </Field>
      </div>
      {r.scheduleType === 'DAILY_FIXED' && <p className="text-xs text-muted-foreground">For a fixed shift, the hours and night differential are worked out from the times.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${p}-tasks`} label="Tasks">
          <Textarea id={`${p}-tasks`} value={r.tasks} onChange={setText('tasks')} rows={3} disabled={pending} />
        </Field>
        <Field id={`${p}-tools`} label="Tools">
          <Textarea id={`${p}-tools`} value={r.tools} onChange={setText('tools')} rows={3} disabled={pending} />
        </Field>
        <Field id={`${p}-must`} label="Must-haves or deal breakers" wide>
          <Textarea id={`${p}-must`} value={r.mustHaves ?? ''} onChange={setText('mustHaves')} rows={2} disabled={pending} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Save {request.code}
      </Button>
    </form>
  )
}
