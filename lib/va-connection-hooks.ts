import type { Prisma } from '@/src/generated/prisma/client'
import { prisma } from '@/lib/prisma'

// Where Customers & Accounts meet VA connections (vaa_sys.va_connections,
// Nov 5, 2026). Every caller already goes through these functions.
//
// Before SQL 012 is applied the table doesn't exist; these then behave as if
// there were no connections, as they did before.

type Db = Prisma.TransactionClient | typeof prisma

// Checked outside any transaction (a failed query inside one would abort it),
// and remembered once the table is there.
let ready = false
let checkedAt = 0
export async function vaConnectionsReady(): Promise<boolean> {
  if (ready || Date.now() - checkedAt < 60_000) return ready
  checkedAt = Date.now()
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('vaa_sys.va_connections') IS NOT NULL AS ok`.catch(() => [{ ok: false }])
  ready = !!rows[0]?.ok
  return ready
}

// VA connections with status Started for the account, or for any account of
// the customer. Customers and accounts can't be terminated or cancelled while
// this is above zero (legacy _hasActiveVAConnections).
export async function countStartedVaConnections(db: Db, target: { customerId?: string; accountId?: string }): Promise<number> {
  if ((!target.customerId && !target.accountId) || !(await vaConnectionsReady())) return 0
  return db.vaConnection.count({ where: { status: 'STARTED', ...(target.accountId ? { accountId: target.accountId } : { customerId: target.customerId }) } })
}

// Started VA connections per customer, for the customer warnings ("has a VA
// but isn't Active", "Active with zero VAs"). null when connections can't be
// read, so those two warnings stay off rather than flagging everyone.
export async function startedVaCountsByCustomer(db: Db, customerIds: string[]): Promise<Map<string, number> | null> {
  if (!(await vaConnectionsReady())) return null
  if (customerIds.length === 0) return new Map()
  const rows = await db.vaConnection.groupBy({ by: ['customerId'], where: { status: 'STARTED', customerId: { in: customerIds } }, _count: { _all: true } })
  return new Map(rows.map((r) => [r.customerId, r._count._all]))
}

// Called when a VA connection Starts. It makes the account Active (from
// Pending/Paused), then its customer, through the same status path as a
// manual change.
export { activateOnConnectionStart } from '@/lib/status'
