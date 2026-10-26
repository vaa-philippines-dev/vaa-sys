import { requireArea } from '@/lib/auth'
import { manilaDateTime } from '@/lib/customer-fields'
import { getWorkHourMinimums, getWorkHourMinimumsRow } from '@/lib/settings'
import { WorkHourMinimumsForm } from '@/components/settings/WorkHourMinimumsForm'

export default async function SettingsPage() {
  await requireArea('settings', '/leads/settings')
  const [minimums, row] = await Promise.all([getWorkHourMinimums(), getWorkHourMinimumsRow()])

  return (
    <main className="w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Lead Management</p>
        <h1 className="mt-1 text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">General settings for VAA Systems. Only admins can change them.</p>
      </div>

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="font-semibold">Work hour type minimums</h2>
          <p className="text-sm text-muted-foreground">
            The fewest hours a customer can ask for on the onboarding form, per work hour type. There is no maximum. Changes apply to the next form opened or
            submitted.
          </p>
        </div>
        <WorkHourMinimumsForm initial={minimums} />
        <p className="text-xs text-muted-foreground">
          {row ? `Last changed ${row.updatedAt.toLocaleString('en-PH', manilaDateTime)}${row.updatedByEmail ? ` by ${row.updatedByEmail}` : ''}.` : 'Using the built-in defaults.'}
        </p>
      </section>
    </main>
  )
}
