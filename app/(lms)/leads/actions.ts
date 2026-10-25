'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActor } from '@/lib/auth'
import { findCustomerMatches, generateCustomerCode } from '@/lib/customers'
import { linkExpiry, newLinkToken } from '@/lib/onboarding'
import { newLeadSchema, type ActionResult, type CustomerMatch, type NewLeadInput } from '@/lib/customer-fields'
import { REQUEST_GROUPS, type RequestGroup } from '@/lib/onboarding-fields'

const NO_ACCESS = "You don't have permission to use Lead Management."

// A new lead is a customer in Pending status, with its first status log row.
// On success it redirects to the lead's page from the server: a client-side
// router.push raced the revalidation refresh and could land back on the board.
export async function createLead(input: NewLeadInput): Promise<ActionResult> {
  const actor = await getActor('leads')
  if (!actor) return { ok: false, error: NO_ACCESS }

  const parsed = newLeadSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { name, email, notes } = parsed.data
  const customerCode = await generateCustomerCode()

  const customer = await prisma.customer.create({
    data: {
      customerCode,
      name,
      email,
      notes,
      status: 'PENDING',
      createdById: actor.id,
      createdByEmail: actor.email,
      statusLogs: {
        create: { fromStatus: null, toStatus: 'PENDING', changedById: actor.id, changedByEmail: actor.email },
      },
    },
    select: { id: true },
  })

  revalidatePath('/leads')
  revalidatePath('/customers')
  redirect(`/leads/${customer.id}`)
}

// Makes the prefilled onboarding link. Any older open link for the same
// customer stops working, so only the newest one is ever live.
export async function createOnboardingLink(customerId: string): Promise<ActionResult> {
  const actor = await getActor('leads')
  if (!actor) return { ok: false, error: NO_ACCESS }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { status: true, _count: { select: { submissions: true } } },
  })
  if (!customer) return { ok: false, error: 'That customer no longer exists.' }
  if (customer._count.submissions > 0) return { ok: false, error: 'This customer has already submitted the onboarding form.' }
  if (customer.status !== 'PENDING') return { ok: false, error: 'Onboarding links are only for Pending customers.' }

  const now = new Date()
  await prisma.$transaction([
    prisma.onboardingLink.updateMany({
      where: { customerId, revokedAt: null, submittedAt: null },
      data: { revokedAt: now },
    }),
    prisma.onboardingLink.create({
      data: { customerId, token: newLinkToken(), createdByEmail: actor.email, expiresAt: linkExpiry(now) },
    }),
  ])

  revalidatePath(`/leads/${customerId}`)
  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/leads')
  return { ok: true, data: null }
}

export async function searchCustomerMatches(name: string): Promise<CustomerMatch[]> {
  if (!(await getActor('leads'))) return []
  return findCustomerMatches(name)
}

// Lead Management decides each VA request's hiring group (Regular unless
// changed), since it affects how the VA is hired.
export async function setRequestGroup(requestId: string, group: string): Promise<ActionResult> {
  const actor = await getActor('leads')
  if (!actor) return { ok: false, error: NO_ACCESS }
  if (!REQUEST_GROUPS.includes(group as RequestGroup)) return { ok: false, error: 'Choose Regular, Expert or Casual.' }

  const request = await prisma.ticketRequest.findUnique({ where: { id: requestId }, select: { ticket: { select: { customerId: true } } } })
  if (!request) return { ok: false, error: 'That request no longer exists.' }

  await prisma.ticketRequest.update({
    where: { id: requestId },
    data: { requestGroup: group as RequestGroup, requestGroupSetBy: actor.email },
  })
  revalidatePath(`/leads/${request.ticket.customerId}`)
  revalidatePath(`/customers/${request.ticket.customerId}`)
  return { ok: true, data: null }
}
