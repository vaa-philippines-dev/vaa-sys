import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import type { Actor } from '@/lib/auth'
import { customerScopeWhere } from '@/lib/scope'

// Server-only: Customer Management's VA Connections list (Nov 6, 2026). A
// connection is made when a Service Department Manager marks a VA started on
// a service request (lib/service-requests.ts); the legacy CMS's connections
// are imported. A CS Specialist sees their own customers'.

export const VA_CONNECTION_STATUSES = ['STARTED', 'PAUSED', 'PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'TERMINATED', 'UNKNOWN'] as const
export type VaConnectionStatus = (typeof VA_CONNECTION_STATUSES)[number]
export const VA_CONNECTION_STATUS_LABELS: Record<VaConnectionStatus, string> = {
  STARTED: 'Started',
  PAUSED: 'Paused',
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  TERMINATED: 'Terminated',
  UNKNOWN: 'Unknown',
}

export const VA_CONNECTIONS_SHOWN = 1000

async function baseWhere(actor: Actor, q: string): Promise<Prisma.VaConnectionWhereInput> {
  const scope = await customerScopeWhere(actor)
  return {
    AND: [
      scope ? { customer: scope } : {},
      q
        ? {
            OR: [
              { vaName: { contains: q, mode: 'insensitive' as const } },
              { connectionCode: { contains: q, mode: 'insensitive' as const } },
              { service: { contains: q, mode: 'insensitive' as const } },
              { account: { name: { contains: q, mode: 'insensitive' as const } } },
              { customer: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {},
    ],
  }
}

export async function listVaConnections(actor: Actor, params: { status: VaConnectionStatus | 'ALL'; q: string }) {
  const base = await baseWhere(actor, params.q)
  const [rows, counts] = await Promise.all([
    prisma.vaConnection.findMany({
      where: { AND: [base, params.status === 'ALL' ? {} : { status: params.status }] },
      orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: VA_CONNECTIONS_SHOWN,
      include: {
        customer: { select: { id: true, name: true, isTest: true } },
        account: { select: { id: true, name: true, accountCode: true } },
        ticket: { select: { id: true, ticketNumber: true } },
        candidate: { select: { request: { select: { lineNo: true } } } },
      },
    }),
    prisma.vaConnection.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
  ])
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<VaConnectionStatus, number>> }
}
