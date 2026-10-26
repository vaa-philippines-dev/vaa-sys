'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getActorFor } from '@/lib/auth'
import { fieldChanges, logActivity } from '@/lib/activity'
import { assertAccountInScope } from '@/lib/scope'
import { changeAccountStatus as applyAccountStatus, StatusError } from '@/lib/status'
import {
  accountEditSchema,
  accountManagerSchema,
  accountStatusChangeSchema,
  type AccountEditInput,
  type AccountManagerInput,
  type AccountStatusChangeInput,
  type ActionResult,
} from '@/lib/customer-fields'

const NO_ACCESS = "You don't have permission to change this account."

async function refresh(accountId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { customerId: true } })
  revalidatePath('/accounts')
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath('/customers', 'layout')
  if (account) revalidatePath(`/customers/${account.customerId}`)
}

async function actorFor(accountId: string) {
  const actor = await getActorFor('accounts', 'update')
  return actor && (await assertAccountInScope(actor, accountId)) ? actor : null
}

export async function changeAccountStatus(accountId: string, input: AccountStatusChangeInput): Promise<ActionResult<{ review: boolean }>> {
  const actor = await actorFor(accountId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = accountStatusChangeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  try {
    const result = await prisma.$transaction((tx) => applyAccountStatus(tx, actor, accountId, parsed.data))
    await refresh(accountId)
    return { ok: true, data: result }
  } catch (err) {
    if (err instanceof StatusError) return { ok: false, error: err.message }
    throw err
  }
}

const SETTING_FIELDS = { categoryId: 'Category', typeId: 'Type', countryRegionId: 'CountryRegion' } as const

export async function updateAccount(accountId: string, input: AccountEditInput): Promise<ActionResult> {
  const actor = await actorFor(accountId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = accountEditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const data = parsed.data

  // Every picked option must exist in its own list.
  for (const [field, category] of Object.entries(SETTING_FIELDS) as [keyof typeof SETTING_FIELDS, string][]) {
    const id = data[field]
    if (id && !(await prisma.settingOption.count({ where: { id, category } }))) return { ok: false, error: 'Pick an option from the list.' }
  }
  if (data.contractId && !(await prisma.contract.count({ where: { id: data.contractId } }))) return { ok: false, error: 'That contract no longer exists.' }

  const before = await prisma.account.findUnique({
    where: { id: accountId },
    select: { name: true, accountCode: true, customerId: true, categoryId: true, typeId: true, countryRegionId: true, sellerOnboardingLink: true, contractLink: true, contractId: true, isReturning: true },
  })
  if (!before) return { ok: false, error: 'That account no longer exists.' }
  const { name, accountCode, customerId, ...old } = before

  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: accountId }, data })
    const base = { entityType: 'Account', entityId: accountId, entityLabel: `${name} (${accountCode})`, customerId }
    const changes = fieldChanges(base, old, data).map((c) => (c.field === 'contractId' ? { ...c, action: 'CONTRACT_ASSIGNED' } : c))
    await logActivity(tx, actor, changes)
  })
  await refresh(accountId)
  return { ok: true, data: null }
}

// Account managers are one row each (the legacy CMS kept two comma lists
// that drifted out of step).
export async function addAccountManager(accountId: string, input: AccountManagerInput): Promise<ActionResult> {
  const actor = await actorFor(accountId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = accountManagerSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { name, email } = parsed.data

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true, accountCode: true, customerId: true, managers: { select: { name: true } } } })
  if (!account) return { ok: false, error: 'That account no longer exists.' }
  if (account.managers.some((m) => m.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `${name} is already an account manager here.` }

  await prisma.$transaction(async (tx) => {
    await tx.accountManager.create({ data: { accountId, name, email, sortOrder: account.managers.length } })
    await logActivity(tx, actor, {
      entityType: 'Account',
      entityId: accountId,
      entityLabel: `${account.name} (${account.accountCode})`,
      customerId: account.customerId,
      action: 'UPDATE',
      field: 'accountManagers',
      newValue: email ? `${name} <${email}>` : name,
    })
  })
  await refresh(accountId)
  return { ok: true, data: null }
}

export async function removeAccountManager(managerId: string): Promise<ActionResult> {
  const manager = await prisma.accountManager.findUnique({ where: { id: managerId }, include: { account: { select: { name: true, accountCode: true, customerId: true } } } })
  if (!manager) return { ok: false, error: 'That account manager was already removed.' }
  const actor = await actorFor(manager.accountId)
  if (!actor) return { ok: false, error: NO_ACCESS }

  await prisma.$transaction(async (tx) => {
    await tx.accountManager.delete({ where: { id: managerId } })
    await logActivity(tx, actor, {
      entityType: 'Account',
      entityId: manager.accountId,
      entityLabel: `${manager.account.name} (${manager.account.accountCode})`,
      customerId: manager.account.customerId,
      action: 'UPDATE',
      field: 'accountManagers',
      oldValue: manager.email ? `${manager.name} <${manager.email}>` : manager.name,
    })
  })
  await refresh(manager.accountId)
  return { ok: true, data: null }
}
