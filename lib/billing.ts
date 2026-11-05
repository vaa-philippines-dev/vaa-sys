import { prisma } from '@/lib/prisma'
import { logActivity } from '@/lib/activity'
import { dateOnly, dayString, manilaToday } from '@/lib/customer-fields'
import {
  BILLING_DEFAULTS,
  billDefaultsFor,
  billingDefaultsSchema,
  computeBill,
  departmentOf,
  draftBillSchema,
  firstPeriod,
  invoiceCode,
  otfExempt,
  paymentSchema,
  statusAfterPayments,
  type Bill,
  type BillDepartment,
  type BillItem,
  type BillSettings,
  type BillingDefaults,
  type Currency,
  type DraftBillInput,
  type InvoiceStatus,
  type PaymentInput,
} from '@/lib/billing-fields'
import type { Actor } from '@/lib/auth'
import { standardRatesByOnboardingService } from '@/lib/workforce-org'
import type { Prisma } from '@/src/generated/prisma/client'

// Server-only: the Accounting System's bills and payments. The maths is
// lib/billing-fields.ts; this file loads the inputs, saves the results and
// logs every change. The Lead Manager prepares and sends a lead's initial
// bill (app/(lms)/leads/actions.ts); Accounting records payments and voids
// bills (app/(acct)/accounting/actions.ts).

type Tx = Prisma.TransactionClient
type Result<T = null> = { ok: true; data: T } | { ok: false; error: string }
const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d))

// Bills are worked out before their transaction opens, so a transaction is
// only writes, and billing transactions get longer than Prisma's 5-second
// default: a draft with several requests is a dozen round trips, and from a
// developer's machine in Manila each one is a long way from the database in
// Sydney.
const BILL_TX = { maxWait: 10_000, timeout: 20_000 }

// ── Settings ─────────────────────────────────────────────────────

const DEFAULTS_KEY = 'billing_defaults'

export async function getBillingDefaults(): Promise<BillingDefaults> {
  const row = await prisma.appSetting.findUnique({ where: { key: DEFAULTS_KEY } }).catch(() => null)
  const parsed = billingDefaultsSchema.partial().safeParse(row?.value ?? {})
  return { ...BILLING_DEFAULTS, ...(parsed.success ? parsed.data : {}) }
}

export async function getBillingDefaultsRow() {
  return prisma.appSetting.findUnique({ where: { key: DEFAULTS_KEY }, select: { updatedAt: true, updatedByEmail: true } })
}

export async function saveBillingDefaults(actor: Actor, value: BillingDefaults) {
  const before = await getBillingDefaults()
  await prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({
      where: { key: DEFAULTS_KEY },
      create: { key: DEFAULTS_KEY, value, updatedByEmail: actor.email },
      update: { value, updatedByEmail: actor.email, updatedAt: new Date() },
    })
    await logActivity(tx, actor, { entityType: 'BillingSettings', entityId: DEFAULTS_KEY, entityLabel: 'Billing defaults', action: 'UPDATE', oldValue: before, newValue: value })
  }, BILL_TX)
}

export async function listRates() {
  return prisma.billingRate.findMany({ orderBy: { service: 'asc' } })
}

export async function saveRate(actor: Actor, service: string, hourlyRate: number) {
  const existing = await prisma.billingRate.findUnique({ where: { service } })
  await prisma.$transaction(async (tx) => {
    const row = await tx.billingRate.upsert({
      where: { service },
      create: { service, hourlyRate, updatedByEmail: actor.email },
      update: { hourlyRate, updatedByEmail: actor.email },
    })
    await logActivity(tx, actor, {
      entityType: 'BillingRate',
      entityId: row.id,
      entityLabel: service,
      action: existing ? 'UPDATE' : 'CREATE',
      field: 'hourlyRate',
      oldValue: existing ? n(existing.hourlyRate) : null,
      newValue: hourlyRate,
    })
  }, BILL_TX)
}

// ── Loading ──────────────────────────────────────────────────────

