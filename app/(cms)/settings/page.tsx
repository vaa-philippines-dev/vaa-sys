import Link from 'next/link'
import { requireCan } from '@/lib/auth'
import { allSettingsIn } from '@/lib/settings'
import { listServiceDepartments, listServices } from '@/lib/workforce'
import { CATEGORY_HINTS, CATEGORY_LABELS, SETTING_CATEGORIES, WORKFORCE_CATEGORIES, isSettingCategory, type WorkforceCategory } from '@/lib/settings-fields'
import { SettingsEditor } from '@/components/cms/SettingsEditor'
import { cn } from '@/lib/utils'

// Admin-only: the lookup lists (legacy Settings tab). Departments and
// services are shown read-only from Workforce.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await requireCan('settings', 'read', '/settings')
  const { category: raw } = await searchParams
  const category = isSettingCategory(raw) || WORKFORCE_CATEGORIES.includes(raw as WorkforceCategory) ? (raw as string) : 'Category'

  return (
    <main className="w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">The lists people pick from across the system. Switched-off options stay on the records that already use them.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Lists">
          {[...SETTING_CATEGORIES, ...WORKFORCE_CATEGORIES].map((c) => (
            <Link
              key={c}
              href={`/settings?category=${c}`}
              className={cn(
                'shrink-0 rounded-lg px-3 py-2 text-[13px]',
                c === category ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {CATEGORY_LABELS[c]}
              {WORKFORCE_CATEGORIES.includes(c as WorkforceCategory) && <span className="ml-1 text-[11px] opacity-70">(Workforce)</span>}
            </Link>
          ))}
        </nav>

        <section className="min-w-0 space-y-3">
          <div>
            <h2 className="font-display font-semibold">{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}</h2>
            <p className="text-sm text-muted-foreground">{CATEGORY_HINTS[category as keyof typeof CATEGORY_HINTS]}</p>
          </div>
          {isSettingCategory(category) ? <SettingsEditor category={category} options={await allSettingsIn(category)} /> : <WorkforceList category={category as WorkforceCategory} />}
        </section>
      </div>
    </main>
  )
}

async function WorkforceList({ category }: { category: WorkforceCategory }) {
  const rows =
    category === 'Department'
      ? (await listServiceDepartments()).map((d) => ({ id: d.id, name: d.name, detail: null as string | null }))
      : (await listServices()).map((s) => ({ id: s.id, name: s.name, detail: s.departments.join(', ') || 'No department yet' }))
  if (rows.length === 0) return <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">Nothing found in Workforce.</p>
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
          <span className="font-medium">{r.name}</span>
          {r.detail && <span className="text-xs text-muted-foreground">{r.detail}</span>}
        </li>
      ))}
    </ul>
  )
}
