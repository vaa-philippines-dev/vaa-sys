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
import { accountDetailsSchema, vaRequestEditSchema, type AccountDetailsInput, type VaRequestEditInput } from '@/lib/account-details-fields'
import { subTicketCode } from '@/lib/onboarding-fields'
import { recordScheduleChange, scheduleColumns, snapshotOfColumns } from '@/lib/request-schedule'
import { snapshotOf } from '@/lib/request-schedule-fields'

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

// The Details section's edit (customer and account pages): the account's
// onboarding details and its contacts. Never the status. One main contact at
// most (account_contacts_one_focal_per_account), so focal flags are cleared
// before the new one is set.
export async function updateAccountDetails(accountId: string, input: AccountDetailsInput): Promise<ActionResult> {
  const actor = await actorFor(accountId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = accountDetailsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const v = parsed.data

  const before = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      name: true,
      accountCode: true,
      customerId: true,
      companyName: true,
      dbaName: true,
      businessAddress: true,
      website: true,
      timeZone: true,
      platforms: true,
      platformOther: true,
      otherInfo: true,
      invoiceContactSource: true,
      invoiceContactName: true,
      invoiceContactRole: true,
      invoiceContactEmail: true,
      paymentMethod: true,
      paymentMethodOther: true,
      billingCountry: true,
      hasPayoneerOrWise: true,
      contacts: true,
    },
  })
  if (!before) return { ok: false, error: 'That account no longer exists.' }

  const blank = (s: string) => (s === '' ? null : s)
  const contactName = (c: { firstName: string; lastName: string } | null) => (c ? `${c.firstName} ${c.lastName}`.trim() : '')
  // Invoices go to a contact's name and email, or the one typed in.
  const invoice =
    v.invoiceSource === 'PRIMARY'
      ? { name: contactName(v.primary), role: v.primary?.role ?? '', email: v.primary?.email ?? '' }
      : v.invoiceSource === 'SECONDARY'
        ? { name: contactName(v.secondary), role: v.secondary?.role ?? '', email: v.secondary?.email ?? '' }
        : { name: v.invoiceName, role: v.invoiceRole, email: v.invoiceEmail }
  const data = {
    companyName: v.companyName,
    dbaName: blank(v.dbaName),
    businessAddress: blank(v.businessAddress),
    website: blank(v.website),
    timeZone: blank(v.timeZone),
    platforms: v.platforms,
    platformOther: v.platforms.includes('Other') ? blank(v.platformOther) : null,
    otherInfo: blank(v.otherInfo),
    invoiceContactSource: v.invoiceSource,
    invoiceContactName: blank(invoice.name),
    invoiceContactRole: blank(invoice.role),
    invoiceContactEmail: invoice.email.toLowerCase(),
    paymentMethod: v.paymentMethod,
    paymentMethodOther: v.paymentMethod === 'OTHER' ? blank(v.paymentMethodOther) : null,
    billingCountry: blank(v.billingCountry),
    hasPayoneerOrWise: v.hasPayoneerOrWise,
  }
  const { name, accountCode, customerId, contacts, ...old } = before
  const contactText = (c: { firstName: string; lastName: string; role: string | null; email: string; whatsapp: string | null; region: string | null; isFocal: boolean } | undefined) =>
    c ? [`${c.firstName} ${c.lastName}`.trim(), c.role, c.email, c.whatsapp, c.region, c.isFocal ? 'main contact' : null].filter(Boolean).join(' · ') : null

  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: accountId }, data })
    await tx.accountContact.updateMany({ where: { accountId }, data: { isFocal: false } })
    const next: Record<'PRIMARY' | 'SECONDARY', ReturnType<typeof contactText>> = { PRIMARY: null, SECONDARY: null }
    for (const kind of ['PRIMARY', 'SECONDARY'] as const) {
      const c = kind === 'PRIMARY' ? v.primary : v.secondary
      if (!c) {
        await tx.accountContact.deleteMany({ where: { accountId, kind } })
        continue
      }
      const row = { firstName: c.firstName, lastName: c.lastName, role: blank(c.role), email: c.email.toLowerCase(), whatsapp: blank(c.whatsapp), region: blank(c.region), isFocal: v.focal === kind }
      await tx.accountContact.upsert({ where: { accountId_kind: { accountId, kind } }, create: { accountId, kind, ...row }, update: row })
      next[kind] = contactText(row)
    }
    const base = { entityType: 'Account', entityId: accountId, entityLabel: `${name} (${accountCode})`, customerId }
    const was = Object.fromEntries((['PRIMARY', 'SECONDARY'] as const).map((k) => [k === 'PRIMARY' ? 'primaryContact' : 'secondaryContact', contactText(contacts.find((c) => c.kind === k))]))
    await logActivity(tx, actor, fieldChanges(base, { ...old, ...was }, { ...data, primaryContact: next.PRIMARY, secondaryContact: next.SECONDARY }))
  })
  await refresh(accountId)
  return { ok: true, data: null }
}

