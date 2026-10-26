import { prisma } from '@/lib/prisma'
import { ADMIN_EMAIL_DOMAIN, requireArea } from '@/lib/auth'
import { grantableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS, ACCESS_ROLES } from '@/lib/access-fields'
import { listServiceDepartments } from '@/lib/workforce'
import { manilaDate } from '@/lib/customer-fields'
import { AddAccessForm, AccessRowControls } from '@/components/access/AccessControls'

type StaffName = { email: string; name: string }

export default async function AccessPage() {
  const user = await requireArea('access', '/access')
  const grantable = grantableRoles(user.role)

  const [rows, admins, departments] = await Promise.all([
    prisma.accessUser.findMany({ orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { email: 'asc' }] }),
    prisma.$queryRaw<StaffName[]>`
      SELECT email, trim(first_name || ' ' || last_name) AS name
      FROM public.users
      WHERE is_active AND NOT is_bot
        AND system_role::text IN ('SUPER_ADMIN', 'SYSTEM_ADMIN')
        AND lower(email) LIKE ${'%' + ADMIN_EMAIL_DOMAIN}
      ORDER BY first_name`,
    listServiceDepartments(),
  ])
  const departmentName = new Map(departments.map((d) => [d.id, d.name]))
  const names = rows.length
    ? await prisma.$queryRaw<StaffName[]>`
        SELECT lower(email) AS email, trim(first_name || ' ' || last_name) AS name
        FROM public.users WHERE lower(email) = ANY(${rows.map((r) => r.email)})`
    : []
  const nameOf = new Map(names.map((n) => [n.email, n.name]))

  return (
    <main className="w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Access</h1>
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
        <AddAccessForm roles={grantable} departments={departments} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">People with access</h2>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Person</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Added</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {admins.map((a) => (
                <tr key={`admin-${a.email}`} className="text-muted-foreground">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{a.name}</p>
                    <p className="text-xs">{a.email}</p>
                  </td>
                  <td className="px-4 py-3">{ROLE_LABELS.ADMIN}</td>
                  <td className="hidden px-4 py-3 text-xs md:table-cell">From VAA Workforce (Super/System Admin)</td>
                  <td className="px-4 py-3" />
                </tr>
              ))}
              {rows.map((r) => (
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
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
