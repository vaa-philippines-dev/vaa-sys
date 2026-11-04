import { notFound } from 'next/navigation'
import { LeadDetail } from '@/components/leads/LeadDetail'
import { requireArea, displayName } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { getCustomer } from '@/lib/customers'
import { contractChoices } from '@/lib/contracts'
import { staffNames } from '@/lib/workforce'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [user, customer, choices] = await Promise.all([requireArea('leads', `/leads/${id}`), getCustomer(id), contractChoices()])
  if (!customer) notFound()
  const names = await staffNames([customer.createdByEmail])
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <LeadDetail
        customer={customer}
        choices={choices}
        senderName={displayName(user)}
        canEdit={can(user.role, 'leads', 'update')}
        canDeleteTest={can(user.role, 'testLeads', 'delete')}
        addedByName={names.get(customer.createdByEmail.toLowerCase()) ?? customer.createdByEmail}
      />
    </main>
  )
}
