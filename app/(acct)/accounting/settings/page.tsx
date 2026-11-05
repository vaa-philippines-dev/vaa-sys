import { requireCan } from '@/lib/auth'
import { getBillingDefaults, getBillingDefaultsRow, listRates } from '@/lib/billing'
import { SERVICE_OFFERINGS } from '@/lib/onboarding-fields'
import { manilaDateTime } from '@/lib/customer-fields'
import { DefaultsForm, RateRow } from '@/components/acct/RatesForms'
import { SortableTable } from '@/components/ui/sortable-table'

// The rates and fees every new bill starts from (Accounting and admins).
// The Lead Manager can still change a bill's rate before sending it.
export default async function RatesPage() {
  await requireCan('billing', 'update', '/accounting/settings')
  const [defaults, row, rates] = await Promise.all([getBillingDefaults(), getBillingDefaultsRow(), listRates()])
  const rateOf = new Map(rates.map((r) => [r.service, r]))

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Accounting System</p>
        <h1 className="mt-1 text-2xl font-semibold">Rates &amp; fees</h1>
        <p className="mt-1 text-sm text-muted-foreground">What a new initial bill starts from. Bills already prepared keep the values they were made with.</p>
      </div>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <div>
          <h2 className="font-semibold">Fees</h2>
          <p className="text-xs text-muted-foreground">
            {row ? `Last changed ${row.updatedAt.toLocaleString('en-PH', manilaDateTime)} by ${row.updatedByEmail}.` : 'Using the defaults from the billing guide.'}
          </p>
        </div>
        <DefaultsForm value={defaults} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Fallback hourly rate per service (USD)</h2>
          <p className="text-xs text-muted-foreground">
            A new bill starts from each service’s Standard Billing Rate, which is confidential and set in Lead Management → Departments &amp; services. These rates are used only for a
            service that has none yet. Without either, the rate starts at 0, and the bill can’t be sent until the Lead Manager enters one.
          </p>
        </div>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <SortableTable
            className="w-full min-w-[560px] text-left text-[13px]"
            theadClassName="border-b text-[12px] text-muted-foreground"
            columns={[
              { key: 'service', label: 'Service', className: 'px-4 py-2.5 font-medium' },
              { key: 'rate', label: 'Hourly rate', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
              { key: 'changed', label: 'Last changed', firstDir: 'desc', className: 'px-4 py-2.5 font-medium' },
            ]}
            rows={SERVICE_OFFERINGS.map((s) => {
              const r = rateOf.get(s)
              return {
                id: s,
                values: { service: s, rate: r ? Number(r.hourlyRate) : null, changed: r?.updatedAt ?? null },
                node: (
                  <RateRow
                    key={s}
                    service={s}
                    rate={r ? Number(r.hourlyRate) : null}
                    updated={r ? `${r.updatedAt.toLocaleString('en-PH', manilaDateTime)} · ${r.updatedByEmail}` : null}
                  />
                ),
              }
            })}
          />
        </div>
      </section>
    </main>
  )
}