const billInclude = {
  items: { orderBy: { lineNo: 'asc' } },
  departments: { orderBy: { department: 'asc' } },
  lines: { orderBy: { lineNo: 'asc' } },
  payments: { orderBy: { paidOn: 'asc' } },
  customer: { select: { id: true, name: true, customerCode: true, email: true, isTest: true, leadPhase: true } },
  account: { select: { id: true, name: true, accountCode: true, invoiceContactName: true, invoiceContactEmail: true, paymentMethod: true, paymentMethodOther: true } },
} satisfies Prisma.InvoiceInclude

export type InvoiceFull = Prisma.InvoiceGetPayload<{ include: typeof billInclude }>

export async function getInvoice(id: string) {
  return prisma.invoice.findUnique({ where: { id }, include: billInclude })
}

// The lead's current initial bill: the newest one that isn't void.
export async function getInitialBill(customerId: string) {
  return prisma.invoice.findFirst({ where: { customerId, kind: 'INITIAL', status: { not: 'VOID' } }, orderBy: { createdAt: 'desc' }, include: billInclude })
}

export async function voidedInitialBills(customerId: string) {
  return prisma.invoice.findMany({
    where: { customerId, kind: 'INITIAL', status: 'VOID' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, invoiceNumber: true, total: true, currency: true, voidedAt: true, voidReason: true },
  })
}

// A saved bill, or one with edits applied (plain numbers in place of Decimals).
type Num = Prisma.Decimal | number | null
type Numbers<T, K extends keyof T> = Omit<T, K> & { [P in K]: Num }
type BillSource = Numbers<Pick<InvoiceFull, 'otfAmount' | 'depositAmount' | 'ndPercent' | 'vatPercent' | 'paypalPercent' | 'applyVat' | 'applyPaypalFee'>, 'otfAmount' | 'depositAmount' | 'ndPercent' | 'vatPercent' | 'paypalPercent'> & {
  items: Numbers<InvoiceFull['items'][number], 'hourlyRate' | 'hours' | 'ndHours' | 'freeHours' | 'depositDiscountPercent'>[]
  departments: Numbers<InvoiceFull['departments'][number], 'discountPercent'>[]
}

// What computeBill needs, from a saved bill.
export function billInputs(inv: BillSource) {
  const settings = {
    otf: n(inv.otfAmount),
    deposit: n(inv.depositAmount),
    ndPercent: n(inv.ndPercent),
    vatPercent: n(inv.vatPercent),
    paypalPercent: n(inv.paypalPercent),
    applyVat: inv.applyVat,
    applyPaypalFee: inv.applyPaypalFee,
  }
  const items: BillItem[] = inv.items.map((i) => ({
    lineNo: i.lineNo,
    service: i.service,
    department: i.department,
    scheduleType: i.scheduleType,
    numberOfVas: i.numberOfVas,
    hourlyRate: n(i.hourlyRate),
    hours: n(i.hours),
    ndHours: n(i.ndHours),
    freeHours: n(i.freeHours),
    freeHoursRef: i.freeHoursRef,
    depositDiscountPercent: n(i.depositDiscountPercent),
    depositApprovalRef: i.depositApprovalRef,
  }))
  const departments: BillDepartment[] = inv.departments.map((d) => ({ department: d.department, exempt: d.exempt, discountPercent: n(d.discountPercent), approvalRef: d.approvalRef }))
  return { settings, items, departments }
}

// The bill's lines and totals, with the departments in the order their
// first request appears.
function billOf(settings: BillSettings, items: BillItem[], departments: BillDepartment[], currency: Currency) {
  const sorted = [...items].sort((a, b) => a.lineNo - b.lineNo)
  const order = [...new Set(sorted.map((i) => i.department))]
  const depts = [...departments].sort((a, b) => order.indexOf(a.department) - order.indexOf(b.department))
  return computeBill(settings, sorted, depts, currency)
}

// Rewrites the bill's lines and totals.
async function writeBill(tx: Tx, invoiceId: string, bill: Bill) {
  await tx.invoiceLine.deleteMany({ where: { invoiceId } })
  await tx.invoiceLine.createMany({ data: bill.lines.map((l) => ({ ...l, invoiceId })) })
  await tx.invoice.update({ where: { id: invoiceId }, data: { subtotal: bill.subtotal, vatAmount: bill.vatAmount, paypalFeeAmount: bill.paypalFeeAmount, total: bill.total } })
}

