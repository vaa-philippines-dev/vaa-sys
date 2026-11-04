import { BarList, FunnelChart, PeriodChart, PeriodTable, RangeFilter, ReportSection, Stat } from '@/components/lms/LeadReports'
import { requireCan } from '@/lib/auth'
import { manilaDate, dateOnly } from '@/lib/customer-fields'
import { leadReport, parseRange } from '@/lib/lead-reports'

const rangeDay = { ...manilaDate, timeZone: 'UTC' } satisfies Intl.DateTimeFormatOptions

export default async function LeadReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requireCan('leadReports', 'read', '/leads/reports')
  const now = new Date()
  const range = parseRange(await searchParams, now)
  const report = await leadReport(range, now)
  const added = report.funnel[0].count
  const span = `${dateOnly(range.from).toLocaleDateString('en-US', rangeDay)} – ${dateOnly(range.to).toLocaleDateString('en-US', rangeDay)}`

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Lead Management</p>
        <h1 className="mt-1 text-2xl font-semibold">Lead reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">{span}, Philippine time.</p>
      </div>

      <RangeFilter range={range} />

      <ReportSection
        title="Onboarding funnel"
        description="The leads added in this range, followed to today. A lead counts at a step only after every step before it."
      >
        {added === 0 ? (
          <p className="text-sm text-muted-foreground">No leads were added in this range.</p>
        ) : (
          <>
            <FunnelChart steps={report.funnel} />
            {report.activeWithoutForm > 0 && (
              <p className="text-[12px] text-muted-foreground">
                {report.activeWithoutForm} {report.activeWithoutForm === 1 ? 'lead was' : 'leads were'} made Active without a submitted form and{' '}
                {report.activeWithoutForm === 1 ? 'isn’t' : 'aren’t'} counted in the last step.
              </p>
            )}
          </>
        )}
      </ReportSection>

      <ReportSection
        title="Leads over time"
        description={`New leads per ${range.unit}. The table also shows the links sent, forms submitted and links that expired unused in each ${range.unit}.`}
      >
        <PeriodChart periods={report.periods} unit={range.unit} />
        <PeriodTable periods={report.periods} unit={range.unit} />

        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-muted-foreground">Who added them</h3>
          {report.adders.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No leads were added in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[13px]">
                <thead className="text-[12px] text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-4 font-medium">Added by</th>
                    <th className="py-2 pr-4 text-right font-medium">Leads</th>
                    <th className="py-2 pr-4 text-right font-medium">Forms submitted</th>
                    <th className="py-2 text-right font-medium">Became Active</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {report.adders.map((a) => (
                    <tr key={a.email} className="border-b last:border-0">
                      <td className="py-2 pr-4" title={a.email}>
                        {a.name}
                      </td>
                      <td className="py-2 pr-4 text-right">{a.added}</td>
                      <td className="py-2 pr-4 text-right">{a.submitted}</td>
                      <td className="py-2 text-right">{a.active}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ReportSection>

      <ReportSection title="VA demand" description="The VAs requested on onboarding forms submitted in this range, by the customer’s answers.">
        <div className="grid grid-cols-3 gap-6 sm:max-w-md">
          <Stat value={report.demand.vas} label="VAs requested" />
          <Stat value={report.demand.forms} label="Forms submitted" />
          <Stat value={report.demand.customers} label="Customers" />
        </div>
        {report.demand.vas > 0 && (
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
            <BarList title="By service" rows={report.demand.byService} />
            <BarList title="By work hour type" rows={report.demand.bySchedule} />
            <BarList title="By request group" rows={report.demand.byGroup} />
            <BarList title="By primary contact’s region" rows={report.demand.byRegion} />
          </div>
        )}
      </ReportSection>
    </main>
  )
}
