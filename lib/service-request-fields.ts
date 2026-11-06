import { z } from 'zod'
import { ticketCode } from '@/lib/onboarding-fields'

// Client-safe: Customer Management's Service Requests (Nov 5, 2026). A
// service request is a ticket (vaa_sys.tickets): the onboarding form's is
// the account's New one, and Additional, Replacement and Reliever tickets are
// opened later. Each of its VA requests (sub-tickets) needs one VA.
//
// The workflow:
//   New: the customer's CS assigns it to a Service Department Manager.
//   VA Assignment: that manager puts forward a main VA and buffer VAs for
//     each VA request.
//   VA Preparation & Mock Interview: per VA; the manager moves each prepared
//     VA on to Rate Agreement.
//   Rate Agreement: an HR Specialist confirms it, per VA.
//   CS Kick-off Call: the customer's CS holds it and marks it done.
//   VA Connection Call: the CS records whether the client accepted the VA. A
//     declined VA drops out; the ticket follows the next candidate, or goes
//     back to VA Assignment when there is none.
//   Start VA: the manager marks the accepted VA started, which makes the VA
//     connection. Once every VA request has a started VA, the ticket is
//     Closed - Won.
// The ticket's phase is its most advanced active candidate's (asked for on
// Nov 5, 2026): one VA in Rate Agreement and another in the Connection Call
// puts the ticket in the Connection Call.

export const SR_TYPES = ['NEW', 'ADDITIONAL', 'REPLACEMENT', 'RELIEVER'] as const
export type SrType = (typeof SR_TYPES)[number]
export const SR_TYPE_LABELS: Record<SrType, string> = { NEW: 'New', ADDITIONAL: 'Additional', REPLACEMENT: 'Replacement', RELIEVER: 'Reliever' }

export const SR_PHASES = ['NEW', 'VA_ASSIGNMENT', 'VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA', 'CLOSED_WON', 'CLOSED_LOST'] as const
export type SrPhase = (typeof SR_PHASES)[number]
export const SR_PHASE_LABELS: Record<SrPhase, string> = {
  NEW: 'New',
  VA_ASSIGNMENT: 'VA Assignment',
  VA_PREPARATION: 'VA Preparation & Mock Interview',
  RATE_AGREEMENT: 'Rate Agreement',
  KICKOFF_CALL: 'CS Kick-off Call',
  CONNECTION_CALL: 'VA Connection Call',
  START_VA: 'Start VA',
  CLOSED_WON: 'Closed - Won',
  CLOSED_LOST: 'Closed - Lost',
}
// Who acts in each phase.
export const SR_PHASE_OWNERS: Record<SrPhase, string> = {
  NEW: 'CS assigned',
  VA_ASSIGNMENT: 'Service Department Manager',
  VA_PREPARATION: 'Service Department Manager',
  RATE_AGREEMENT: 'HR Specialist',
  KICKOFF_CALL: 'CS assigned',
  CONNECTION_CALL: 'CS assigned',
  START_VA: 'Service Department Manager',
  CLOSED_WON: '',
  CLOSED_LOST: '',
}
export const OPEN_PHASES: SrPhase[] = ['NEW', 'VA_ASSIGNMENT', 'VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA']
export const isClosed = (p: SrPhase) => p === 'CLOSED_WON' || p === 'CLOSED_LOST'

export const CANDIDATE_STAGES = ['VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA', 'STARTED', 'DECLINED', 'WITHDRAWN'] as const
export type CandidateStage = (typeof CANDIDATE_STAGES)[number]
export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  VA_PREPARATION: 'VA Preparation & Mock Interview',
  RATE_AGREEMENT: 'Rate Agreement',
  KICKOFF_CALL: 'CS Kick-off Call',
  CONNECTION_CALL: 'VA Connection Call',
  START_VA: 'Accepted, to start',
  STARTED: 'Started',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
}
// Still in the running: counts towards the ticket's phase.
export const ACTIVE_STAGES: CandidateStage[] = ['VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA']
export type CandidateRole = 'MAIN' | 'BUFFER'
export const ROLE_LABELS: Record<CandidateRole, string> = { MAIN: 'Main VA', BUFFER: 'Buffer VA' }

// A ticket's phase from where it stands (see the top of this file).
export function phaseFor(t: {
  closed: 'WON' | 'LOST' | null
  hasManager: boolean
  requests: { started: boolean; stages: CandidateStage[] }[]
}): SrPhase {
  if (t.closed === 'LOST') return 'CLOSED_LOST'
  if (t.requests.length > 0 && t.requests.every((r) => r.started)) return 'CLOSED_WON'
  if (t.closed === 'WON') return 'CLOSED_WON'
  if (!t.hasManager) return 'NEW'
  const active = t.requests.filter((r) => !r.started).flatMap((r) => r.stages.filter((s) => ACTIVE_STAGES.includes(s)))
  if (active.length === 0) return 'VA_ASSIGNMENT'
  return active.reduce((best, s) => (ACTIVE_STAGES.indexOf(s) > ACTIVE_STAGES.indexOf(best) ? s : best), active[0]) as SrPhase
}

export const srCode = (ticketNumber: number) => ticketCode(ticketNumber)

const text = (max: number) => z.string().trim().max(max)

export const assignManagerSchema = z.object({ managerEmail: z.email('Pick the Service Department Manager.') })
export const addCandidateSchema = z.object({
  requestId: z.string().min(1),
  vaProfileId: z.string().min(1, 'Pick a VA.'),
  role: z.enum(['MAIN', 'BUFFER']),
})
export const declineSchema = z.object({ reason: text(1000).min(1, 'Say why the client declined.') })
export const startSchema = z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the start date.') })
export const closeLostSchema = z.object({ reason: text(1000).min(1, 'Give a reason for closing it as lost.') })

export type VaOption = { id: string; name: string; email: string | null; departments: string[]; availability: string | null; working: number }
