import { notFound } from 'next/navigation'
import { CustomerDetail } from '@/components/customers/CustomerDetail'
import { requireArea, displayName } from '@/lib/auth'
import { getCustomer } from '@/lib/customers'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [user, customer] = await Promise.all([requireArea('leads', `/leads/${id}`), getCustomer(id)])
  if (!customer) notFound()
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <CustomerDetail customer={customer} role={user.role} senderName={displayName(user)} from="leads" />
    </main>
  )
}
