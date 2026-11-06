'use server'

import { revalidatePath } from 'next/cache'
import { getActorFor } from '@/lib/auth'
import { addCandidate, changeRequestService, closeLost, createServiceRequest, moveCandidate, searchVas } from '@/lib/service-requests'
import { addCandidateSchema, closeLostSchema, declineSchema, SR_TYPES, startSchema, type SrType, type VaOption } from '@/lib/service-request-fields'
import { part2SchemaFor, firstIssue, type VaRequest } from '@/lib/onboarding-fields'
import { getWorkHourMinimums } from '@/lib/settings'
import type { ActionResult } from '@/lib/customer-fields'
import { reviewScheduleChange, updateRequestSchedule } from '@/lib/request-schedule'
import { REVIEWER, scheduleEditSchema, serviceChangeSchema, type ScheduleEdit } from '@/lib/request-schedule-fields'

// Service Requests (lib/service-requests.ts checks who may take each step).
const NO_ACCESS = 'You can’t change service requests.'

function refresh(ticketId: string) {
  revalidatePath('/service-requests')
  revalidatePath(`/service-requests/${ticketId}`)
  revalidatePath('/service-requests/schedule-changes')
  revalidatePath('/rate-agreements', 'layout')
  revalidatePath('/customers', 'layout')
  revalidatePath('/accounts', 'layout')
}

// A VA request's service and department (and so its Service Department
// Managers), confirmed on the page first.
export async function changeRequestServiceAction(requestId: string, input: { service: string; departmentId: string }): Promise<ActionResult<{ needsReview: boolean }>> {
  const actor = await getActorFor('serviceRequests', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = serviceChangeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Pick the service and department.' }
  const r = await changeRequestService(actor, requestId, parsed.data)
  if (!r.ok) return r
  refresh(r.data.ticketId)
  revalidatePath('/leads', 'layout')
  return { ok: true, data: { needsReview: r.data.needsReview } }
}

export async function findVas(query: string, departmentId: string | null): Promise<ActionResult<VaOption[]>> {
  const actor = await getActorFor('serviceRequests', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  return { ok: true, data: await searchVas(query.slice(0, 80), departmentId) }
}

export async function assignVa(ticketId: string, input: { requestId: string; vaProfileId: string; role: 'MAIN' | 'BUFFER' }): Promise<ActionResult> {
  const actor = await getActorFor('serviceRequests', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = addCandidateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Pick a VA.' }
  const r = await addCandidate(actor, ticketId, parsed.data)
  if (r.ok) refresh(ticketId)
  return r
}

// The Rate Agreement is confirmed on its own page (app/(cms)/rate-agreements).
type Step = 'toRateAgreement' | 'kickoffDone' | 'accepted' | 'declined' | 'withdraw' | 'started'
const STEPS: Step[] = ['toRateAgreement', 'kickoffDone', 'accepted', 'declined', 'withdraw', 'started']

export async function moveVa(candidateId: string, step: Step, extra: { reason?: string; startDate?: string } = {}): Promise<ActionResult> {
  const actor = await getActorFor('serviceRequests', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  if (!STEPS.includes(step)) return { ok: false, error: 'That step doesn’t exist.' }
  if (step === 'declined') {
    const p = declineSchema.safeParse({ reason: extra.reason ?? '' })
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Say why.' }
  }
  if (step === 'started') {
    const p = startSchema.safeParse({ startDate: extra.startDate ?? '' })
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Pick the start date.' }
  }
  const r = await moveCandidate(actor, candidateId, step, extra)
  if (!r.ok) return r
  refresh(r.data.ticketId)
  return { ok: true, data: null }
}

export async function closeAsLost(ticketId: string, reason: string): Promise<ActionResult> {
  const actor = await getActorFor('serviceRequests', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = closeLostSchema.safeParse({ reason })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Give a reason.' }
  const r = await closeLost(actor, ticketId, parsed.data.reason)
  if (r.ok) refresh(ticketId)
  return r
}

// A VA request's schedule (lib/request-schedule.ts). A change while the
// request is open waits for Executive Support's check.
export async function saveRequestSchedule(requestId: string, input: ScheduleEdit): Promise<ActionResult<{ changed: boolean; needsReview: boolean }>> {
  const actor = await getActorFor('serviceRequests', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = scheduleEditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the schedule.' }
  const r = await updateRequestSchedule(actor, requestId, parsed.data)
  if (!r.ok) return r
  refresh(r.data.ticketId)
  revalidatePath('/leads', 'layout')
  return { ok: true, data: { changed: r.data.changed, needsReview: r.data.needsReview } }
}

export async function checkScheduleChange(id: string, note: string): Promise<ActionResult> {
  const actor = await getActorFor('scheduleReviews', 'update')
  if (!actor) return { ok: false, error: `Only ${REVIEWER} can check schedule changes.` }
  const r = await reviewScheduleChange(actor, id, note.trim().slice(0, 500))
  if (!r.ok) return r
  refresh(r.data.ticketId)
  revalidatePath('/leads', 'layout')
  return { ok: true, data: null }
}

export async function openServiceRequest(accountId: string, type: SrType, requests: VaRequest[]): Promise<ActionResult<{ id: string }>> {
  const actor = await getActorFor('serviceRequests', 'create')
  if (!actor) return { ok: false, error: 'You can’t open service requests.' }
  if (!SR_TYPES.includes(type)) return { ok: false, error: 'Pick the type of service request.' }
  const parsed = part2SchemaFor(await getWorkHourMinimums()).safeParse({ requests })
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, 'VA request') }
  const r = await createServiceRequest(actor, accountId, type, parsed.data.requests)
  if (r.ok) refresh(r.data.id)
  return r
}
