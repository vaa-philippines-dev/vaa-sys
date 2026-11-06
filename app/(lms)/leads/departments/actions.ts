'use server'

import { revalidatePath } from 'next/cache'
import { getActorFor, getCurrentUser, type Actor } from '@/lib/auth'
import { saveDepartment, saveServiceDetails, saveServiceRates } from '@/lib/workforce-org'
import { departmentSchema, serviceDetailsSchema, serviceRatesSchema, type DepartmentInput, type ServiceDetailsInput, type ServiceRatesInput } from '@/lib/workforce-org-fields'
import type { ActionResult } from '@/lib/customer-fields'

// The Departments & services page (lib/workforce-org.ts). Departments and a
// service's details are admins' (workforceOrg); the confidential rates are
// for the people allowed to see them (lib/rates.ts checks again).
// The page is in both areas (components/leads/DepartmentsPage.tsx).
const refresh = () => {
  revalidatePath('/leads/departments')
  revalidatePath('/departments')
}

export async function updateDepartment(id: string | null, input: DepartmentInput): Promise<ActionResult<{ id: string }>> {
  const actor = await getActorFor('workforceOrg', id ? 'update' : 'create')
  if (!actor) return { ok: false, error: 'Only admins can change Workforce’s departments.' }
  const parsed = departmentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the department.' }
  const result = await saveDepartment(actor, id, parsed.data)
  if (result.ok) refresh()
  return result
}

export async function updateServiceDetails(skillId: string, input: ServiceDetailsInput): Promise<ActionResult> {
  const actor = await getActorFor('workforceOrg', 'update')
  if (!actor) return { ok: false, error: 'Only admins can change a service’s details.' }
  const parsed = serviceDetailsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the service.' }
  const result = await saveServiceDetails(actor, skillId, parsed.data)
  if (result.ok) refresh()
  return result
}

export async function updateServiceRates(skillId: string, input: ServiceRatesInput): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user?.role) return { ok: false, error: 'Sign in again.' }
  if (user.viewingAs) return { ok: false, error: 'Nothing can be changed while viewing as someone else.' }
  const actor = user as Actor
  const parsed = serviceRatesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the rates.' }
  const result = await saveServiceRates(actor, skillId, parsed.data)
  if (result.ok) refresh()
  return result
}
