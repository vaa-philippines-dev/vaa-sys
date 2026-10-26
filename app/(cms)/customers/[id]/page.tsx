import { notFound } from 'next/navigation'
import { CustomerDetail } from '@/components/customers/CustomerDetail'
import { requireArea, displayName } from '@/lib/auth'
import { getCustomer } from '@/lib/customers'
import { prisma } from '@/lib/prisma'
import { can, needsStatusReview } from '@/lib/permissions'
import { assertCustomerInScope } from '@/lib/scope'
import { settingOptions } from '@/lib/settings'
import { listCsTeam, takeoverState } from '@/lib/specialists'
import { staffNames } from '@/lib/workforce'
import { startedVaCountsByCustomer } from '@/lib/va-connection-hooks'
import { customerWarnings } from '@/lib/customer-fields'

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireArea('customers', `/customers/${id}`)
  // Out of scope reads the same as missing, so ids can't be probed.
  if (!(await assertCustomerInScope(user, id))) notFound()
  const customer = await getCustomer(id)
  if (!customer) notFound()

  const canAssign = can(user.role, 'csSpecialists', 'update')
  const [team, terminationReasons, activity, vaCounts, names] = await Promise.all([
    canAssign ? listCsTeam() : Promise.resolve([]),
    settingOptions('TerminationReason'),
    prisma.activityLog.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    startedVaCountsByCustomer(prisma, [id]),
    staffNames([customer.assignedSpecialistEmail ?? '', customer.reviewRequestedByEmail ?? '', ...customer.takeovers.map((t) => t.specialistEmail)]),
  ])
  const nameOf = (email: string | null) => (email ? (names.get(email) ?? email) : null)

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <CustomerDetail
        customer={customer}
        role={user.role}
        senderName={displayName(user)}
        from="customers"
        cms={{
          canEdit: can(user.role, 'customers', 'update'),
          canAssign,
          canReview: can(user.role, 'approvals', 'update'),
          reviewed: needsStatusReview(user.role),
          team: team.map((m) => ({ email: m.email, name: m.name })),
          specialistName: nameOf(customer.assignedSpecialistEmail),
          reviewByName: nameOf(customer.reviewRequestedByEmail),
          terminationReasons,
          warnings: customerWarnings(customer, vaCounts ? (vaCounts.get(id) ?? 0) : null),
          activity,
          takeovers: customer.takeovers
            .map((t) => ({ id: t.id, specialistName: nameOf(t.specialistEmail) ?? t.specialistEmail, startDate: t.startDate, endDate: t.endDate, state: takeoverState(t) }))
            .filter((t) => t.state === 'ACTIVE' || t.state === 'UPCOMING'),
        }}
      />
    </main>
  )
}
