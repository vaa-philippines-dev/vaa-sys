import { prisma } from '@/lib/prisma'
import { ADMIN_EMAIL_DOMAIN, type Actor } from '@/lib/auth'
import { grantableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS, ACCESS_ROLES } from '@/lib/access-fields'
import { listServiceDepartments, listStaff } from '@/lib/workforce'
import { manilaDate } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'
import { AddAccessForm, AccessRowControls } from '@/components/access/AccessControls'
import { SortableTable } from '@/components/ui/sortable-table'
import { RateViewers } from '@/components/access/RateViewers'
import { canViewRates, listRateViewers, ratesKeySet } from '@/lib/rates'

type StaffName = { email: string; name: string }

// Who can use VAA Systems and with which role (vaa_sys.access_users), for
// Customer Management's /access and Lead Management's /leads/access. Names
// come from VAA Workforce; Workforce Super and System Admins are admins
// here without a row.
export async function AccessPanel({
  user,
  area,
  title,
  titleClass,
  rateViewers = false,
}: {
  user: Actor
  area: string
  title: string
  titleClass?: string
  // Lead Management's User access also lists who can see the confidential rates.
  rateViewers?: boolean
}) {
  const grantable = grantableRoles(user.role)

  const [rows, admins, departments, staff, viewers, canManageRates] = await Promise.all([
    prisma.accessUser.findMany({ orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { email: 'asc' }] }),
    prisma.$queryRaw<StaffName[]>`
      SELECT email, trim(first_name || ' ' || last_name) AS name
      FROM public.users
      WHERE is_active AND NOT is_bot
        AND system_role::text IN ('SUPER_ADMIN', 'SYSTEM_ADMIN')
        AND lower(email) LIKE ${'%' + ADMIN_EMAIL_DOMAIN}
      ORDER BY first_name`,
    listServiceDepartments(),
    listStaff(ADMIN_EMAIL_DOMAIN),
    rateViewers ? listRateViewers() : Promise.resolve([]),
    rateViewers ? canViewRates(user.email) : Promise.resolve(false),
  ])
  const departmentName = new Map(departments.map((d) => [d.id, d.name]))
  const nameOf = new Map(staff.map((s) => [s.email, s.name]))
  const missing = [...rows.map((r) => r.email), ...viewers.map((v) => v.email)].filter((e) => !nameOf.has(e))
  if (missing.length) {
    const more = await prisma.$queryRaw<StaffName[]>`
      SELECT lower(email) AS email, trim(first_name || ' ' || last_name) AS name
      FROM public.users WHERE lower(email) = ANY(${missing})`
    for (const m of more) nameOf.set(m.email, m.name)
  }
  // The picker says who already has access, so nobody is added twice.
  const adminEmails = new Set(admins.map((a) => a.email.toLowerCase()))
  const roleOf = new Map(rows.filter((r) => r.isActive).map((r) => [r.email, ROLE_LABELS[r.role]]))
  const people = staff.map((s) => ({
    email: s.email,
    name: s.name || s.email,
    current: adminEmails.has(s.email) ? ROLE_LABELS.ADMIN : (roleOf.get(s.email) ?? null),
  }))

  return (
    <main className="w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{area}</p>
        <h1 className={cn('mt-1 text-2xl font-semibold', titleClass)}>{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who can use VAA Systems and where they land after signing in with Google. Everyone needs an active VAA Workforce account.
        </p>
      </div>

      <details className="group rounded-2xl border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">What each role can do</summary>
        <dl className="grid gap-x-6 gap-y-3 border-t px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {ACCESS_ROLES.map((r) => (
            <div key={r}>
              <dt className="text-sm font-medium">{ROLE_LABELS[r]}</dt>
              <dd className="mt-0.5 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </details>

      <section className="space-y-3">
        <h2 className="font-semibold">Add someone</h2>
        <AddAccessForm roles={grantable} departments={departments} people={people} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">People with access</h2>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <SortableTable
            className="w-full text-sm"
            theadClassName="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"
            tbodyClassName="divide-y"
            columns={[
              { key: 'person', label: 'Person', className: 'px-4 py-2.5 font-medium' },
              { key: 'role', label: 'Role', className: 'px-4 py-2.5 font-medium' },
              { key: 'added', label: 'Added', firstDir: 'desc', className: 'hidden px-4 py-2.5 font-medium md:table-cell' },
              { key: 'actions', label: <span className="sr-only">Change</span>, sortable: false, className: 'px-4 py-2.5' },
            ]}
            rows={[
              ...admins.map((a) => ({
                id: `admin-${a.email}`,
                values: { person: a.name || a.email, role: ROLE_LABELS.ADMIN, added: null },
                node: (
                <tr key={`admin-${a.email}`} className="text-muted-foreground">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{a.name}</p>
                    <p className="text-xs">{a.email}</p>
                  </td>
                  <td className="px-4 py-3">{ROLE_LABELS.ADMIN}</td>
                  <td className="hidden px-4 py-3 text-xs md:table-cell">From VAA Workforce (Super/System Admin)</td>
                  <td className="px-4 py-3" />
                </tr>
                ),
              })),
              ...rows.map((r) => ({
                id: r.id,
                values: { person: nameOf.get(r.email) ?? r.email, role: ROLE_LABELS[r.role], added: r.createdAt },
                node: (
                <tr key={r.id} className={r.isActive ? '' : 'opacity-60'}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{nameOf.get(r.email) ?? r.email}</p>
                    <p className="text-xs text-muted-foreground">{r.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {ROLE_LABELS[r.role]}
                    {r.departmentId && <span className="block text-xs text-muted-foreground">{departmentName.get(r.departmentId) ?? 'Unknown department'}</span>}
                    {!r.isActive && <span className="ml-2 text-xs text-muted-foreground">(removed)</span>}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
                    {r.createdAt.toLocaleDateString('en-PH', manilaDate)} by {r.addedByEmail}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {grantable.includes(r.role) && (
                      <AccessRowControls
                        id={r.id}
                        role={r.role}
                        departmentId={r.departmentId}
                        isActive={r.isActive}
                        roles={grantable}
                        departments={departments}
                        isSelf={r.email === user.email.toLowerCase()}
                      />
                    )}
                  </td>
                </tr>
                ),
              })),
            ]}
          />
        </div>
      </section>

      {rateViewers && (
        <RateViewers
          viewers={viewers.map((v) => ({
            email: v.email,
            name: nameOf.get(v.email) || v.email,
            owner: v.owner,
            valid: v.valid,
            grantedBy: v.grantedByEmail,
            grantedOn: v.grantedAt ? v.grantedAt.toLocaleDateString('en-PH', manilaDate) : null,
          }))}
          people={staff.map((s) => ({ email: s.email, name: s.name || s.email }))}
          canManage={canManageRates}
          keySet={ratesKeySet()}
        />
      )}
    </main>
  )
}