// ── The initial bill (Lead Manager) ──────────────────────────────

// A draft from the lead's service requests: the account made from the
// onboarding form, each VA request with the service's default rate and its
// first-period hours, and one One-Time Fee per department.
export async function createInitialDraft(actor: Actor, customerId: string): Promise<Result<{ id: string }>> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      name: true,
      accounts: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          paymentMethod: true,
          paymentMethodOther: true,
          billingCountry: true,
          contacts: { where: { kind: 'PRIMARY' }, select: { region: true } },
          submission: { select: { id: true } },
          tickets: { orderBy: { ticketNumber: 'asc' }, include: { requests: { orderBy: { lineNo: 'asc' } } } },
        },
      },
    },
  })
  if (!customer) return { ok: false, error: 'That lead no longer exists.' }
  const account = customer.accounts.find((a) => a.submission) ?? customer.accounts[0] ?? null
  const requests = account?.tickets.flatMap((t) => t.requests) ?? []
  if (!account || requests.length === 0) return { ok: false, error: 'The initial bill is made from the service requests on the onboarding form, and this lead has none yet.' }
  if (await prisma.invoice.count({ where: { customerId, kind: 'INITIAL', status: { not: 'VOID' } } }))
    return { ok: false, error: 'This lead already has an initial bill.' }

  // Each VA starts at its service's Standard Billing Rate (the confidential
  // one on Lead Management → Departments & services, Nov 5, 2026), or
  // Accounting's rate for the service when it has none.
  const [defaults, rates, standard] = await Promise.all([getBillingDefaults(), listRates(), standardRatesByOnboardingService()])
  const fallback = new Map(rates.map((r) => [r.service, n(r.hourlyRate)]))
  const rateOf = new Map([...fallback, ...standard])
  const start = billDefaultsFor({ ...account, region: account.contacts[0]?.region ?? null })
  const items = requests.map((r, i) => {
    const period = firstPeriod({
      scheduleType: r.scheduleType,
      targetStartDate: dayString(r.targetStartDate),
      hoursPerDay: r.hoursPerDay == null ? null : n(r.hoursPerDay),
      hoursPerWeek: r.hoursPerWeek == null ? null : n(r.hoursPerWeek),
      hoursPerMonth: r.hoursPerMonth == null ? null : n(r.hoursPerMonth),
      projectHours: r.projectHours == null ? null : n(r.projectHours),
      startTimePht: r.startTimePht,
      endTimePht: r.endTimePht,
      workDays: r.workDays,
    })
    return {
      ticketRequestId: r.id,
      lineNo: i + 1,
      service: r.service,
      department: departmentOf(r.service),
      scheduleType: r.scheduleType,
      numberOfVas: r.numberOfVas,
      periodStart: dateOnly(period.periodStart),
      periodEnd: period.periodEnd ? dateOnly(period.periodEnd) : null,
      hourlyRate: rateOf.get(r.service) ?? 0,
      hours: period.hours,
      ndHours: period.ndHours,
      hoursBasis: period.basis,
    }
  })
  const departments = [...new Set(items.map((i) => i.department))].map((department) => ({ department, exempt: otfExempt(department, items) }))
  const bill = billOf(
    { ...defaults, applyVat: start.applyVat, applyPaypalFee: start.applyPaypalFee },
    items.map((i) => ({ ...i, freeHours: 0, freeHoursRef: null, depositDiscountPercent: 0, depositApprovalRef: null })),
    departments.map((d) => ({ ...d, discountPercent: 0, approvalRef: null })),
    start.currency,
  )

  const id = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        kind: 'INITIAL',
        customerId,
        accountId: account.id,
        currency: start.currency,
        applyVat: start.applyVat,
        applyPaypalFee: start.applyPaypalFee,
        otfAmount: defaults.otf,
        depositAmount: defaults.deposit,
        ndPercent: defaults.ndPercent,
        vatPercent: defaults.vatPercent,
        paypalPercent: defaults.paypalPercent,
        createdByEmail: actor.email.toLowerCase(),
        items: { create: items },
        departments: { create: departments },
      },
      select: { id: true, invoiceNumber: true },
    })
    await writeBill(tx, inv.id, bill)
    await logActivity(tx, actor, {
      entityType: 'Invoice',
      entityId: inv.id,
      entityLabel: `${invoiceCode(inv.invoiceNumber)} (${customer.name})`,
      customerId,
      action: 'CREATE',
      newValue: bill.total,
      notes: 'Initial bill drafted from the service requests',
    })
    return inv.id
  }, BILL_TX)
  return { ok: true, data: { id } }
}

