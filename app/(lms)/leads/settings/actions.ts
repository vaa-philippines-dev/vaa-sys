'use server'

import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth'
import { minimumsSchema, type WorkHourMinimums } from '@/lib/onboarding-fields'
import { saveWorkHourMinimums } from '@/lib/settings'
import type { ActionResult } from '@/lib/customer-fields'

export async function updateWorkHourMinimums(input: WorkHourMinimums): Promise<ActionResult> {
  const actor = await getActor('settings')
  if (!actor) return { ok: false, error: 'Only admins can change settings.' }

  const parsed = minimumsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the numbers.' }

  await saveWorkHourMinimums(parsed.data, actor.email)
  revalidatePath('/leads/settings')
  return { ok: true, data: null }
}
