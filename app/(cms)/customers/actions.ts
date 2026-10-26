'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getActorFor } from '@/lib/auth'
import { logActivity, fieldChanges } from '@/lib/activity'
import { assertCustomerInScope } from '@/lib/scope'
import { changeCustomerStatus as applyCustomerStatus, StatusError } from '@/lib/status'
import { isCsTeamMember } from '@/lib/specialists'
import { customerEditSchema, dateOnly, dayString, noteSchema, statusChangeSchema, type ActionResult, type CustomerEditInput, type StatusChangeInput } from '@/lib/customer-fields'

const NO_ACCESS = "You don't have permission to change this customer."

function refresh(customerId: string) {
  revalidatePath('/customers', 'layout')
  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/leads')
}

// Every status change goes through lib/status.ts: the status log, the
// activity log, the account cascade and the pending-review flag all land in
// one transaction.
export async function changeCustomerStatus(customerId: string, input: StatusChangeInput): Promise<ActionResult<{ review: boolean }>> {
  const actor = await getActorFor('customers', 'update')
  if (!actor || !(await assertCustomerInScope(actor, customerId))) return { ok: false, error: "You don't have permission to change this customer's status." }

  const parsed = statusChangeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  try {
    const result = await prisma.$transaction((tx) => applyCustomerStatus(tx, actor, customerId, parsed.data))
    refresh(customerId)
    return { ok: true, data: result }
  } catch (err) {
    if (err instanceof StatusError) return { ok: false, error: err.message }
    throw err
  }
}

// Name, email, notes and payment. Never the status (the legacy form
// defaulted a missing status to Active and logged a fake change).
export async function updateCustomer(customerId: string, input: CustomerEditInput): Promise<ActionResult> {
  const actor = await getActorFor('customers', 'update')
  if (!actor || !(await assertCustomerInScope(actor, customerId))) return { ok: false, error: NO_ACCESS }

  const parsed = customerEditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { name, email, notes, noPaymentYet, paymentDate } = parsed.data

  const before = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, email: true, notes: true, noPaymentYet: true, paymentDate: true } })
  if (!before) return { ok: false, error: 'That customer no longer exists.' }
  const after = { name, email, notes, noPaymentYet, paymentDate: noPaymentYet ? null : paymentDate }

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: { name, email, notes, noPaymentYet, paymentDate: after.paymentDate ? dateOnly(after.paymentDate) : null },
    })
    await logActivity(
      tx,
      actor,
      fieldChanges({ entityType: 'Customer', entityId: customerId, entityLabel: name, customerId }, { ...before, paymentDate: before.paymentDate ? dayString(before.paymentDate) : null }, after)
    )
  })
  refresh(customerId)
  return { ok: true, data: null }
}

// Assigning the CS Specialist from the customer's page (the CS Specialists
// page does the same in bulk).
export async function assignSpecialist(customerId: string, email: string): Promise<ActionResult> {
  const actor = await getActorFor('csSpecialists', 'update')
  if (!actor) return { ok: false, error: "You don't have permission to assign CS Specialists." }
  const target = email.trim().toLowerCase()
  if (target && !(await isCsTeamMember(target))) return { ok: false, error: `${target} isn't an active Customer Specialist or CS Manager.` }

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, assignedSpecialistEmail: true } })
  if (!customer) return { ok: false, error: 'That customer no longer exists.' }
  if ((customer.assignedSpecialistEmail ?? '') === target) return { ok: true, data: null }

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { assignedSpecialistEmail: target || null } })
    await logActivity(tx, actor, {
      entityType: 'Customer',
      entityId: customerId,
      entityLabel: customer.name,
      customerId,
      action: customer.assignedSpecialistEmail ? 'TRANSFER' : 'ASSIGN',
      field: 'assignedSpecialistEmail',
      oldValue: customer.assignedSpecialistEmail,
      newValue: target || null,
    })
  })
  refresh(customerId)
  revalidatePath('/specialists')
  return { ok: true, data: null }
}

// A note on the customer, or on one of its accounts (accountId).
export async function addNote(customerId: string, accountId: string | null, input: { body: string }): Promise<ActionResult> {
  const actor = await getActorFor(accountId ? 'accounts' : 'customers', 'update')
  if (!actor || !(await assertCustomerInScope(actor, customerId))) return { ok: false, error: "You don't have permission to add notes here." }
  const parsed = noteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the note.' }

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, accounts: { where: { id: accountId ?? '' }, select: { id: true, name: true, accountCode: true } } } })
  if (!customer) return { ok: false, error: 'That customer no longer exists.' }
  const account = customer.accounts[0]
  if (accountId && !account) return { ok: false, error: 'That account isn’t under this customer.' }

  await prisma.$transaction(async (tx) => {
    const note = await tx.customerAccountNote.create({ data: { customerId, accountId, body: parsed.data.body, createdByEmail: actor.email.toLowerCase() } })
    await logActivity(tx, actor, {
      entityType: account ? 'Account' : 'Customer',
      entityId: account ? account.id : customerId,
      entityLabel: account ? `${account.name} (${account.accountCode})` : customer.name,
      customerId,
      action: 'NOTE',
      newValue: parsed.data.body.slice(0, 200),
      notes: note.id,
    })
  })
  refresh(customerId)
  if (accountId) revalidatePath(`/accounts/${accountId}`)
  return { ok: true, data: null }
}