async function draftOf(invoiceId: string, customerId: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, departments: true, customer: { select: { name: true } } } })
  if (!inv || inv.customerId !== customerId) return null
  return inv
}

export async function saveDraft(actor: Actor, customerId: string, invoiceId: string, input: DraftBillInput): Promise<Result<{ total: number }>> {
  const parsed = draftBillSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the bill.' }
  const v = parsed.data
  const inv = await draftOf(invoiceId, customerId)
  if (!inv) return { ok: false, error: 'That bill no longer exists.' }
  if (inv.status !== 'DRAFT') return { ok: false, error: 'This bill has been sent, so it can’t change. Accounting can void it if it’s wrong.' }
  const itemIds = new Set(inv.items.map((i) => i.id))
  if (v.items.length !== inv.items.length || v.items.some((i) => !itemIds.has(i.id))) return { ok: false, error: 'The bill changed while you were editing it. Reload the page.' }
  const byItem = new Map(inv.items.map((i) => [i.id, i]))
  for (const i of v.items) {
    const item = byItem.get(i.id)!
    if (i.freeHours > i.hours * item.numberOfVas) return { ok: false, error: `Free hours on ${item.service} can’t be more than the hours billed.` }
  }

  // The saved bill with the edits applied: what gets written, and what the
  // lines are worked out from.
  const itemData = v.items.map((i) => ({
    id: i.id,
    data: {
      hourlyRate: i.hourlyRate,
      hours: i.hours,
      ndHours: i.ndHours,
      freeHours: i.freeHours,
      freeHoursRef: i.freeHours > 0 ? i.freeHoursRef || null : null,
      depositDiscountPercent: i.depositDiscountPercent,
      depositApprovalRef: i.depositDiscountPercent > 0 ? i.depositApprovalRef || null : null,
    },
  }))
  // An exempt department has no fee to discount.
  const deptData = v.departments.flatMap((d) => {
    const row = inv.departments.find((x) => x.department === d.department)
    return row && !row.exempt ? [{ id: row.id, data: { discountPercent: d.discountPercent, approvalRef: d.discountPercent > 0 ? d.approvalRef || null : null } }] : []
  })
  const edited = billInputs({
    ...inv,
    applyVat: v.applyVat,
    applyPaypalFee: v.applyPaypalFee,
    items: inv.items.map((i) => ({ ...i, ...itemData.find((x) => x.id === i.id)?.data })),
    departments: inv.departments.map((d) => ({ ...d, ...deptData.find((x) => x.id === d.id)?.data })),
  })
  const bill = billOf(edited.settings, edited.items, edited.departments, v.currency)

  const total = await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { currency: v.currency, applyVat: v.applyVat, applyPaypalFee: v.applyPaypalFee, notes: v.notes || null, updatedByEmail: actor.email.toLowerCase() },
    })
    for (const i of itemData) await tx.invoiceItem.update({ where: { id: i.id }, data: i.data })
    for (const d of deptData) await tx.invoiceDepartmentFee.update({ where: { id: d.id }, data: d.data })
    await writeBill(tx, invoiceId, bill)
    if (bill.total !== n(inv.total)) {
      await logActivity(tx, actor, {
        entityType: 'Invoice',
        entityId: invoiceId,
        entityLabel: `${invoiceCode(inv.invoiceNumber)} (${inv.customer.name})`,
        customerId,
        action: 'UPDATE',
        field: 'total',
        oldValue: n(inv.total),
        newValue: bill.total,
      })
    }
    return bill.total
  }, BILL_TX)
  return { ok: true, data: { total } }
}

