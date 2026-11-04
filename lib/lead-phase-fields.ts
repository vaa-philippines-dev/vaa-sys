import { z } from 'zod'

// Client-safe: Lead Management's workflow phases (Nov 4, 2026). The phase is
// never picked by hand; it is what the lead's facts add up to (leadPhaseFor),
// and lib/lead-phase.ts keeps customers.lead_phase and its log in step.
//
// Regular request:
//   Customer Intake → (form submitted) Contract & Billing Initiation
//   → (contract sent) Contract & Payment Confirmation
//   → (signed contract and first payment confirmed) Customer Success Handoff
//   → (CS team onboarded the customer) New Customer Onboarded
// Special Request (the customer meets the VA first; the CEO approves it
// outside the app): after the form it skips straight to Customer Success
// Handoff, and the contract and payment are confirmed after the handoff,
// before New Customer Onboarded.
//
// Initial billing (from the Accounting system) belongs in Contract & Billing
// Initiation too; it arrives with the billing module.

export const LEAD_PHASES = [
  'CUSTOMER_INTAKE',
  'CONTRACT_BILLING_INITIATION',
  'CONTRACT_PAYMENT_CONFIRMATION',
  'CUSTOMER_SUCCESS_HANDOFF',
  'NEW_CUSTOMER_ONBOARDED',
] as const
export type LeadPhase = (typeof LEAD_PHASES)[number]

export const PHASE_LABELS: Record<LeadPhase, string> = {
  CUSTOMER_INTAKE: 'Customer Intake',
  CONTRACT_BILLING_INITIATION: 'Contract & Billing Initiation',
  CONTRACT_PAYMENT_CONFIRMATION: 'Contract & Payment Confirmation',
  CUSTOMER_SUCCESS_HANDOFF: 'Customer Success Handoff',
  NEW_CUSTOMER_ONBOARDED: 'New Customer Onboarded',
}

// The order a lead goes through them, which differs for a Special Request.
export function phaseOrder(requestType: LeadRequestType): LeadPhase[] {
  return requestType === 'SPECIAL'
    ? ['CUSTOMER_INTAKE', 'CONTRACT_BILLING_INITIATION', 'CUSTOMER_SUCCESS_HANDOFF', 'CONTRACT_PAYMENT_CONFIRMATION', 'NEW_CUSTOMER_ONBOARDED']
    : [...LEAD_PHASES]
}

export const REQUEST_TYPES = ['REGULAR', 'SPECIAL'] as const
export type LeadRequestType = (typeof REQUEST_TYPES)[number]
export const REQUEST_TYPE_LABELS: Record<LeadRequestType, string> = { REGULAR: 'Regular Request', SPECIAL: 'Special Request' }

export type PhaseFacts = {
  formSubmitted: boolean
  requestType: LeadRequestType
  contractSent: boolean
  contractConfirmed: boolean
  handoffCompleted: boolean
}

export function leadPhaseFor(f: PhaseFacts): LeadPhase {
  if (!f.formSubmitted) return 'CUSTOMER_INTAKE'
  if (f.requestType === 'SPECIAL') {
    if (!f.handoffCompleted) return 'CUSTOMER_SUCCESS_HANDOFF'
    return f.contractConfirmed ? 'NEW_CUSTOMER_ONBOARDED' : 'CONTRACT_PAYMENT_CONFIRMATION'
  }
  if (!f.contractSent) return 'CONTRACT_BILLING_INITIATION'
  if (!f.contractConfirmed) return 'CONTRACT_PAYMENT_CONFIRMATION'
  return f.handoffCompleted ? 'NEW_CUSTOMER_ONBOARDED' : 'CUSTOMER_SUCCESS_HANDOFF'
}

// Contract & Payment Confirmation's form: the day the customer signed and
// the day of their first payment (Manila calendar days, not in the future).
const day = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label}.`)
export const confirmContractSchema = z.object({
  signedOn: day('date the contract was signed'),
  paymentDate: day('date of the first payment'),
})
export type ConfirmContractInput = z.input<typeof confirmContractSchema>

// The email that sends a contract to the lead: the template link and the
// terms this contract has.
export function contractEmail(p: {
  customerName: string
  senderName: string
  contractName: string
  contractCode: string
  templateUrl: string | null
  terms: { name: string; value: string }[]
}) {
  const terms = p.terms.length ? `\n\nThe terms of this contract:\n${p.terms.map((t) => `- ${t.name}: ${t.value}`).join('\n')}` : ''
  const link = p.templateUrl ? `\n\nYou can read the contract here:\n${p.templateUrl}` : ''
  return {
    subject: `Your VAA Philippines contract (${p.contractCode})`,
    body:
      `Hi ${p.customerName},\n\nThank you for completing our onboarding form. Here is your ${p.contractName} contract for review and signature.` +
      `${link}${terms}\n\nPlease sign and send it back to us, or reply to this email with any questions.\n\nBest regards,\n${p.senderName}\nVAA Philippines`,
  }
}
