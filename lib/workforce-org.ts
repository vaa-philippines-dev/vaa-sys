import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { fieldChanges, logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'
import { canViewRates, decryptRate, encryptRate, rateAad, ratesKeySet } from '@/lib/rates'
import { SERVICE_OFFERINGS } from '@/lib/onboarding-fields'
import type { DepartmentInput, OrgDepartment, OrgService, RateCell, ServiceDetailsInput, ServiceRatesInput } from '@/lib/workforce-org-fields'

// Server-only: Lead Management's Departments & services page
// (/leads/departments). VAA Workforce's service departments and services,
// plus what vaa-sys keeps about each service.
//
// Writes to Workforce are allowed for exactly two things (agreed on Nov 5,
// 2026), always raw SQL since Workforce's tables are never Prisma models:
// - public.departments, service level only: edit and add. Nothing is
//   deleted (it cascades through Workforce: teams, projects, channels,
//   memberships), so a department is set Inactive instead; merged and split
//   ones are read-only (merge and split in Workforce).
// - public.skills.job_description: a service's Job Description.
// Timestamps are written in UTC, as Workforce's own Prisma client writes them.
// Every change is logged in vaa_sys.activity_logs (Workforce's audit_logs are
// Workforce's).
//
// A service's contract template, onboarding form service and confidential
// rates are vaa-sys's own (vaa_sys.service_profiles; rates in lib/rates.ts).

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string }
type DepartmentRow = Omit<OrgDepartment, 'updatedAt'> & { updatedAt: Date }
const TX = { maxWait: 10_000, timeout: 20_000 }

// ── Service departments ───────────────────────────────────────────

export async function listServiceDepartmentsFull(): Promise<OrgDepartment[]> {
  const rows = await prisma.$queryRaw<DepartmentRow[]>`
    SELECT d.id, d.name, d.short_name AS "shortName", d.acronym, d.description, d.parent_id AS "parentId",
           d.level::text AS level, d.status::text AS status, d.sort_order AS "sortOrder",
           nullif(trim(coalesce(h.first_name, '') || ' ' || coalesce(h.last_name, '')), '') AS "headName",
           m.name AS "mergedIntoName",
           (SELECT count(*)::int FROM public.department_skills ds WHERE ds.department_id = d.id) AS "serviceCount",
           (SELECT count(*)::int FROM public.department_memberships dm WHERE dm.department_id = d.id AND dm.ended_at IS NULL) AS "memberCount",
           d.updated_at AS "updatedAt"
    FROM public.departments d
    LEFT JOIN public.users h ON h.id = d.head_id
    LEFT JOIN public.departments m ON m.id = d.merged_into_id
    WHERE d.level::text = 'SERVICE'
    ORDER BY d.sort_order, d.name`
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))
}

const blank = (s: string) => (s.trim() === '' ? null : s.trim())

const departmentFields = (d: Pick<OrgDepartment, 'name' | 'shortName' | 'acronym' | 'description' | 'parentId' | 'status' | 'sortOrder'>) => ({
  name: d.name,
  shortName: d.shortName,
  acronym: d.acronym,
  description: d.description,
  parentId: d.parentId,
  status: d.status,
  sortOrder: d.sortOrder,
})

// A department can't sit under itself or under one of its own sub-departments.
function wouldLoop(id: string | null, parentId: string | null, all: OrgDepartment[]) {
  if (!parentId) return false
  if (parentId === id) return true
  const byId = new Map(all.map((d) => [d.id, d]))
  const seen = new Set<string>()
  for (let cur: string | null = parentId; cur && !seen.has(cur); cur = byId.get(cur)?.parentId ?? null) {
    if (cur === id) return true
    seen.add(cur)
  }
  return false
}

