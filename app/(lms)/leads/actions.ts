'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActor, getActorFor } from '@/lib/auth'
import { fieldChanges, logActivity } from '@/lib/activity'
import { findCustomerMatches, generateCustomerCode } from '@/lib/customers'
import { syncLeadPhase } from '@/lib/lead-phase'
import { linkExpiry, newLinkToken } from '@/lib/onboarding'
import { dateOnly, manilaToday, newLeadSchema, type ActionResult, type CustomerMatch, type NewLeadInput } from '@/lib/customer-fields'
import { confirmContractSchema, PHASE_LABELS, REQUEST_TYPES, REQUEST_TYPE_LABELS, type ConfirmContractInput, type LeadPhase, type LeadRequestType } from '@/lib/lead-phase-fields'
import { REQUEST_GROUPS, type RequestGroup } from '@/lib/onboarding-fields'
import { addTestLead, sampleOnboarding } from '@/lib/test-leads'
import { deleteLead } from '@/lib/lead-delete'
import { assertCustomerInScope } from '@/lib/scope'
import { createInitialDraft, discardDraft, saveDraft, sendBill } from '@/lib/billing'
import type { DraftBillInput } from '@/lib/billing-fields'
import { submitOnboarding } from '@/app/onboarding/[token]/actions'

const NO_ACCESS = "You don't have permission to use Lead Management."

function refreshLead(customerId: string) {
  revalidatePath('/leads')
  revalidatePath(`/leads/${customerId}`)
  revalidatePath(`/customers/${customerId}`)
}

// The lead's workflow facts, and the account its contract is picked for:
// the one made from the onboarding form. An imported lead has no account,
// so its contract is kept on the customer (customers.contract_id).
async function leadForWorkflow(customerId: string) {
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      name: true,
      leadPhase: true,
      requestType: true,
      intakeCompletedAt: true,
      contractId: true,
      contractSentAt: true,
      contractConfirmedAt: true,
      handoffCompletedAt: true,
      paymentDate: true,
      noPaymentYet: true,
      submissions: { orderBy: { submittedAt: 'desc' }, take: 1, select: { account: { select: { id: true, name: true, accountCode: true, contractId: true } } } },
    },
  })
}

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

// Admins: a test lead with a sample onboarding form (lib/test-leads.ts),
// submitted through the public form's own action so it is saved exactly as a
// customer's would be. Like createLead, it redirects from the server.
export async function createTestLead(): Promise<ActionResult> {
  const actor = await getActorFor('testLeads', 'create')
  if (!actor) return { ok: false, error: 'Only admins can add test leads.' }

  const { id, n, token } = await addTestLead(actor)
  const submitted = await submitOnboarding(token, sampleOnboarding(n))
  revalidatePath('/leads')
  revalidatePath('/customers')
  if (!submitted.ok) return { ok: false, error: `Test Lead ${n} was added, but its sample form couldn’t be saved: ${submitted.error}` }
  redirect(`/leads/${id}`)
}

