import { redirect } from 'next/navigation'
import { requireSignedIn } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { homeFor } from '@/lib/access-fields'
import { prisma } from '@/lib/prisma'
import { canViewRates, ratesKeySet } from '@/lib/rates'
import { listOrgServices, listServiceDepartmentsFull } from '@/lib/workforce-org'
import { WorkforceOrg } from '@/components/leads/WorkforceOrg'

// Lead Management's Departments & services page: VAA Workforce's service
// departments and services (asked for on Nov 5, 2026). Admins edit them
// (workforceOrg in lib/permissions.ts); the people allowed to see the
// confidential rates (lib/rates.ts) can open it for those too.
export default async function DepartmentsPage() {
  const user = await requireSignedIn('/leads/departments')
  const admin = can(user.role, 'workforceOrg', 'update')
  const showRates = await canViewRates(user.email)
  if (!admin && !showRates) redirect(homeFor(user.role))

  const [departments, services, contracts] = await Promise.all([
    listServiceDepartmentsFull(),
    listOrgServices(user.email),
    prisma.contract.findMany({ where: { isActive: true }, orderBy: { contractCode: 'asc' }, select: { id: true, contractCode: true, name: true } }),
  ])

  return (
    <main className="w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Lead Management · Workforce</p>
        <h1 className="mt-1 text-2xl font-semibold">Departments &amp; services</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          VAA Workforce’s service departments and services. Departments and job descriptions save straight to Workforce. Nothing is deleted here: set a department Inactive
          instead. Merging and splitting departments stays in Workforce.
        </p>
      </div>
      <WorkforceOrg
        departments={departments}
        services={services}
        contracts={contracts.map((c) => ({ id: c.id, label: `${c.contractCode} · ${c.name}` }))}
        canEdit={admin}
        showRates={showRates}
        ratesKeySet={showRates && ratesKeySet()}
      />
    </main>
  )
}
