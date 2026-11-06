import { REGIONS, subTicketCode, ticketCode } from '@/lib/onboarding-fields'
import type { ContactEdit, EditableAccount } from '@/lib/account-details-fields'
import type { getCustomer } from '@/lib/customers'

// Server side of the Details editor: an account (as getCustomer or
// getAccount loads it) as plain data for the client forms.

type Account = NonNullable<Awaited<ReturnType<typeof getCustomer>>>['accounts'][number]
type Contact = Account['contacts'][number]

const num = (v: unknown) => (v == null ? null : Number(v))
const region = (r: string | null) => ((REGIONS as readonly string[]).includes(r ?? '') ? (r as ContactEdit['region']) : '')

const contact = (c: Contact | undefined): ContactEdit | null =>
  c ? { firstName: c.firstName, lastName: c.lastName, role: c.role ?? '', email: c.email, whatsapp: c.whatsapp ?? '', region: region(c.region) } : null

export function editableAccount(a: Pick<Account, 'id' | 'accountCode' | 'name' | 'companyName' | 'dbaName' | 'businessAddress' | 'website' | 'timeZone' | 'platforms' | 'platformOther' | 'otherInfo' | 'invoiceContactSource' | 'invoiceContactName' | 'invoiceContactRole' | 'invoiceContactEmail' | 'paymentMethod' | 'paymentMethodOther' | 'billingCountry' | 'hasPayoneerOrWise' | 'contacts' | 'tickets'>): EditableAccount {
  const primary = a.contacts.find((c) => c.kind === 'PRIMARY')
  const secondary = a.contacts.find((c) => c.kind === 'SECONDARY')
  return {
    id: a.id,
    code: a.accountCode,
    name: a.name,
    details: {
      companyName: a.companyName,
      dbaName: a.dbaName ?? '',
      businessAddress: a.businessAddress ?? '',
      website: a.website ?? '',
      timeZone: a.timeZone ?? '',
      platforms: (a.platforms ?? []) as EditableAccount['details']['platforms'],
      platformOther: a.platformOther ?? '',
      otherInfo: a.otherInfo ?? '',
      invoiceSource: a.invoiceContactSource,
      invoiceName: a.invoiceContactName ?? '',
      invoiceRole: a.invoiceContactRole ?? '',
      invoiceEmail: a.invoiceContactEmail ?? '',
      paymentMethod: a.paymentMethod,
      paymentMethodOther: a.paymentMethodOther ?? '',
      billingCountry: a.billingCountry ?? '',
      hasPayoneerOrWise: a.hasPayoneerOrWise,
      primary: contact(primary),
      secondary: contact(secondary),
      focal: primary?.isFocal ? 'PRIMARY' : secondary?.isFocal ? 'SECONDARY' : 'NONE',
    },
    tickets: a.tickets.map((t) => ({
      id: t.id,
      code: ticketCode(t.ticketNumber),
      requests: t.requests.map((r) => ({
        id: r.id,
        code: subTicketCode(t.ticketNumber, r.lineNo),
        service: r.service,
        numberOfVas: r.numberOfVas,
        scheduleType: r.scheduleType,
        hoursPerDay: num(r.hoursPerDay),
        hoursPerWeek: num(r.hoursPerWeek),
        hoursPerMonth: num(r.hoursPerMonth),
        projectHours: num(r.projectHours),
        startTimePht: r.startTimePht ?? '',
        endTimePht: r.endTimePht ?? '',
        workDays: r.workDays as EditableAccount['tickets'][number]['requests'][number]['workDays'],
        nightDifferential: r.nightDifferential,
        additionalHours: r.additionalHours ?? '',
        targetStartDate: r.targetStartDate.toISOString().slice(0, 10),
        tasks: r.tasks ?? '',
        tools: r.tools ?? '',
        taskTracker: r.taskTracker,
      })),
    })),
  }
}
