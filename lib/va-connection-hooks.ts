import type { Prisma } from '@/src/generated/prisma/client'
import { prisma } from '@/lib/prisma'

// Where Customers & Accounts meet VA connections, which arrive in module 2
// (Service Requests + VA Connections). Every caller already goes through
// these functions, so module 2 only has to fill them in.

type Db = Prisma.TransactionClient | typeof prisma

// MODULE 2: count VA connections with status Started for the account, or
// for any account of the customer. Customers and accounts can't be
// terminated or cancelled while this is above zero (legacy
// _hasActiveVAConnections). No connections exist yet, so nothing blocks.
export async function countStartedVaConnections(db: Db, target: { customerId?: string; accountId?: string }): Promise<number> {
  void db
  void target
  return 0
}

// MODULE 2: Started VA connections per customer, for the customer warnings
// ("has a VA but isn't Active", "Active with zero VAs"). Return null while
// connections don't exist, so those two warnings stay off rather than
// flagging every Active customer.
export async function startedVaCountsByCustomer(db: Db, customerIds: string[]): Promise<Map<string, number> | null> {
  void db
  void customerIds
  return null
}

// MODULE 2: call this when a VA connection Starts. It makes the account
// Active (from Pending/Paused), then its customer, through the same status
// path as a manual change. Implemented in lib/status.ts; re-exported here
// so module 2 has one place to look.
export { activateOnConnectionStart } from '@/lib/status'
