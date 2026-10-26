import type { Prisma } from '@/src/generated/prisma/client'
import { logActivity, type ActivityActor } from '@/lib/activity'
import { classifyStatusChange } from '@/lib/activity-fields'
import { needsStatusReview } from '@/lib/permissions'
import { countStartedVaConnections } from '@/lib/va-connection-hooks'
import {
  REVIEWED_STATUSES,
  STATUS_LABELS,
  isTerminal,
  manilaStartOf,
  manilaToday,
  type AccountStatus,
  type CustomerStatus,
} from '@/lib/customer-fields'
import type { AccessRole } from '@/lib/access-fields'

// Every customer and account status change goes through here, in one
// transaction with its status log and activity log rows. This is the one
// path for the dedicated buttons and the edit forms alike (the legacy CMS
// had two, and its Terminate button never applied the termination).
//
// Rules (legacy CustomerService.js / ClientService.js, bugs fixed):
// - Pause, Terminate and Cancel by anyone who isn't a CS Manager or admin
//   apply at once and are flagged for review. A CS Manager confirms (flags
//   cleared) or cancels (the old status comes back, cascades included).
// - Customer Paused pauses its Active accounts; Terminated/Cancelled applies
//   to every account that isn't already terminated or cancelled.
// - After an account changes, the customer follows: any account Active →
//   Active; otherwise any Paused → Paused; otherwise all Terminated →
//   Terminated; any other mix leaves the customer as it is.
// - Nothing is terminated or cancelled while a VA connection is Started.
// - Terminations can't be dated in the future (nor can any status change).
// - Leaving Terminated/Cancelled counts as a reactivation; entering it
//   (or switching between the two) as a termination.

type Tx = Prisma.TransactionClient
export type StatusActor = ActivityActor & { id?: string; role: AccessRole }

export class StatusError extends Error {}

const REVIEW_CLEARED = {
  reviewAction: null,
  statusBeforeReview: null,
  reviewRequestedByEmail: null,
  reviewRequestedAt: null,
  reviewReason: null,
} as const

// '' or today → now; an earlier day → the start of that Manila day.
function effectiveFrom(day: string, now: Date): Date {
  if (!day || day === manilaToday(now)) return now
  if (day > manilaToday(now)) throw new StatusError('A status change can’t be dated in the future.')
  return manilaStartOf(day)
}

async function checkTerminationReason(tx: Tx, id: string): Promise<string | null> {
  if (!id) return null
  const found = await tx.settingOption.count({ where: { id, category: 'TerminationReason' } })
  if (!found) throw new StatusError('Pick a termination reason from the list.')
  return id
}

function counterChanges(from: string, to: string) {
  const wasTerminal = isTerminal(from)
  const nowTerminal = isTerminal(to)
  return {
    terminated: nowTerminal && (!wasTerminal || from !== to),
    reactivated: wasTerminal && !nowTerminal,
  }
}

function reviewActionLabel(status: string) {
  return status === 'PAUSED' ? 'PAUSE_PENDING_REVIEW' : 'TERMINATION_PENDING_REVIEW'
}

// ── Customers ─────────────────────────────────────────────────────

export type CustomerChange = {
  status: CustomerStatus
  reason: string
  effectiveDate: string
  terminationReasonId: string
  reactivateAccountIds: string[]
}

