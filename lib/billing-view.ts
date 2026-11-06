import { invoiceCode, type BillLine, type BillingDefaults, type Currency, type InvoiceStatus } from '@/lib/billing-fields'
import { dayString } from '@/lib/customer-fields'
import type { ScheduleType } from '@/lib/onboarding-fields'
import type { InvoiceFull, voidedInitialBills } from '@/lib/billing'

// A bill as plain data for the pages (Prisma's Decimals and Dates don't cross
// into client components). Built on the server by invoiceView().

export type InvoiceView = {
  id: string
  code: string
  status: InvoiceStatus
  currency: Currency
  applyVat: boolean
  applyPaypalFee: boolean
  settings: BillingDefaults
  subtotal: number
  vatAmount: number
  paypalFeeAmount: number
  total: number
  amountPaid: number
  notes: string | null
  createdAt: string
  createdByEmail: string
  sentAt: string | null
  sentByEmail: string | null
  voidedAt: string | null
  voidedByEmail: string | null
  voidReason: string | null
  customer: { id: string; name: string; customerCode: string; email: string | null; isTest: boolean }
  account: { id: string; name: string; accountCode: string; invoiceContactName: string | null; invoiceContactEmail: string } | null
  items: {
    id: string
    lineNo: number
    service: string
    department: string
    scheduleType: ScheduleType
    numberOfVas: number
    periodStart: string
    periodEnd: string | null
    hourlyRate: number
    hours: number
    ndHours: number
    hoursBasis: string
    freeHours: number
    freeHoursRef: string | null
    depositDiscountPercent: number
    depositApprovalRef: string | null
  }[]
  departments: { department: string; exempt: boolean; discountPercent: number; approvalRef: string | null }[]
  lines: BillLine[]
  payments: { id: string; amount: number; paidOn: string; method: string; reference: string | null; notes: string | null; recordedByEmail: string }[]
}

export type InitialBillView = {
  invoice: InvoiceView | null
  voided: { id: string; code: string; total: number; currency: Currency; voidedAt: string | null; voidReason: string | null }[]
  // The rates and fees a new bill would start from, for the empty state.
  defaults: BillingDefaults
  // Can open the bill in the Accounting System.
  canOpenAccounting: boolean
}

const n = (d: unknown) => (d == null ? 0 : Number(d))
const iso = (d: Date | null) => (d ? d.toISOString() : null)

export function invoiceView(inv: InvoiceFull): InvoiceView {
  return {
    id: inv.id,
    code: invoiceCode(inv.invoiceNumber),
    status: inv.status,
    currency: inv.currency,
    applyVat: inv.applyVat,
    applyPaypalFee: inv.applyPaypalFee,
    settings: { otf: n(inv.otfAmount), deposit: n(inv.depositAmount), ndPercent: n(inv.ndPercent), vatPercent: n(inv.vatPercent), paypalPercent: n(inv.paypalPercent) },
    subtotal: n(inv.subtotal),
    vatAmount: n(inv.vatAmount),
    paypalFeeAmount: n(inv.paypalFeeAmount),
    total: n(inv.total),
    amountPaid: n(inv.amountPaid),
    notes: inv.notes,
    createdAt: inv.createdAt.toISOString(),
    createdByEmail: inv.createdByEmail,
    sentAt: iso(inv.sentAt),
    sentByEmail: inv.sentByEmail,
    voidedAt: iso(inv.voidedAt),
    voidedByEmail: inv.voidedByEmail,
    voidReason: inv.voidReason,
    customer: inv.customer,
    account: inv.account && {
      id: inv.account.id,
      name: inv.account.name,
      accountCode: inv.account.accountCode,
      invoiceContactName: inv.account.invoiceContactName,
      invoiceContactEmail: inv.account.invoiceContactEmail,
    },
    items: inv.items.map((i) => ({
      id: i.id,
      lineNo: i.lineNo,
      service: i.service,
      department: i.department,
      scheduleType: i.scheduleType,
      numberOfVas: i.numberOfVas,
      periodStart: dayString(i.periodStart),
      periodEnd: i.periodEnd ? dayString(i.periodEnd) : null,
      hourlyRate: n(i.hourlyRate),
      hours: n(i.hours),
      ndHours: n(i.ndHours),
      hoursBasis: i.hoursBasis,
      freeHours: n(i.freeHours),
      freeHoursRef: i.freeHoursRef,
      depositDiscountPercent: n(i.depositDiscountPercent),
      depositApprovalRef: i.depositApprovalRef,
    })),
    departments: inv.departments.map((d) => ({ department: d.department, exempt: d.exempt, discountPercent: n(d.discountPercent), approvalRef: d.approvalRef })),
    lines: inv.lines.map((l) => ({
      lineNo: l.lineNo,
      kind: l.kind,
      description: l.description,
      calculation: l.calculation,
      amount: n(l.amount),
      department: l.department,
      foregoneAmount: n(l.foregoneAmount),
      foregoneType: l.foregoneType,
      approvalRef: l.approvalRef,
    })),
    payments: inv.payments.map((p) => ({
      id: p.id,
      amount: n(p.amount),
      paidOn: dayString(p.paidOn),
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      recordedByEmail: p.recordedByEmail,
    })),
  }
}

export function initialBillView(
  inv: InvoiceFull | null,
  voided: Awaited<ReturnType<typeof voidedInitialBills>>,
  defaults: BillingDefaults,
  canOpenAccounting: boolean
): InitialBillView {
  return {
    invoice: inv ? invoiceView(inv) : null,
    voided: voided.map((v) => ({ id: v.id, code: invoiceCode(v.invoiceNumber), total: n(v.total), currency: v.currency, voidedAt: iso(v.voidedAt), voidReason: v.voidReason })),
    defaults,
    canOpenAccounting,
  }
}
