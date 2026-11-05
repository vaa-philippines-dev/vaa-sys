'use server'

import { revalidatePath } from 'next/cache'
import { getActorFor } from '@/lib/auth'
import { grantRateViewer, revokeRateViewer } from '@/lib/rates'
import type { ActionResult } from '@/lib/customer-fields'

// User access → Confidential rates: who may see the services' Standard
// Billing Rate and VA Base Rate. The page is admins' (userAccess), and
// lib/rates.ts lets only someone who already sees the rates change the list.

export async function addRateViewer(email: string): Promise<ActionResult> {
  const actor = await getActorFor('userAccess', 'update')
  if (!actor) return { ok: false, error: 'Only admins can change User access.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { ok: false, error: 'Pick someone from the list.' }
  const result = await grantRateViewer(actor, email)
  if (result.ok) revalidatePath('/leads/access')
  return result
}

export async function removeRateViewer(email: string): Promise<ActionResult> {
  const actor = await getActorFor('userAccess', 'update')
  if (!actor) return { ok: false, error: 'Only admins can change User access.' }
  const result = await revokeRateViewer(actor, email)
  if (result.ok) {
    revalidatePath('/leads/access')
    revalidatePath('/leads/departments')
  }
  return result
}