export async function changeCustomerStatus(tx: Tx, actor: StatusActor, customerId: string, input: CustomerChange, now = new Date()) {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, status: true, reviewAction: true },
  })
  if (!customer) throw new StatusError('That customer no longer exists.')
  if (customer.reviewAction) throw new StatusError('This customer has a status change waiting for a CS Manager’s review. Confirm or cancel it on the Approvals page first.')
  const from = customer.status
  const to = input.status
  if (from === to) throw new StatusError(`This customer is already ${STATUS_LABELS[to]}.`)

  const effective = effectiveFrom(input.effectiveDate, now)
  if (isTerminal(to) && (await countStartedVaConnections(tx, { customerId })) > 0) {
    throw new StatusError('This customer still has Started VA connections. End those connections first.')
  }
  const terminationReasonId = isTerminal(to) ? await checkTerminationReason(tx, input.terminationReasonId) : null
  const review = needsStatusReview(actor.role) && REVIEWED_STATUSES.includes(to)
  const counts = counterChanges(from, to)

  await tx.customer.update({
    where: { id: customerId },
    data: {
      status: to,
      statusChangedAt: effective,
      ...(counts.terminated ? { terminationCount: { increment: 1 } } : {}),
      ...(counts.reactivated ? { reactivationCount: { increment: 1 } } : {}),
      ...(review
        ? { reviewAction: to, statusBeforeReview: from, reviewRequestedByEmail: actor.email.toLowerCase(), reviewRequestedAt: now, reviewReason: input.reason || null }
        : {}),
    },
  })
  await tx.customerStatusLog.create({
    data: {
      customerId,
      fromStatus: from,
      toStatus: to,
      reason: input.reason || null,
      terminationReasonId,
      effectiveDate: effective === now ? null : effective,
      changedById: actor.id ?? null,
      changedByEmail: actor.email.toLowerCase(),
      changedAt: now,
    },
  })
  const base = { entityType: 'Customer', entityId: customerId, entityLabel: customer.name, customerId, effectiveDate: effective }
  await logActivity(tx, actor, [
    { ...base, action: classifyStatusChange(from, to), field: 'status', oldValue: from, newValue: to, notes: input.reason || null },
    ...(review ? [{ ...base, action: reviewActionLabel(to), field: 'status', oldValue: from, newValue: to, notes: input.reason || null }] : []),
  ])

  // Cascade down to the accounts.
  const accounts = await tx.account.findMany({ where: { customerId }, select: { id: true, status: true, accountCode: true, name: true } })
  if (to === 'PAUSED' || isTerminal(to)) {
    const targets = accounts.filter((a) => (to === 'PAUSED' ? a.status === 'ACTIVE' : !isTerminal(a.status)))
    for (const a of targets) {
      await setAccountStatus(tx, actor, a, to as AccountStatus, {
        reason: input.reason ? `${input.reason} (from the customer)` : 'Follows the customer',
        effective,
        now,
        terminationReasonId,
        review: review ? { fromCustomer: true, reason: input.reason } : null,
        customerId,
      })
    }
  }

  // Reactivating: the chosen terminated/cancelled accounts go back to
  // Pending (they become Active when a VA connection starts) and are marked
  // Returning.
  if (counts.reactivated && input.reactivateAccountIds.length) {
    const chosen = accounts.filter((a) => input.reactivateAccountIds.includes(a.id) && isTerminal(a.status))
    for (const a of chosen) {
      await setAccountStatus(tx, actor, a, 'PENDING', {
        reason: input.reason || 'Customer reactivated',
        effective,
        now,
        terminationReasonId: null,
        review: null,
        customerId,
        returning: true,
      })
    }
  }

  return { review }
}

// ── Accounts ──────────────────────────────────────────────────────

export type AccountChange = { status: AccountStatus; reason: string; effectiveDate: string; terminationReasonId: string }

export async function changeAccountStatus(tx: Tx, actor: StatusActor, accountId: string, input: AccountChange, now = new Date()) {
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { id: true, status: true, accountCode: true, name: true, customerId: true, reviewAction: true },
  })
  if (!account) throw new StatusError('That account no longer exists.')
  if (account.reviewAction) throw new StatusError('This account has a status change waiting for a CS Manager’s review. Confirm or cancel it on the Approvals page first.')
  if (account.status === input.status) throw new StatusError(`This account is already ${STATUS_LABELS[input.status]}.`)

  const effective = effectiveFrom(input.effectiveDate, now)
  if (isTerminal(input.status) && (await countStartedVaConnections(tx, { accountId })) > 0) {
    throw new StatusError('This account still has Started VA connections. End those connections first.')
  }
  const terminationReasonId = isTerminal(input.status) ? await checkTerminationReason(tx, input.terminationReasonId) : null
  const review = needsStatusReview(actor.role) && REVIEWED_STATUSES.includes(input.status)

  await setAccountStatus(tx, actor, account, input.status, {
    reason: input.reason,
    effective,
    now,
    terminationReasonId,
    review: review ? { fromCustomer: false, reason: input.reason } : null,
    customerId: account.customerId,
  })
  await recomputeCustomerStatus(tx, actor, account.customerId, effective, now)
  return { review }
}

type AccountRef = { id: string; status: AccountStatus; accountCode: string; name: string }

