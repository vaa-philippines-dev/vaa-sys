import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'

// The generic activity log every module writes to (legacy _writeLog). Pass
// the transaction client when the change itself is in a transaction, so the
// log row and the change commit or fail together.

type Db = Prisma.TransactionClient | typeof prisma

export type ActivityEntry = {
  entityType: string
  entityId: string
  // Human-readable name at the time (customer name, account code...), so
  // the log still reads well after renames or deletes.
  entityLabel?: string | null
  customerId?: string | null
  action: string
  field?: string | null
  oldValue?: unknown
  newValue?: unknown
  notes?: string | null
  effectiveDate?: Date | null
}

export type ActivityActor = { email: string; firstName?: string; lastName?: string }

// Old/new values are stored as text (legacy capped them at 500 chars; we
// keep 2000). Objects are stored as JSON.
function asText(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 2000 ? `${s.slice(0, 1999)}…` : s
}

export async function logActivity(db: Db, actor: ActivityActor, entries: ActivityEntry | ActivityEntry[]) {
  const list = Array.isArray(entries) ? entries : [entries]
  if (list.length === 0) return
  const actorName = [actor.firstName, actor.lastName].filter(Boolean).join(' ') || null
  await db.activityLog.createMany({
    data: list.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      entityLabel: e.entityLabel ?? null,
      customerId: e.customerId ?? null,
      action: e.action,
      field: e.field ?? null,
      oldValue: asText(e.oldValue),
      newValue: asText(e.newValue),
      notes: e.notes ?? null,
      actorEmail: actor.email.toLowerCase(),
      actorName,
      effectiveDate: e.effectiveDate ?? null,
    })),
  })
}

// One entry per changed field, for edit forms (legacy _logChanges).
export function fieldChanges(
  base: Omit<ActivityEntry, 'field' | 'oldValue' | 'newValue' | 'action'>,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): ActivityEntry[] {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null)
  return Object.keys(after)
    .filter((k) => JSON.stringify(norm(before[k])) !== JSON.stringify(norm(after[k])))
    .map((k) => ({ ...base, action: 'UPDATE', field: k, oldValue: before[k], newValue: after[k] }))
}
