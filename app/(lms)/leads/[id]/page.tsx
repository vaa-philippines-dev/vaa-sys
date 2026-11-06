import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarClock } from 'lucide-react'
import { LeadDetail } from '@/components/leads/LeadDetail'
import { requireArea, displayName } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { getCustomer } from '@/lib/customers'
import { contractChoices } from '@/lib/contracts'
import { staffNames } from '@/lib/workforce'
import { getBillingDefaults, getInitialBill, voidedInitialBills } from '@/lib/billing'
import { initialBillView } from '@/lib/billing-view'
import { isStillLead } from '@/lib/lead-delete'
import { listScheduleChanges } from '@/lib/request-schedule'
import { CHANGE_KIND_LABELS, REVIEWER, changeText } from '@/lib/request-schedule-fields'
import { subTicketCode } from '@/lib/onboarding-fields'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [user, customer, choices] = await Promise.all([requireArea('leads', `/leads/${id}`), getCustomer(id), contractChoices()])
  if (!customer) notFound()
  const [names, bill, voided, defaults, changes] = await Promise.all([
    staffNames([customer.createdByEmail]),
    getInitialBill(id),
    voidedInitialBills(id),
    getBillingDefaults(),
    // A request's schedule changed after the onboarding form: the bill may need redoing (Nov 6, 2026).
    can(user.role, 'scheduleReviews') ? listScheduleChanges(user, { show: 'waiting', customerId: id }).catch(() => []) : Promise.resolve([]),
  ])
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      {changes.length > 0 && (
        <section role="status" className="space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CalendarClock className="h-4 w-4 text-warning" />
            {changes.length === 1 ? 'A VA request changed' : `${changes.length} changes to VA requests`} after the onboarding form. This affects the bill.
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            {changes.map((c) => (
              <li key={c.id}>
                <span className="font-mono text-xs">{subTicketCode(c.ticket.ticketNumber, c.request.lineNo)}</span> {c.request.service}: {(CHANGE_KIND_LABELS[c.kind] ?? c.kind).toLowerCase()} now{' '}
                <span className="text-foreground">{changeText(c.kind, c.after)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Waiting for {REVIEWER} to check.{' '}
            <Link href="/leads/schedule-changes" className="text-primary underline-offset-2 hover:underline">
              Schedule changes
            </Link>
          </p>
        </section>
      )}
      <LeadDetail
        customer={customer}
        choices={choices}
        senderName={displayName(user)}
        canEdit={can(user.role, 'leads', 'update')}
        // Only a record that's still a lead (or a test lead) can be deleted here.
        canDelete={can(user.role, 'leads', 'delete') && (customer.isTest || isStillLead(customer))}
        addedByName={names.get(customer.createdByEmail.toLowerCase()) ?? customer.createdByEmail}
        bill={initialBillView(bill, voided, defaults, can(user.role, 'billing'))}
      />
    </main>
  )
}
