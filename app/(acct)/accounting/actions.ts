'use server'

import { revalidatePath } from 'next/cache'
import { getActorFor } from '@/lib/auth'
import { recordPayment, removePayment, saveBillingDefaults, saveRate, voidInvoice } from '@/lib/billing'
import { billingDefaultsSchema, rateSchema, voidSchema, type BillingDefaults, type PaymentInput } from '@/lib/billing-fields'
import { SERVICE_OFFERINGS } from '@/lib/onboarding-fields'
import type { ActionResult } from '@/lib/customer-fields'

// The Accounting System's actions: payments, voiding, and the rates and fees
// new bills start from. Bills themselves are prepared on the lead's page
// (app/(lms)/leads/actions.ts).

const NO_ACCESS = "You don't have permission to change billing."

function refresh(invoiceId?: string, customerId?: string) {
  revalidatePath('/accounting', 'layout')
  if (invoiceId) revalidatePath(`/accounting/invoices/${invoiceId}`)
  if (customerId) revalidatePath(`/leads/${customerId}`)
}

export async function addPayment(invoiceId: string, input: PaymentInput): Promise<ActionResult> {
  const actor = await getActorFor('billing', 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const result = await recordPayment(actor, invoiceId, input)
  if (!result.ok) return result
  refresh(invoiceId, result.data.customerId)
  return { ok: true, data: null }
}

export async function deletePayment(paymentId: string): Promise<ActionResult> {
  const actor = await getActorFor('billing', 'delete')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const result = await removePayment(actor, paymentId)
  if (!result.ok) return result
  refresh(result.data.invoiceId, result.data.customerId)
  return { ok: true, data: null }
}

export async function voidBill(invoiceId: string, reason: string): Promise<ActionResult> {
  const actor = await getActorFor('billing', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = voidSchema.safeParse({ reason })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Say why the bill is void.' }
  const result = await voidInvoice(actor, invoiceId, parsed.data.reason)
  if (!result.ok) return result
  refresh(invoiceId, result.data.customerId)
  return { ok: true, data: null }
}

export async function updateBillingDefaults(input: BillingDefaults): Promise<ActionResult> {
  const actor = await getActorFor('billing', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = billingDefaultsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the fees.' }
  await saveBillingDefaults(actor, parsed.data)
  revalidatePath('/accounting/settings')
  return { ok: true, data: null }
}

export async function updateRate(service: string, hourlyRate: number): Promise<ActionResult> {
  const actor = await getActorFor('billing', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = rateSchema.safeParse({ service, hourlyRate })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the rate.' }
  if (!(SERVICE_OFFERINGS as readonly string[]).includes(parsed.data.service)) return { ok: false, error: 'Pick a service from the list.' }
  await saveRate(actor, parsed.data.service, parsed.data.hourlyRate)
  revalidatePath('/accounting/settings')
  return { ok: true, data: null }
}
