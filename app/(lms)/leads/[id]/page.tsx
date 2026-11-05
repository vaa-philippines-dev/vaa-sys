import { notFound } from 'next/navigation'
import { LeadDetail } from '@/components/leads/LeadDetail'
import { requireArea, displayName } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { getCustomer } from '@/lib/customers'
import { contractChoices } from '@/lib/contracts'
import { staffNames } from '@/lib/workforce'
import { getBillingDefaults, getInitialBill, voidedInitialBills } from '@/lib/billing'
import { initialBillView } from '@/lib/billing-view'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [user, customer, choices] = await Promise.all([requireArea('leads', `/leads/${id}`), getCustomer(id), contractChoices()])
  if (!customer) notFound()
  const [names, bill, voided, defaults] = await Promise.all([staffNames([customer.createdByEmail]), getInitialBill(id), voidedInitialBills(id), getBillingDefaults()])
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <LeadDetail
        customer={customer}
        choices={choices}
        senderName={displayName(user)}
        canEdit={can(user.role, 'leads', 'update')}
        canDelete={can(user.role, 'leads', 'delete')}
        addedByName={names.get(customer.createdByEmail.toLowerCase()) ?? customer.createdByEmail}
        bill={initialBillView(bill, voided, defaults, can(user.role, 'billing'))}
      />
    </main>
  )
}
