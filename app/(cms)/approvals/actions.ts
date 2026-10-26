'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getActorFor } from '@/lib/auth'
import { resolveAccountReview, resolveCustomerReview, StatusError } from '@/lib/status'
import type { ActionResult } from '@/lib/customer-fields'

// A CS Manager (or admin) confirms a pending pause/termination/cancellation,
// or cancels it, which puts the old status back (cascaded accounts too).
export async function resolveReview(kind: 'customer' | 'account', id: string, decision: 'CONFIRM' | 'CANCEL'): Promise<ActionResult> {
  const actor = await getActorFor('approvals', 'update')
  if (!actor) return { ok: false, error: 'Only a CS Manager or an admin can review status changes.' }
  if (decision !== 'CONFIRM' && decision !== 'CANCEL') return { ok: false, error: 'Choose Confirm or Cancel.' }

  try {
    await prisma.$transaction((tx) => (kind === 'customer' ? resolveCustomerReview(tx, actor, id, decision) : resolveAccountReview(tx, actor, id, decision)))
  } catch (err) {
    if (err instanceof StatusError) return { ok: false, error: err.message }
    throw err
  }
  revalidatePath('/approvals')
  revalidatePath('/customers', 'layout')
  revalidatePath('/accounts', 'layout')
  return { ok: true, data: null }
}
