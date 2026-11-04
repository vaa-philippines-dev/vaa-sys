import { notFound } from 'next/navigation'
import { CustomerDetail } from '@/components/customers/CustomerDetail'
import { LeadWorkflow } from '@/components/leads/LeadWorkflow'
import { requireArea, displayName } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { getCustomer } from '@/lib/customers'
import { contractChoices } from '@/lib/contracts'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [user, customer, choices] = await Promise.all([requireArea('leads', `/leads/${id}`), getCustomer(id), contractChoices()])
  if (!customer) notFound()
  const senderName = displayName(user)
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <CustomerDetail
        customer={customer}
        role={user.role}
        senderName={senderName}
        from="leads"
        workflow={<LeadWorkflow customer={customer} choices={choices} senderName={senderName} canEdit={can(user.role, 'leads', 'update')} />}
      />
    </main>
  )
}
