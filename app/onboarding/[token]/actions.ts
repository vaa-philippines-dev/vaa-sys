'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { findLink, listServices } from '@/lib/onboarding'
import { generateAccountCode } from '@/lib/customers'
import { firstIssue, nightDifferentialHours, onboardingSchema, shiftHours, type OnboardingInput, type VaRequest } from '@/lib/onboarding-fields'
import type { ActionResult } from '@/lib/customer-fields'

// Public: whoever holds the link token may submit once. There is no session;
// the token is the authorization. Nothing here reveals anything beyond the
// link's own customer name and ID.
//
// One submission makes, in a single transaction:
// - the raw OnboardingSubmission (exactly what was sent),
// - the customer's Account with its contacts (Part 1),
// - a main Ticket with one sub-ticket per VA request (Part 2).
export async function submitOnboarding(token: string, input: OnboardingInput): Promise<ActionResult> {
  const { state, link } = await findLink(token)
  if (!link) return { ok: false, error: 'This link isn’t valid. Please use the link from your email.' }
  if (state === 'SUBMITTED') return { ok: false, error: 'This form has already been submitted. Thank you!' }
  if (state !== 'OPEN') return { ok: false, error: 'This link has expired. Please reply to our email and we’ll send you a new one.' }

  const parsed = onboardingSchema.safeParse(input)
  if (!parsed.success) {
    const inPart2 = parsed.error.issues[0]?.path[0] === 'part2'
    return { ok: false, error: firstIssue(parsed.error, inPart2 ? 'VA request' : '') }
  }
  const { part1, part2 } = parsed.data

  const services = await listServices()
  const unknown = part2.requests.find((r) => !services.includes(r.service))
  if (unknown) return { ok: false, error: `“${unknown.service}” isn’t one of our services. Please choose from the list.` }

  const invoiceContact =
    part1.invoice.source === 'PRIMARY'
      ? { name: `${part1.primary.firstName} ${part1.primary.lastName}`, email: part1.primary.email }
      : part1.invoice.source === 'SECONDARY'
        ? { name: `${part1.secondary.firstName} ${part1.secondary.lastName}`, email: part1.secondary.email }
        : { name: part1.invoice.name, email: part1.invoice.email }

  const accountCode = await generateAccountCode()
  const now = new Date()

  try {
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: link.customerId }, select: { name: true } })

      const account = await tx.account.create({
        data: {
          accountCode,
          customerId: link.customerId,
          // The first account is named after the customer (Oct 21 meeting).
          name: customer.name,
          companyName: part1.company.companyName,
          dbaName: part1.company.dbaName || null,
          website: part1.company.website || null,
          timeZone: part1.company.timeZone || null,
          invoiceContactSource: part1.invoice.source,
          invoiceContactName: invoiceContact.name,
          invoiceContactEmail: invoiceContact.email.toLowerCase(),
          paymentMethod: part1.payment.method,
          billingCountry: part1.payment.billingCountry || null,
          contacts: {
            create: [
              {
                kind: 'PRIMARY',
                firstName: part1.primary.firstName,
                lastName: part1.primary.lastName,
                role: part1.primary.role,
                email: part1.primary.email.toLowerCase(),
                whatsapp: part1.primary.whatsapp,
                region: part1.primary.region,
                isFocal: part1.focalContact === 'PRIMARY',
              },
              ...(part1.hasSecondary
                ? [
                    {
                      kind: 'SECONDARY' as const,
                      firstName: part1.secondary.firstName,
                      lastName: part1.secondary.lastName,
                      role: part1.secondary.role || null,
                      email: part1.secondary.email.toLowerCase(),
                      whatsapp: part1.secondary.whatsapp || null,
                      isFocal: part1.focalContact === 'SECONDARY',
                    },
                  ]
                : []),
            ],
          },
        },
        select: { id: true },
      })

      const submission = await tx.onboardingSubmission.create({
        data: { linkId: link.id, customerId: link.customerId, accountId: account.id, part1, part2, submittedAt: now },
        select: { id: true },
      })

      await tx.ticket.create({
        data: {
          customerId: link.customerId,
          accountId: account.id,
          submissionId: submission.id,
          createdByEmail: 'onboarding-form',
          requests: { create: part2.requests.map((r, i) => requestRow(r, i + 1)) },
        },
      })

      await tx.onboardingLink.update({ where: { id: link.id }, data: { submittedAt: now } })
      // Keep the lead's email if Lead Management didn't have one yet.
      await tx.customer.updateMany({ where: { id: link.customerId, email: null }, data: { email: part1.primary.email.toLowerCase() } })
    })
  } catch (err) {
    // A double click lands here: the link already has its one submission.
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return { ok: false, error: 'This form has already been submitted. Thank you!' }
    }
    console.error('[submitOnboarding]', err)
    return { ok: false, error: 'We couldn’t save your form. Please try again in a minute.' }
  }

  revalidatePath('/leads')
  revalidatePath(`/leads/${link.customerId}`)
  revalidatePath(`/customers/${link.customerId}`)
  return { ok: true, data: null }
}

// One VA request as a sub-ticket row. Hours are stored per schedule type;
// a fixed shift's hours and night differential are worked out from its times.
function requestRow(r: VaRequest, lineNo: number) {
  const fixed = r.scheduleType === 'DAILY_FIXED'
  const [y, m, d] = r.targetStartDate.split('-').map(Number)
  return {
    lineNo,
    platform: r.platform,
    service: r.service,
    numberOfVas: r.numberOfVas,
    scheduleType: r.scheduleType,
    hoursPerWeek: r.scheduleType === 'WEEKLY_FLEXIBLE' ? r.hoursPerWeek : null,
    hoursPerDay: r.scheduleType === 'DAILY_FLEXIBLE' ? r.hoursPerDay : fixed ? shiftHours(r.startTimePht, r.endTimePht) : null,
    startTimePht: fixed ? r.startTimePht : null,
    endTimePht: fixed ? r.endTimePht : null,
    workDays: r.scheduleType === 'WEEKLY_FLEXIBLE' ? [] : r.workDays,
    nightDifferential: fixed && nightDifferentialHours(r.startTimePht, r.endTimePht) > 0,
    additionalHoursPerDay: r.scheduleType === 'WEEKLY_FLEXIBLE' ? null : r.additionalHoursPerDay,
    // Date.UTC, never new Date('YYYY-MM-DD') parsing in local time.
    targetStartDate: new Date(Date.UTC(y, m - 1, d)),
    tasks: r.tasks,
    tools: r.tools || null,
  }
}
