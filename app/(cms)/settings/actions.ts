'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getActorFor } from '@/lib/auth'
import { fieldChanges, logActivity } from '@/lib/activity'
import { settingSchema, type SettingInput } from '@/lib/settings-fields'
import type { ActionResult } from '@/lib/customer-fields'

// Admin-only (legacy manageSettings). Options are deactivated, never
// deleted: accounts and logs keep pointing at them.

const NO_ACCESS = 'Only admins can change settings.'

function duplicate(err: unknown) {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002'
}

export async function saveSetting(id: string | null, input: SettingInput): Promise<ActionResult> {
  const actor = await getActorFor('settings', id ? 'update' : 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = settingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { category, value } = parsed.data
  const label = parsed.data.label || value
  const timezone = category === 'CountryRegion' ? parsed.data.timezone || null : null

  try {
    await prisma.$transaction(async (tx) => {
      if (id) {
        const before = await tx.settingOption.findUnique({ where: { id }, select: { category: true, value: true, label: true, timezone: true } })
        if (!before || before.category !== category) throw new Error('missing')
        await tx.settingOption.update({ where: { id }, data: { value, label, timezone } })
        await logActivity(
          tx,
          actor,
          fieldChanges({ entityType: 'Setting', entityId: id, entityLabel: `${category}: ${label}` }, before, { value, label, timezone })
        )
      } else {
        const last = await tx.settingOption.aggregate({ where: { category }, _max: { sortOrder: true } })
        const created = await tx.settingOption.create({ data: { category, value, label, timezone, sortOrder: (last._max.sortOrder ?? 0) + 1 } })
        await logActivity(tx, actor, { entityType: 'Setting', entityId: created.id, entityLabel: `${category}: ${label}`, action: 'CREATE', newValue: value })
      }
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'missing') return { ok: false, error: 'That option no longer exists.' }
    if (duplicate(err)) return { ok: false, error: `“${value}” is already in this list.` }
    throw err
  }
  revalidatePath('/settings')
  return { ok: true, data: null }
}

export async function setSettingActive(id: string, isActive: boolean): Promise<ActionResult> {
  const actor = await getActorFor('settings', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const option = await prisma.settingOption.findUnique({ where: { id } })
  if (!option) return { ok: false, error: 'That option no longer exists.' }
  await prisma.$transaction(async (tx) => {
    await tx.settingOption.update({ where: { id }, data: { isActive } })
    await logActivity(tx, actor, { entityType: 'Setting', entityId: id, entityLabel: `${option.category}: ${option.label}`, action: 'UPDATE', field: 'isActive', oldValue: option.isActive, newValue: isActive })
  })
  revalidatePath('/settings')
  return { ok: true, data: null }
}

// Moves an option one place up or down within its list.
export async function moveSetting(id: string, direction: 'up' | 'down'): Promise<ActionResult> {
  const actor = await getActorFor('settings', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const option = await prisma.settingOption.findUnique({ where: { id } })
  if (!option) return { ok: false, error: 'That option no longer exists.' }

  const list = await prisma.settingOption.findMany({ where: { category: option.category }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: { id: true } })
  const from = list.findIndex((o) => o.id === id)
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= list.length) return { ok: true, data: null }
  ;[list[from], list[to]] = [list[to], list[from]]

  // Renumber the whole list 1..n, which also repairs any ties.
  await prisma.$transaction(list.map((o, i) => prisma.settingOption.update({ where: { id: o.id }, data: { sortOrder: i + 1 } })))
  revalidatePath('/settings')
  return { ok: true, data: null }
}
