import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { ACCOUNT_STATUSES, type AccountStatus } from '@/lib/customer-fields'

// Server-only reads for the Accounts pages. scope is the person's customer
// scope (lib/scope.ts); an account is in scope when its customer is.

export async function listAccounts(params: { q?: string; status?: string; scope: Prisma.CustomerWhereInput | null }) {
  const q = params.q?.trim()
  const status = ACCOUNT_STATUSES.includes(params.status as AccountStatus) ? (params.status as AccountStatus) : undefined
  const where: Prisma.AccountWhereInput = {
    customer: params.scope ?? {},
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { companyName: { contains: q, mode: 'insensitive' } },
            { accountCode: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const [rows, counts] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true,
        accountCode: true,
        name: true,
        companyName: true,
        status: true,
        statusChangedAt: true,
        isReturning: true,
        reviewAction: true,
        category: { select: { label: true } },
        type: { select: { label: true } },
        countryRegion: { select: { label: true } },
        customer: { select: { id: true, name: true } },
        _count: { select: { managers: true } },
      },
    }),
    prisma.account.groupBy({ by: ['status'], where: { customer: params.scope ?? {} }, _count: { _all: true } }),
  ])
  return { rows, byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<AccountStatus, number>> }
}

export async function getAccount(id: string) {
  return prisma.account.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, customerCode: true, status: true, assignedSpecialistEmail: true } },
      category: { select: { id: true, label: true } },
      type: { select: { id: true, label: true } },
      countryRegion: { select: { id: true, label: true, timezone: true } },
      contract: { include: { sections: { include: { sectionDef: true } } } },
      managers: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      contacts: { orderBy: { kind: 'asc' } },
      statusLogs: { orderBy: { changedAt: 'desc' }, include: { terminationReason: { select: { label: true } } } },
      submission: { select: { submittedAt: true, part3: true, part3SubmittedAt: true, link: { select: { token: true, revokedAt: true } } } },
      tickets: { orderBy: { ticketNumber: 'asc' }, include: { requests: { orderBy: { lineNo: 'asc' } } } },
    },
  })
}

// The account's own notes and its customer's, newest first.
export async function accountNotes(accountId: string, customerId: string) {
  return prisma.customerAccountNote.findMany({
    where: { customerId, OR: [{ accountId }, { accountId: null }] },
    orderBy: { createdAt: 'desc' },
    include: { account: { select: { name: true } } },
  })
}