// One VA request (sub-ticket) on one of the account's tickets. Its number and
// line stay as they are. A fixed shift's hours and night differential are
// worked out from its times, as the onboarding form does.
export async function updateVaRequest(accountId: string, requestId: string, input: VaRequestEditInput): Promise<ActionResult> {
  const actor = await actorFor(accountId)
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = vaRequestEditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the request.' }
  const r = parsed.data

  const before = await prisma.ticketRequest.findUnique({ where: { id: requestId }, include: { ticket: { select: { id: true, accountId: true, customerId: true, ticketNumber: true, phase: true } } } })
  if (!before || before.ticket.accountId !== accountId) return { ok: false, error: 'That request isn’t on this account.' }

  // The schedule columns as the service request's schedule editor sets
  // them (lib/request-schedule.ts), so the change goes into the request's
  // schedule history the same way.
  const schedule = scheduleColumns({ ...r, hoursPerDay: r.hoursPerDay, timeZone: r.timeZone })
  const [y, m, d] = r.targetStartDate.split('-').map(Number)
  const data = {
    ...schedule,
    service: r.service,
    numberOfVas: r.numberOfVas,
    // A flexible schedule's night differential is ticked by hand.
    nightDifferential: r.scheduleType === 'DAILY_FIXED' ? schedule.nightDifferential : r.nightDifferential,
    targetStartDate: new Date(Date.UTC(y, m - 1, d)),
    tasks: r.tasks,
    tools: r.tools || null,
    taskTracker: r.taskTracker,
    timeZone: r.timeZone || null,
    mustHaves: r.mustHaves || null,
  }
  const n = (x: unknown) => (x == null ? null : Number(x))
  const old = {
    service: before.service,
    numberOfVas: before.numberOfVas,
    scheduleType: before.scheduleType,
    hoursPerDay: n(before.hoursPerDay),
    hoursPerWeek: n(before.hoursPerWeek),
    hoursPerMonth: n(before.hoursPerMonth),
    projectHours: n(before.projectHours),
    startTimePht: before.startTimePht,
    endTimePht: before.endTimePht,
    workDays: before.workDays,
    nightDifferential: before.nightDifferential,
    additionalHours: before.additionalHours,
    targetStartDate: before.targetStartDate.toISOString().slice(0, 10),
    tasks: before.tasks,
    tools: before.tools,
    taskTracker: before.taskTracker,
    timeZone: before.timeZone,
    mustHaves: before.mustHaves,
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticketRequest.update({ where: { id: requestId }, data })
    // The schedule goes into the request's schedule history (and waits for
    // Executive Support's check while the request is open); the hours for
    // each day are in that entry, not the field-by-field lines.
    await recordScheduleChange(tx, actor, before.ticket, before, snapshotOf(before), snapshotOfColumns(schedule))
    const { dayHours, ...plain } = data
    void dayHours
    await logActivity(
      tx,
      actor,
      fieldChanges(
        { entityType: 'Ticket', entityId: before.ticketId, entityLabel: subTicketCode(before.ticket.ticketNumber, before.lineNo), customerId: before.ticket.customerId },
        old,
        { ...plain, targetStartDate: r.targetStartDate }
      )
    )
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
