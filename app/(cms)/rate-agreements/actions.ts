'use server'

import { revalidatePath } from 'next/cache'
import { getActorFor } from '@/lib/auth'
import { advanceRateAgreement, assignRateAgreement, saveRaTerms } from '@/lib/rate-agreements'
import { raStepSchema, raTermsSchema, type RaStatus, type RaTerms } from '@/lib/rate-agreement-fields'
import type { ActionResult } from '@/lib/customer-fields'

// Rate Agreements (lib/rate-agreements.ts checks who may do each thing).

function refresh(id: string, ticketId?: string) {
  revalidatePath('/rate-agreements', 'layout')
  revalidatePath(`/rate-agreements/${id}`)
  revalidatePath('/service-requests', 'layout')
  if (ticketId) revalidatePath(`/service-requests/${ticketId}`)
}

export async function assignRa(id: string, email: string): Promise<ActionResult> {
  const actor = await getActorFor('rateAgreements', 'create')
  if (!actor) return { ok: false, error: 'Only an HR Manager can assign Rate Agreements.' }
  const r = await assignRateAgreement(actor, id, email.slice(0, 200) || null)
  if (r.ok) refresh(id)
  return r
}

// Save the terms, or (prepare) save them and mark it Prepared by HR.
export async function saveRa(id: string, input: RaTerms, prepare: boolean): Promise<ActionResult<{ status: RaStatus; reopened: boolean }>> {
  const actor = await getActorFor('rateAgreements', 'update')
  if (!actor) return { ok: false, error: 'Only HR can change a Rate Agreement.' }
  const parsed = raTermsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the terms.' }
  const t = parsed.data
  const r = await saveRaTerms(actor, id, { bond: t.bond, nightDifferential: t.nightDifferential === 'yes', incrementalWage: t.incrementalWage === 'yes', notes: t.notes }, prepare)
  if (r.ok) refresh(id)
  return r
}

// The next step. The customer's CS can record the schedule confirmation, so
// this only needs read access; lib/rate-agreements.ts checks the rest.
export async function moveRa(id: string, to: RaStatus, sentOn = ''): Promise<ActionResult> {
  const actor = await getActorFor('rateAgreements', 'read')
  if (!actor) return { ok: false, error: 'You can’t change Rate Agreements.' }
  const parsed = raStepSchema.safeParse({ to, sentOn })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the step.' }
  const r = await advanceRateAgreement(actor, id, parsed.data.to, parsed.data.sentOn)
  if (!r.ok) return r
  refresh(id, r.data.ticketId)
  return { ok: true, data: null }
}