export async function saveDepartment(actor: Actor, id: string | null, v: DepartmentInput): Promise<Result<{ id: string }>> {
  // Service level only, so the list and its checks are the service departments.
  const all = await listServiceDepartmentsFull()
  const current = id ? all.find((d) => d.id === id) : null
  if (id && !current) return { ok: false, error: 'That service department no longer exists in Workforce.' }
  if (current && current.status !== 'ACTIVE' && current.status !== 'INACTIVE')
    return { ok: false, error: 'A merged or split department is read-only here. Change it in Workforce.' }
  if (v.parentId && !all.some((d) => d.id === v.parentId)) return { ok: false, error: 'Pick a service department for it to sit under.' }
  if (wouldLoop(id, v.parentId, all)) return { ok: false, error: 'A department can’t sit under itself or one of its own sub-departments.' }
  const name = v.name.trim()
  const taken = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM public.departments WHERE lower(trim(name)) = ${name.toLowerCase()} AND id <> ${id ?? ''}`
  if (taken[0]?.n) return { ok: false, error: `Workforce already has a department called “${name}”.` }

  const next = { name, shortName: blank(v.shortName), acronym: blank(v.acronym), description: blank(v.description), parentId: v.parentId, status: v.status, sortOrder: v.sortOrder }

  const savedId = await prisma.$transaction(async (tx) => {
    if (current) {
      await tx.$executeRaw`
        UPDATE public.departments
        SET name = ${next.name}, short_name = ${next.shortName}, acronym = ${next.acronym}, description = ${next.description},
            parent_id = ${next.parentId}, status = ${next.status}::public."DepartmentStatus",
            sort_order = ${next.sortOrder}, updated_at = now() AT TIME ZONE 'utc'
        WHERE id = ${current.id} AND level::text = 'SERVICE'`
      await logActivity(tx, actor, fieldChanges({ entityType: 'Department', entityId: current.id, entityLabel: next.name }, departmentFields(current), next))
      return current.id
    }
    const newId = randomUUID()
    await tx.$executeRaw`
      INSERT INTO public.departments (id, name, short_name, acronym, description, parent_id, level, status, sort_order, created_at, updated_at)
      VALUES (${newId}, ${next.name}, ${next.shortName}, ${next.acronym}, ${next.description}, ${next.parentId},
              'SERVICE'::public."DepartmentLevel", ${next.status}::public."DepartmentStatus", ${next.sortOrder},
              now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')`
    await logActivity(tx, actor, { entityType: 'Department', entityId: newId, entityLabel: next.name, action: 'CREATE', newValue: next, notes: 'Added in Workforce from Lead Management' })
    return newId
  }, TX)
  return { ok: true, data: { id: savedId } }
}

// ── Services ──────────────────────────────────────────────────────

type SkillRow = { id: string; name: string; category: string; isActive: boolean; jobDescription: string | null; departmentIds: string[] }

async function listSkills(): Promise<SkillRow[]> {
  return prisma.$queryRaw<SkillRow[]>`
    SELECT s.id, s.name, s.category::text AS category, s.is_active AS "isActive", s.job_description AS "jobDescription",
           coalesce(array_agg(ds.department_id) FILTER (WHERE ds.department_id IS NOT NULL), ARRAY[]::text[]) AS "departmentIds"
    FROM public.skills s
    LEFT JOIN public.department_skills ds ON ds.skill_id = s.id
    GROUP BY s.id
    ORDER BY s.name`
}

const cell = (stored: string | null, aad: string): RateCell => {
  if (!stored) return { value: null, problem: null }
  const d = decryptRate(stored, aad)
  return d.ok ? { value: d.value, problem: null } : { value: null, problem: d.reason }
}

// The rates are decrypted only for someone allowed to see them; for anyone
// else they aren't read at all, so they never reach the page.
export async function listOrgServices(viewerEmail: string): Promise<OrgService[]> {
  const [skills, profiles, showRates] = await Promise.all([listSkills(), prisma.serviceProfile.findMany(), canViewRates(viewerEmail)])
  const profileOf = new Map(profiles.map((p) => [p.skillId, p]))
  return skills.map((s) => {
    const p = profileOf.get(s.id)
    return {
      ...s,
      contractId: p?.contractId ?? null,
      onboardingService: p?.onboardingService ?? null,
      ...(showRates
        ? {
            rates: {
              standard: cell(p?.standardRateCipher ?? null, rateAad(s.id, 'standard')),
              vaBase: cell(p?.vaBaseRateCipher ?? null, rateAad(s.id, 'vaBase')),
              updatedAt: p?.ratesUpdatedAt?.toISOString() ?? null,
              updatedBy: p?.ratesUpdatedByEmail ?? null,
            },
          }
        : {}),
    }
  })
}