// Admins: deletes a lead and everything attached to it, for good. A real
// lead needs its name typed back and no payments recorded (lib/lead-delete.ts).
export async function removeLead(customerId: string, typedName: string): Promise<ActionResult> {
  const actor = await getActorFor('leads', 'delete')
  if (!actor) return { ok: false, error: 'Only admins can delete leads.' }
  const result = await deleteLead(actor, customerId, typedName)
  if (!result.ok) return result
  revalidatePath('/leads')
  revalidatePath('/customers')
  revalidatePath('/accounting')
  redirect('/leads')
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

// ── Lead workflow (lib/lead-phase.ts) ─────────────────────────────
// Each action changes one fact and lets syncLeadPhase move the phase, in
// the same transaction as the change and its activity log.

// Contract & Billing Initiation: which contract applies to the lead's
// account. This is the account's own contract (accounts.contract_id), the
// same one Customer Management shows.
export async function setLeadContract(customerId: string, contractId: string): Promise<ActionResult> {
  const actor = await getActorFor('leads', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const lead = await leadForWorkflow(customerId)
  if (!lead) return { ok: false, error: 'That lead no longer exists.' }
  const account = lead.submissions[0]?.account
  if (!account && !lead.intakeCompletedAt) return { ok: false, error: 'The contract is picked once the customer has submitted the onboarding form.' }
  if (lead.contractConfirmedAt) return { ok: false, error: 'The contract is already confirmed. Change it on the account’s page in Customer Management.' }
  const contract = contractId ? await prisma.contract.findUnique({ where: { id: contractId }, select: { id: true, isActive: true } }) : null
  if (contractId && (!contract || !contract.isActive)) return { ok: false, error: 'Pick a contract from the list.' }
  const currentId = account ? account.contractId : lead.contractId
  if ((currentId ?? '') === contractId) return { ok: true, data: null }

  await prisma.$transaction(async (tx) => {
    const next = { contractId: contractId || null }
    if (account) await tx.account.update({ where: { id: account.id }, data: next })
    else await tx.customer.update({ where: { id: customerId }, data: next })
    const base = account
      ? { entityType: 'Account', entityId: account.id, entityLabel: `${account.name} (${account.accountCode})`, customerId }
      : { entityType: 'Customer', entityId: customerId, entityLabel: lead.name, customerId }
    await logActivity(
      tx,
      actor,
      fieldChanges(base, { contractId: currentId }, next).map((c) => ({ ...c, action: 'CONTRACT_ASSIGNED' }))
    )
  })
  refreshLead(customerId)
  return { ok: true, data: null }
}

// The Lead Manager sent the generated contract email. Sending it again
// (say, after picking another contract) records the latest send.
export async function markContractSent(customerId: string): Promise<ActionResult<{ phase: LeadPhase }>> {
  const actor = await getActorFor('leads', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const lead = await leadForWorkflow(customerId)
  if (!lead) return { ok: false, error: 'That lead no longer exists.' }
  const account = lead.submissions[0]?.account
  if (!account && !lead.intakeCompletedAt) return { ok: false, error: 'The contract is sent once the customer has submitted the onboarding form.' }
  const contractId = account ? account.contractId : lead.contractId
  if (!contractId) return { ok: false, error: 'Pick the contract first.' }
  if (lead.contractConfirmedAt) return { ok: false, error: 'The contract is already confirmed.' }

  const now = new Date()
  const phase = await prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId }, select: { contractCode: true, name: true } })
    await tx.customer.update({ where: { id: customerId }, data: { contractSentAt: now, contractSentByEmail: actor.email.toLowerCase(), contractSentId: contractId } })
    await logActivity(tx, actor, {
      entityType: 'Customer',
      entityId: customerId,
      entityLabel: lead.name,
      customerId,
      action: 'CONTRACT_SENT',
      newValue: `${contract.name} (${contract.contractCode})`,
    })
    return syncLeadPhase(tx, actor, customerId, `Contract sent (${contract.contractCode})`, now)
  })
  refreshLead(customerId)
  return { ok: true, data: { phase } }
}

// Regular ↔ Special Request. A Special Request (the customer meets the VA
// first, approved by the CEO outside the app) goes to Customer Success
// Handoff now and has its contract and payment confirmed afterwards. It is
// chosen in Contract & Billing Initiation only (before the contract goes
// out); a Special Request can go back to Regular while it waits in Customer
// Success Handoff.
export async function setLeadRequestType(customerId: string, requestType: string): Promise<ActionResult<{ phase: LeadPhase }>> {
  const actor = await getActorFor('leads', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  if (!REQUEST_TYPES.includes(requestType as LeadRequestType)) return { ok: false, error: 'Choose Regular Request or Special Request.' }
  const type = requestType as LeadRequestType
  const lead = await leadForWorkflow(customerId)
  if (!lead) return { ok: false, error: 'That lead no longer exists.' }
  if (lead.requestType === type) return { ok: true, data: { phase: lead.leadPhase } }
  if (lead.handoffCompletedAt) return { ok: false, error: 'The customer has already been onboarded by the CS team, so the request type can’t change.' }
  if (type === 'SPECIAL' && lead.leadPhase !== 'CONTRACT_BILLING_INITIATION')
    return { ok: false, error: `A Special Request can only be chosen in ${PHASE_LABELS.CONTRACT_BILLING_INITIATION}, not in ${PHASE_LABELS[lead.leadPhase]}.` }
  if (type === 'REGULAR' && lead.leadPhase !== 'CUSTOMER_SUCCESS_HANDOFF')
    return { ok: false, error: `A Special Request can only go back to Regular in ${PHASE_LABELS.CUSTOMER_SUCCESS_HANDOFF}, not in ${PHASE_LABELS[lead.leadPhase]}.` }

  const phase = await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { requestType: type } })
    await logActivity(tx, actor, {
      entityType: 'Customer',
      entityId: customerId,
      entityLabel: lead.name,
      customerId,
      action: 'REQUEST_TYPE_CHANGED',
      field: 'requestType',
      oldValue: REQUEST_TYPE_LABELS[lead.requestType],
      newValue: REQUEST_TYPE_LABELS[type],
    })
    return syncLeadPhase(tx, actor, customerId, `Switched to ${REQUEST_TYPE_LABELS[type]}`)
  })
  refreshLead(customerId)
  return { ok: true, data: { phase } }
}