export async function sendBill(actor: Actor, customerId: string, invoiceId: string): Promise<Result> {
  const inv = await draftOf(invoiceId, customerId)
  if (!inv) return { ok: false, error: 'That bill no longer exists.' }
  if (inv.status !== 'DRAFT') return { ok: false, error: 'This bill has already been sent.' }
  const missingRate = inv.items.find((i) => n(i.hourlyRate) <= 0 && n(i.hours) > 0)
  if (missingRate) return { ok: false, error: `Enter the hourly rate for ${missingRate.service} first.` }
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'SENT', sentAt: new Date(), sentByEmail: actor.email.toLowerCase() } })
    await logActivity(tx, actor, {
      entityType: 'Invoice',
      entityId: invoiceId,
      entityLabel: `${invoiceCode(inv.invoiceNumber)} (${inv.customer.name})`,
      customerId,
      action: 'INVOICE_SENT',
      newValue: `${inv.currency} ${n(inv.total).toFixed(2)}`,
    })
  }, BILL_TX)
  return { ok: true, data: null }
}

// A draft can be thrown away and made again from the requests.
export async function discardDraft(actor: Actor, customerId: string, invoiceId: string): Promise<Result> {
  const inv = await draftOf(invoiceId, customerId)
  if (!inv) return { ok: false, error: 'That bill no longer exists.' }
  if (inv.status !== 'DRAFT') return { ok: false, error: 'Only a draft can be discarded. Accounting can void a sent bill.' }
  await prisma.$transaction(async (tx) => {
    await tx.invoice.delete({ where: { id: invoiceId } })
    await logActivity(tx, actor, { entityType: 'Invoice', entityId: invoiceId, entityLabel: `${invoiceCode(inv.invoiceNumber)} (${inv.customer.name})`, customerId, action: 'DELETE', notes: 'Draft discarded' })
  }, BILL_TX)
  return { ok: true, data: null }
}

// ── Payments and voiding (Accounting) ────────────────────────────

async function syncPaid(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, total: true } })
  const sum = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } })
  const paid = n(sum._sum.amount)
  const status = statusAfterPayments(inv.status as InvoiceStatus, n(inv.total), paid)
  await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: paid, status } })
  return { paid, status }
}

export async function recordPayment(actor: Actor, invoiceId: string, input: PaymentInput): Promise<Result<{ customerId: string }>> {
  const parsed = paymentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the payment.' }
  const v = parsed.data
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { customerId: true, status: true, invoiceNumber: true, currency: true, customer: { select: { name: true } } } })
  if (!inv) return { ok: false, error: 'That bill no longer exists.' }
  if (inv.status === 'DRAFT') return { ok: false, error: 'The bill hasn’t been sent yet.' }
  if (inv.status === 'VOID') return { ok: false, error: 'This bill is void.' }
  if (v.paidOn > manilaToday()) return { ok: false, error: 'The payment date can’t be in the future.' }

  await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        invoiceId,
        customerId: inv.customerId,
        amount: v.amount,
        paidOn: dateOnly(v.paidOn),
        method: v.method,
        reference: v.reference || null,
        notes: v.notes || null,
        recordedByEmail: actor.email.toLowerCase(),
      },
    })
    const { status } = await syncPaid(tx, invoiceId)
    await logActivity(tx, actor, {
      entityType: 'Payment',
      entityId: p.id,
      entityLabel: `${invoiceCode(inv.invoiceNumber)} (${inv.customer.name})`,
      customerId: inv.customerId,
      action: 'CREATE',
      newValue: `${inv.currency} ${v.amount.toFixed(2)} on ${v.paidOn} (${v.method})`,
      notes: `Bill now ${status}`,
    })
  }, BILL_TX)
  return { ok: true, data: { customerId: inv.customerId } }
}