async function setAccountStatus(
  tx: Tx,
  actor: StatusActor,
  account: AccountRef,
  to: AccountStatus,
  opts: {
    reason: string
    effective: Date
    now: Date
    terminationReasonId: string | null
    review: { fromCustomer: boolean; reason: string } | null
    customerId: string
    returning?: boolean
  }
) {
  const from = account.status
  // Coming back from Terminated/Cancelled marks the account Returning.
  const returning = opts.returning || (isTerminal(from) && !isTerminal(to))
  await tx.account.update({
    where: { id: account.id },
    data: {
      status: to,
      statusChangedAt: opts.effective,
      ...(returning ? { isReturning: true } : {}),
      ...(opts.review
        ? {
            reviewAction: to,
            statusBeforeReview: from,
            reviewRequestedByEmail: actor.email.toLowerCase(),
            reviewRequestedAt: opts.now,
            reviewReason: opts.review.reason || null,
            reviewFromCustomer: opts.review.fromCustomer,
          }
        : {}),
    },
  })
  await tx.accountStatusLog.create({
    data: {
      accountId: account.id,
      fromStatus: from,
      toStatus: to,
      reason: opts.reason || null,
      terminationReasonId: opts.terminationReasonId,
      effectiveDate: opts.effective === opts.now ? null : opts.effective,
      changedByEmail: actor.email.toLowerCase(),
      changedAt: opts.now,
    },
  })
  const base = { entityType: 'Account', entityId: account.id, entityLabel: `${account.name} (${account.accountCode})`, customerId: opts.customerId, effectiveDate: opts.effective }
  await logActivity(tx, actor, [
    { ...base, action: classifyStatusChange(from, to), field: 'status', oldValue: from, newValue: to, notes: opts.reason || null },
    ...(opts.review && !opts.review.fromCustomer ? [{ ...base, action: reviewActionLabel(to), field: 'status', oldValue: from, newValue: to, notes: opts.reason || null }] : []),
    ...(returning ? [{ ...base, action: 'UPDATE', field: 'isReturning', newValue: 'Returning' }] : []),
  ])
}

// The customer follows its accounts (legacy _checkAndCascadeCustomerStatus).
export async function recomputeCustomerStatus(tx: Tx, actor: StatusActor, customerId: string, effective: Date, now = new Date()) {
  const [customer, accounts] = await Promise.all([
    tx.customer.findUnique({ where: { id: customerId }, select: { name: true, status: true, reviewAction: true } }),
    tx.account.findMany({ where: { customerId }, select: { status: true } }),
  ])
  if (!customer || accounts.length === 0) return
  const statuses = accounts.map((a) => a.status)
  const expected: CustomerStatus | null = statuses.includes('ACTIVE')
    ? 'ACTIVE'
    : statuses.includes('PAUSED')
      ? 'PAUSED'
      : statuses.every((s) => s === 'TERMINATED')
        ? 'TERMINATED'
        : null
  if (!expected || expected === customer.status) return

  const counts = counterChanges(customer.status, expected)
  await tx.customer.update({
    where: { id: customerId },
    data: {
      status: expected,
      statusChangedAt: effective,
      ...(counts.terminated ? { terminationCount: { increment: 1 } } : {}),
      ...(counts.reactivated ? { reactivationCount: { increment: 1 } } : {}),
      // A review on the customer no longer describes its status.
      ...(customer.reviewAction ? REVIEW_CLEARED : {}),
    },
  })
  if (customer.reviewAction) {
    await tx.account.updateMany({ where: { customerId, reviewFromCustomer: true }, data: { ...REVIEW_CLEARED, reviewFromCustomer: false } })
  }
  const reason = 'Follows its accounts'
  await tx.customerStatusLog.create({
    data: {
      customerId,
      fromStatus: customer.status,
      toStatus: expected,
      reason,
      effectiveDate: effective === now ? null : effective,
      changedById: actor.id ?? null,
      changedByEmail: actor.email.toLowerCase(),
      changedAt: now,
    },
  })
  await logActivity(tx, actor, {
    entityType: 'Customer',
    entityId: customerId,
    entityLabel: customer.name,
    customerId,
    action: classifyStatusChange(customer.status, expected),
    field: 'status',
    oldValue: customer.status,
    newValue: expected,
    notes: reason,
    effectiveDate: effective,
  })
}

// ── Pending review ────────────────────────────────────────────────

export async function resolveCustomerReview(tx: Tx, actor: StatusActor, customerId: string, decision: 'CONFIRM' | 'CANCEL', now = new Date()) {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { name: true, status: true, reviewAction: true, statusBeforeReview: true, reviewRequestedByEmail: true, reviewReason: true },
  })
  if (!customer) throw new StatusError('That customer no longer exists.')
  if (!customer.reviewAction || !customer.statusBeforeReview) throw new StatusError('This customer has no status change waiting for review.')
  const cascaded = await tx.account.findMany({
    where: { customerId, reviewFromCustomer: true },
    select: { id: true, status: true, statusBeforeReview: true, accountCode: true, name: true },
  })
  const base = { entityType: 'Customer', entityId: customerId, entityLabel: customer.name, customerId }
  const note = `Requested by ${customer.reviewRequestedByEmail}${customer.reviewReason ? `: ${customer.reviewReason}` : ''}`

  if (decision === 'CONFIRM') {
    await tx.customer.update({ where: { id: customerId }, data: REVIEW_CLEARED })
    await tx.account.updateMany({ where: { customerId, reviewFromCustomer: true }, data: { ...REVIEW_CLEARED, reviewFromCustomer: false } })
    await logActivity(tx, actor, { ...base, action: 'PENDING_REVIEW_CONFIRMED', field: 'status', newValue: customer.status, notes: note })
    return
  }

  // Cancel: put the customer and every account it cascaded to back, and
  // take back the termination it counted.
  const prior = customer.statusBeforeReview
  const undoTermination = isTerminal(customer.status) && !isTerminal(prior)
  await tx.customer.update({
    where: { id: customerId },
    data: { status: prior, statusChangedAt: now, ...REVIEW_CLEARED, ...(undoTermination ? { terminationCount: { decrement: 1 } } : {}) },
  })
  await tx.customerStatusLog.create({
    data: {
      customerId,
      fromStatus: customer.status,
      toStatus: prior,
      reason: `Review cancelled by ${actor.email.toLowerCase()}, status put back`,
      changedById: actor.id ?? null,
      changedByEmail: actor.email.toLowerCase(),
      changedAt: now,
    },
  })
  await logActivity(tx, actor, { ...base, action: 'PENDING_REVIEW_CANCELLED', field: 'status', oldValue: customer.status, newValue: prior, notes: note })
  for (const a of cascaded) await revertAccount(tx, actor, a, customerId, now)
}

