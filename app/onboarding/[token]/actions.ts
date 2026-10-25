'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { findLink } from '@/lib/onboarding'
import { generateAccountCode } from '@/lib/customers'
import { firstIssue, nightDifferentialHours, onboardingSchema, part3AnswersSchema, shiftHours, type OnboardingInput, type Part3Answers, type VaRequest } from '@/lib/onboarding-fields'
import type { ActionResult } from '@/lib/customer-fields'

// Public: whoever holds the link token may submit once. There is no session;
// the token is the authorization. Nothing here reveals anything beyond the
// link's own customer name and ID.
//
// One submission makes, in a single transaction:
// - the raw OnboardingSubmission (exactly what was sent),
// - the customer's Account with its contacts (Part 1),
// - a main Ticket with one sub-ticket per VA request (Part 2),
// - Part 3 answers on the submission, if the customer filled them in now.
export async function submitOnboarding(token: string, input: OnboardingInput): Promise<ActionResult> {
  const { state, link } = await findLink(token)
  if (!link) return { ok: false, error: 'This link isn’t valid. Please use the link from your email.' }
  if (state === 'SUBMITTED' || state === 'PART3_OPEN') return { ok: false, error: 'This form has already been submitted. Thank you!' }
  if (state !== 'OPEN') return { ok: false, error: 'This link has expired. Please reply to our email and we’ll send you a new one.' }

  const parsed = onboardingSchema.safeParse(input)
  if (!parsed.success) {
    const inPart2 = parsed.error.issues[0]?.path[0] === 'part2'
    return { ok: false, error: firstIssue(parsed.error, inPart2 ? 'VA service' : '') }
  }
  const { part1, part2, part3 } = parsed.data

  const invoiceContact =
    part1.invoice.source === 'PRIMARY'
      ? { name: `${part1.primary.firstName} ${part1.primary.lastName}`, role: part1.primary.role, email: part1.primary.email }
      : part1.invoice.source === 'SECONDARY'
        ? { name: `${part1.secondary.firstName} ${part1.secondary.lastName}`, role: part1.secondary.role, email: part1.secondary.email }
        : { name: [part1.invoice.firstName, part1.invoice.lastName].filter(Boolean).join(' '), role: part1.invoice.role, email: part1.invoice.email }
  const business = part1.business

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
          businessAddress: part1.company.businessAddress,
          website: part1.company.website || null,
          timeZone: part1.company.timeZone || null,
          platforms: business.platforms,
          platformOther: business.platforms.includes('Other') ? business.platformOther : null,
          otherInfo: business.otherInfo || null,
          invoiceContactSource: part1.invoice.source,
          invoiceContactName: invoiceContact.name,
          invoiceContactRole: invoiceContact.role || null,
          invoiceContactEmail: invoiceContact.email.toLowerCase(),
          hasPayoneerOrWise: part1.primary.region === 'Israel' ? null : part1.payment.hasPayoneerOrWise,
          paymentMethod: part1.payment.method,
          paymentMethodOther: part1.payment.method === 'OTHER' ? part1.payment.methodOther : null,
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
        data: {
          linkId: link.id,
          customerId: link.customerId,
          accountId: account.id,
          part1,
          part2,
          ...(part3.completeNow ? { part3: part3.answers, part3SubmittedAt: now } : {}),
          submittedAt: now,
        },
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
// The platform now lives on the account, so new rows leave it empty.
function requestRow(r: VaRequest, lineNo: number) {
  const fixed = r.scheduleType === 'DAILY_FIXED'
  const daily = fixed || r.scheduleType === 'DAILY_FLEXIBLE'
  const [y, m, d] = r.targetStartDate.split('-').map(Number)
  return {
    lineNo,
    service: r.service,
    numberOfVas: r.numberOfVas,
    scheduleType: r.scheduleType,
    hoursPerWeek: r.scheduleType === 'WEEKLY_FLEXIBLE' ? r.hoursPerWeek : null,
    hoursPerDay: r.scheduleType === 'DAILY_FLEXIBLE' ? r.hoursPerDay : fixed ? shiftHours(r.startTimePht, r.endTimePht) : null,
    projectHours: r.scheduleType === 'PROJECT' ? r.projectHours : null,
    startTimePht: fixed ? r.startTimePht : null,
    endTimePht: fixed ? r.endTimePht : null,
    workDays: daily ? r.workDays : [],
    nightDifferential: fixed && nightDifferentialHours(r.startTimePht, r.endTimePht) > 0,
    additionalHours: r.additionalHours || null,
    // Date.UTC, never new Date('YYYY-MM-DD') parsing in local time.
    targetStartDate: new Date(Date.UTC(y, m - 1, d)),
    tasks: r.tasks,
    tools: r.tools || null,
  }
}

// Part 3 on its own, for a customer who skipped it when they first submitted.
export async function submitPart3(token: string, answers: Part3Answers): Promise<ActionResult> {
  const { state, link } = await findLink(token)
  if (!link) return { ok: false, error: 'This link isn’t valid. Please use the link from your email.' }
  if (state === 'SUBMITTED') return { ok: false, error: 'Your VA personality preferences are already in. Thank you!' }
  if (state !== 'PART3_OPEN' || !link.submission) return { ok: false, error: 'This link can’t be used for this form. Please reply to our email.' }

  const parsed = part3AnswersSchema.safeParse(answers)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  // Only the first Part 3 counts, so a double click can't overwrite it.
  const { count } = await prisma.onboardingSubmission.updateMany({
    where: { id: link.submission.id, part3SubmittedAt: null },
    data: { part3: parsed.data, part3SubmittedAt: new Date() },
  })
  if (count === 0) return { ok: false, error: 'Your VA personality preferences are already in. Thank you!' }

  revalidatePath(`/leads/${link.customerId}`)
  revalidatePath(`/customers/${link.customerId}`)
  return { ok: true, data: null }
}