// ── Initial bill (lib/billing.ts) ─────────────────────────────────
// The Lead Manager prepares it in Contract & Billing Initiation from the
// lead's service requests, adjusts it, and marks it sent; Accounting sees it
// in the Accounting System and records the payments.

function refreshBill(customerId: string) {
  refreshLead(customerId)
  revalidatePath('/accounting', 'layout')
}

// The bill actions take a lead's id, so they check its scope like every
// action on a customer (CLAUDE.md). The Lead Manager sees every lead today;
// this keeps it safe if the grant ever goes to a scoped role.
async function billActor(customerId: string) {
  const actor = await getActorFor('leads', 'update')
  return actor && (await assertCustomerInScope(actor, customerId)) ? actor : null
}

export async function prepareInitialBill(customerId: string): Promise<ActionResult> {
  const actor = await billActor(customerId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const result = await createInitialDraft(actor, customerId)
  if (!result.ok) return result
  refreshBill(customerId)
  return { ok: true, data: null }
}

export async function saveInitialBill(customerId: string, invoiceId: string, input: DraftBillInput): Promise<ActionResult<{ total: number }>> {
  const actor = await billActor(customerId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const result = await saveDraft(actor, customerId, invoiceId, input)
  if (result.ok) refreshBill(customerId)
  return result
}

// Saves the draft as it is on screen, then marks it sent.
export async function sendInitialBill(customerId: string, invoiceId: string, input: DraftBillInput): Promise<ActionResult> {
  const actor = await billActor(customerId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const saved = await saveDraft(actor, customerId, invoiceId, input)
  if (!saved.ok) return saved
  const result = await sendBill(actor, customerId, invoiceId)
  refreshBill(customerId)
  return result
}

export async function discardInitialBill(customerId: string, invoiceId: string): Promise<ActionResult> {
  const actor = await billActor(customerId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const result = await discardDraft(actor, customerId, invoiceId)
  if (result.ok) refreshBill(customerId)
  return result
}

// Contract & Payment Confirmation: the customer signed and paid. The first
// payment is the customer's own paymentDate, as on Customer Management.
export async function confirmContractPayment(customerId: string, input: ConfirmContractInput): Promise<ActionResult<{ phase: LeadPhase }>> {
  const actor = await getActorFor('leads', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = confirmContractSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { signedOn, paymentDate } = parsed.data
  const today = manilaToday()
  if (signedOn > today || paymentDate > today) return { ok: false, error: 'The dates can’t be in the future.' }

  const lead = await leadForWorkflow(customerId)
  if (!lead) return { ok: false, error: 'That lead no longer exists.' }
  if (!lead.contractSentAt) return { ok: false, error: 'Send the contract first.' }
  if (lead.contractConfirmedAt) return { ok: false, error: 'The contract and payment are already confirmed.' }

  const now = new Date()
  const phase = await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        contractSignedOn: dateOnly(signedOn),
        contractConfirmedAt: now,
        contractConfirmedByEmail: actor.email.toLowerCase(),
        paymentDate: dateOnly(paymentDate),
        noPaymentYet: false,
      },
    })
    const base = { entityType: 'Customer', entityId: customerId, entityLabel: lead.name, customerId }
    await logActivity(tx, actor, [
      { ...base, action: 'CONTRACT_CONFIRMED', notes: `Signed ${signedOn}, first payment ${paymentDate}` },
      ...fieldChanges(base, { noPaymentYet: lead.noPaymentYet, paymentDate: lead.paymentDate }, { noPaymentYet: false, paymentDate: dateOnly(paymentDate) }),
    ])
    return syncLeadPhase(tx, actor, customerId, 'Contract and payment confirmed', now)
  })
  refreshLead(customerId)
  return { ok: true, data: { phase } }
}