export async function saveServiceDetails(actor: Actor, skillId: string, v: ServiceDetailsInput): Promise<Result> {
  const skill = (await listSkills()).find((s) => s.id === skillId)
  if (!skill) return { ok: false, error: 'That service no longer exists in Workforce.' }
  if (v.contractId && !(await prisma.contract.count({ where: { id: v.contractId } }))) return { ok: false, error: 'That contract no longer exists.' }
  if (v.onboardingService && !(SERVICE_OFFERINGS as readonly string[]).includes(v.onboardingService)) return { ok: false, error: 'Pick an onboarding form service from the list.' }
  const before = await prisma.serviceProfile.findUnique({ where: { skillId } })
  if (v.onboardingService) {
    const other = await prisma.serviceProfile.findFirst({ where: { onboardingService: v.onboardingService, NOT: { skillId } } })
    if (other) {
      const otherName = (await listSkills()).find((s) => s.id === other.skillId)?.name ?? 'another service'
      return { ok: false, error: `“${v.onboardingService}” is already billed as ${otherName}. Clear it there first.` }
    }
  }
  const jd = blank(v.jobDescription)

  await prisma.$transaction(async (tx) => {
    if ((skill.jobDescription ?? null) !== jd) {
      await tx.$executeRaw`UPDATE public.skills SET job_description = ${jd}, updated_at = now() AT TIME ZONE 'utc' WHERE id = ${skillId}`
    }
    await tx.serviceProfile.upsert({
      where: { skillId },
      create: { skillId, contractId: v.contractId, onboardingService: v.onboardingService, updatedByEmail: actor.email.toLowerCase() },
      update: { contractId: v.contractId, onboardingService: v.onboardingService, updatedByEmail: actor.email.toLowerCase() },
    })
    await logActivity(
      tx,
      actor,
      fieldChanges(
        { entityType: 'Service', entityId: skillId, entityLabel: skill.name },
        { jobDescription: skill.jobDescription ?? null, contractId: before?.contractId ?? null, onboardingService: before?.onboardingService ?? null },
        { jobDescription: jd, contractId: v.contractId, onboardingService: v.onboardingService }
      )
    )
  }, TX)
  return { ok: true, data: null }
}

// Rate viewers only. The log says which rate changed, never its value.
export async function saveServiceRates(actor: Actor, skillId: string, v: ServiceRatesInput): Promise<Result> {
  if (!(await canViewRates(actor.email))) return { ok: false, error: 'You can’t change the confidential rates.' }
  if (!ratesKeySet()) return { ok: false, error: 'The rates key isn’t set on this server, so rates can’t be saved here. Use the live site.' }
  const skill = (await listSkills()).find((s) => s.id === skillId)
  if (!skill) return { ok: false, error: 'That service no longer exists in Workforce.' }
  const before = await prisma.serviceProfile.findUnique({ where: { skillId } })
  const old = {
    standard: before?.standardRateCipher ? decryptRate(before.standardRateCipher, rateAad(skillId, 'standard')) : null,
    vaBase: before?.vaBaseRateCipher ? decryptRate(before.vaBaseRateCipher, rateAad(skillId, 'vaBase')) : null,
  }
  const same = (d: (typeof old)['standard'], next: number | null) => (d === null ? next === null : d.ok && next !== null && d.value === next)
  const changed = (['standard', 'vaBase'] as const).filter((k) => !same(old[k], v[k]))
  if (changed.length === 0) return { ok: true, data: null }

  const data = {
    standardRateCipher: v.standard === null ? null : encryptRate(v.standard, rateAad(skillId, 'standard')),
    vaBaseRateCipher: v.vaBase === null ? null : encryptRate(v.vaBase, rateAad(skillId, 'vaBase')),
    ratesUpdatedAt: new Date(),
    ratesUpdatedByEmail: actor.email.toLowerCase(),
  }
  const label = { standard: 'Standard Billing Rate', vaBase: 'VA Base Rate' }
  await prisma.$transaction(async (tx) => {
    await tx.serviceProfile.upsert({ where: { skillId }, create: { skillId, ...data }, update: data })
    await logActivity(
      tx,
      actor,
      changed.map((k) => ({ entityType: 'Service', entityId: skillId, entityLabel: skill.name, action: 'UPDATE', field: label[k], notes: 'Confidential rate changed (value not logged)' }))
    )
  }, TX)
  return { ok: true, data: null }
}

// ── For new bills ─────────────────────────────────────────────────

// The Standard Billing Rate for each onboarding form service, for a new
// initial bill (lib/billing.ts). Read on the server whoever prepares the
// bill; a service without one (or a server without the key) falls back to
// Accounting's rates.
export async function standardRatesByOnboardingService(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!ratesKeySet()) return out
  const profiles = await prisma.serviceProfile.findMany({ where: { onboardingService: { not: null }, standardRateCipher: { not: null } } })
  for (const p of profiles) {
    const d = decryptRate(p.standardRateCipher!, rateAad(p.skillId, 'standard'))
    if (d.ok) out.set(p.onboardingService!, d.value)
  }
  return out
}