export async function resolveAccountReview(tx: Tx, actor: StatusActor, accountId: string, decision: 'CONFIRM' | 'CANCEL', now = new Date()) {
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, accountCode: true, customerId: true, status: true, reviewAction: true, statusBeforeReview: true, reviewFromCustomer: true, reviewRequestedByEmail: true, reviewReason: true },
  })
  if (!account) throw new StatusError('That account no longer exists.')
  if (!account.reviewAction || !account.statusBeforeReview) throw new StatusError('This account has no status change waiting for review.')
  if (account.reviewFromCustomer) throw new StatusError('This account follows its customer’s review. Confirm or cancel the customer’s instead.')
  const note = `Requested by ${account.reviewRequestedByEmail}${account.reviewReason ? `: ${account.reviewReason}` : ''}`
  const base = { entityType: 'Account', entityId: accountId, entityLabel: `${account.name} (${account.accountCode})`, customerId: account.customerId }

  if (decision === 'CONFIRM') {
    await tx.account.update({ where: { id: accountId }, data: REVIEW_CLEARED })
    await logActivity(tx, actor, { ...base, action: 'PENDING_REVIEW_CONFIRMED', field: 'status', newValue: account.status, notes: note })
    return
  }
  await logActivity(tx, actor, { ...base, action: 'PENDING_REVIEW_CANCELLED', field: 'status', oldValue: account.status, newValue: account.statusBeforeReview, notes: note })
  await revertAccount(tx, actor, account, account.customerId, now)
  await recomputeCustomerStatus(tx, actor, account.customerId, now, now)
}

async function revertAccount(
  tx: Tx,
  actor: StatusActor,
  a: { id: string; status: AccountStatus; statusBeforeReview: AccountStatus | null; accountCode: string; name: string },
  customerId: string,
  now: Date
) {
  const prior = a.statusBeforeReview ?? a.status
  await tx.account.update({ where: { id: a.id }, data: { status: prior, statusChangedAt: now, ...REVIEW_CLEARED, reviewFromCustomer: false } })
  await tx.accountStatusLog.create({
    data: { accountId: a.id, fromStatus: a.status, toStatus: prior, reason: 'Review cancelled, status put back', changedByEmail: actor.email.toLowerCase(), changedAt: now },
  })
  await logActivity(tx, actor, {
    entityType: 'Account',
    entityId: a.id,
    entityLabel: `${a.name} (${a.accountCode})`,
    customerId,
    action: classifyStatusChange(a.status, prior),
    field: 'status',
    oldValue: a.status,
    newValue: prior,
    notes: 'Review cancelled, status put back',
  })
}

// ── VA connection start (module 2) ────────────────────────────────

// A VA connection Started: a Pending or Paused account becomes Active, and
// its customer follows. (The legacy CMS wrote this to a tab that didn't
// exist, so accounts were never activated.)
export async function activateOnConnectionStart(tx: Tx, actor: StatusActor, accountId: string, startedAt: Date, now = new Date()) {
  const account = await tx.account.findUnique({ where: { id: accountId }, select: { id: true, status: true, accountCode: true, name: true, customerId: true } })
  if (!account || (account.status !== 'PENDING' && account.status !== 'PAUSED')) return
  await setAccountStatus(tx, actor, account, 'ACTIVE', {
    reason: 'A VA connection started',
    effective: startedAt,
    now,
    terminationReasonId: null,
    review: null,
    customerId: account.customerId,
  })
  await recomputeCustomerStatus(tx, actor, account.customerId, startedAt, now)
}