export async function removePayment(actor: Actor, paymentId: string): Promise<Result<{ invoiceId: string; customerId: string }>> {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: { select: { invoiceNumber: true, currency: true, customer: { select: { name: true } } } } } })
  if (!p) return { ok: false, error: 'That payment no longer exists.' }
  await prisma.$transaction(async (tx) => {
    await tx.payment.delete({ where: { id: paymentId } })
    await syncPaid(tx, p.invoiceId)
    await logActivity(tx, actor, {
      entityType: 'Payment',
      entityId: paymentId,
      entityLabel: `${invoiceCode(p.invoice.invoiceNumber)} (${p.invoice.customer.name})`,
      customerId: p.customerId,
      action: 'DELETE',
      oldValue: `${p.invoice.currency} ${n(p.amount).toFixed(2)} on ${dayString(p.paidOn)} (${p.method})`,
    })
  }, BILL_TX)
  return { ok: true, data: { invoiceId: p.invoiceId, customerId: p.customerId } }
}

// A sent bill that's wrong is voided, never edited; the Lead Manager then
// prepares a new one. Bills with payments keep them, so those can't be voided.
export async function voidInvoice(actor: Actor, invoiceId: string, reason: string): Promise<Result<{ customerId: string }>> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true, customerId: true, invoiceNumber: true, customer: { select: { name: true } }, _count: { select: { payments: true } } } })
  if (!inv) return { ok: false, error: 'That bill no longer exists.' }
  if (inv.status === 'DRAFT') return { ok: false, error: 'A draft isn’t sent yet; the Lead Manager can discard it instead.' }
  if (inv.status === 'VOID') return { ok: false, error: 'This bill is already void.' }
  if (inv._count.payments > 0) return { ok: false, error: 'This bill has payments recorded. Remove them first if they were a mistake.' }
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID', voidedAt: new Date(), voidedByEmail: actor.email.toLowerCase(), voidReason: reason } })
    await logActivity(tx, actor, {
      entityType: 'Invoice',
      entityId: invoiceId,
      entityLabel: `${invoiceCode(inv.invoiceNumber)} (${inv.customer.name})`,
      customerId: inv.customerId,
      action: 'INVOICE_VOIDED',
      notes: reason,
    })
  }, BILL_TX)
  return { ok: true, data: { customerId: inv.customerId } }
}

// ── Lists for the Accounting pages ───────────────────────────────

export async function listInvoices(params: { status?: InvoiceStatus; q?: string }) {
  const q = params.q?.trim()
  const number = q && /^(inv-?)?\d+$/i.test(q) ? Number(q.replace(/\D/g, '')) : null
  return prisma.invoice.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(q
        ? {
            OR: [
              ...(number ? [{ invoiceNumber: number }] : []),
              { customer: { name: { contains: q, mode: 'insensitive' as const } } },
              { customer: { customerCode: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
    orderBy: { invoiceNumber: 'desc' },
    take: 500,
    include: { customer: { select: { id: true, name: true, customerCode: true, isTest: true } } },
  })
}

export async function listPayments() {
  return prisma.payment.findMany({
    orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
    take: 500,
    include: { invoice: { select: { id: true, invoiceNumber: true, currency: true } }, customer: { select: { id: true, name: true, customerCode: true, isTest: true } } },
  })
}

// [7] Foregone Revenue: every reduction on a bill that went out.
export async function listForegone() {
  return prisma.invoiceLine.findMany({
    where: { foregoneType: { not: null }, invoice: { status: { notIn: ['DRAFT', 'VOID'] } } },
    orderBy: [{ invoice: { invoiceNumber: 'desc' } }, { lineNo: 'asc' }],
    take: 1000,
    include: { invoice: { select: { id: true, invoiceNumber: true, currency: true, sentAt: true, customer: { select: { id: true, name: true, isTest: true } } } } },
  })
}

// Payments recorded on a lead's bills: a lead with real payments can't be
// deleted (lib/lead-delete.ts).
export async function countLeadPayments(customerId: string) {
  return prisma.payment.count({ where: { customerId } })
}
