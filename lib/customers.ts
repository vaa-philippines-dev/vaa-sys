import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { CUSTOMER_STATUSES, onboardingStage, type CustomerMatch, type CustomerStatus } from '@/lib/customer-fields'

// Server-only reads for both areas. Labels and input schemas live in
// lib/customer-fields.ts so client components never pull in Prisma/pg.

const linkFields = { revokedAt: true, expiresAt: true, openedAt: true, submittedAt: true } as const

// scope: the person's customer scope from lib/scope.ts (null = everyone).
export async function listCustomers(params: { q?: string; status?: string; specialist?: string; review?: boolean; scope?: Prisma.CustomerWhereInput | null }) {
  const q = params.q?.trim()
  const status = CUSTOMER_STATUSES.includes(params.status as CustomerStatus) ? (params.status as CustomerStatus) : undefined
  const scoped: Prisma.CustomerWhereInput = params.scope ?? {}
  const where: Prisma.CustomerWhereInput = {
    AND: [scoped],
    ...(status ? { status } : {}),
    // 'none' = no CS Specialist yet.
    ...(params.specialist ? { assignedSpecialistEmail: params.specialist === 'none' ? null : params.specialist.toLowerCase() } : {}),
    ...(params.review ? { reviewAction: { not: null } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { customerCode: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const [rows, counts] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        onboardingLinks: { select: linkFields },
        _count: { select: { accounts: true } },
        tickets: { select: { requests: { select: { numberOfVas: true } } } },
      },
    }),
    prisma.customer.groupBy({ by: ['status'], where: scoped, _count: { _all: true } }),
  ])
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<CustomerStatus, number>>
  return {
    rows: rows.map(({ onboardingLinks, _count, tickets, ...c }) => ({
      ...c,
      stage: onboardingStage(onboardingLinks),
      accountCount: _count.accounts,
      // VAs asked for across every ticket's requests.
      vasRequested: tickets.reduce((sum, t) => sum + t.requests.reduce((n, r) => n + r.numberOfVas, 0), 0),
    })),
    byStatus,
    total: counts.reduce((sum, c) => sum + c._count._all, 0),
  }
}

// Customer Management's overview: totals across every customer the person
// can see, and the latest status changes for the activity feed.
export async function customerPortfolio(now: Date, scope: Prisma.CustomerWhereInput | null = null) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  const customer = scope ?? {}
  const [accounts, vas, changesThisWeek, recent] = await Promise.all([
    prisma.account.count({ where: { customer } }),
    prisma.ticketRequest.aggregate({ where: { ticket: { customer } }, _sum: { numberOfVas: true } }),
    // Status changes only: a row with no fromStatus is a customer being created.
    prisma.customerStatusLog.count({ where: { changedAt: { gte: weekAgo }, fromStatus: { not: null }, customer } }),
    prisma.customerStatusLog.findMany({
      where: { customer },
      orderBy: { changedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        changedAt: true,
        changedByEmail: true,
        customer: { select: { id: true, name: true } },
      },
    }),
  ])
  return { accounts, vasRequested: vas._sum.numberOfVas ?? 0, changesThisWeek, recent }
}

// Lead Management's list: customers still in onboarding (status Pending).
export async function listLeads(q?: string) {
  const { rows } = await listCustomers({ q, status: 'PENDING' })
  return rows
}

export async function getCustomer(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      statusLogs: { orderBy: { changedAt: 'desc' }, include: { terminationReason: { select: { label: true } } } },
      onboardingLinks: { orderBy: { createdAt: 'desc' } },
      submissions: { orderBy: { submittedAt: 'desc' }, select: { id: true, submittedAt: true } },
      takeovers: { where: { cancelledAt: null }, orderBy: { startDate: 'desc' } },
      notesLog: { where: { accountId: null }, orderBy: { createdAt: 'desc' } },
      accounts: {
        orderBy: { createdAt: 'asc' },
        include: {
          category: { select: { label: true } },
          type: { select: { label: true } },
          countryRegion: { select: { label: true, timezone: true } },
          contract: { select: { id: true, contractCode: true, name: true } },
          managers: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          contacts: { orderBy: { kind: 'asc' } },
          submission: { select: { submittedAt: true, part3: true, part3SubmittedAt: true, link: { select: { token: true, revokedAt: true } } } },
          tickets: { orderBy: { ticketNumber: 'asc' }, include: { requests: { orderBy: { lineNo: 'asc' } } } },
        },
      },
    },
  })
  if (!customer) return null
  return { ...customer, stage: onboardingStage(customer.onboardingLinks) }
}

export async function countCustomers() {
  const [total, pending] = await Promise.all([prisma.customer.count(), prisma.customer.count({ where: { status: 'PENDING' } })])
  return { total, pending }
}

// Pending reviews waiting for a CS Manager: customers, plus accounts flagged
// on their own (accounts flagged by their customer follow its review).
export async function countPendingReviews() {
  const [customers, accounts] = await Promise.all([
    prisma.customer.count({ where: { reviewAction: { not: null } } }),
    prisma.account.count({ where: { reviewAction: { not: null }, reviewFromCustomer: false } }),
  ])
  return customers + accounts
}

// New IDs keep the legacy CMS format and never reuse one that exists either
// here or in the legacy CMS mirror va-management keeps in public.customers.
export async function generateCustomerCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `CUST_${randomBytes(6).toString('hex').toUpperCase()}`
    if (!(await customerCodeTaken(code))) return code
  }
  throw new Error('Could not generate a unique customer ID')
}

export async function customerCodeTaken(code: string): Promise<boolean> {
  const local = await prisma.customer.count({ where: { customerCode: code } })
  if (local > 0) return true
  const legacy = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM public.customers WHERE external_customer_id = ${code}`.catch(() => [{ n: BigInt(0) }])
  return Number(legacy[0]?.n ?? 0) > 0
}


// Customers whose name looks like the one being entered: both ones already
// in vaa-sys and the legacy Apps Script CMS, so the same customer isn't
// created twice.
export async function findCustomerMatches(name: string): Promise<CustomerMatch[]> {
  const q = name.trim()
  if (q.length < 2) return []
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

  const [local, legacy] = await Promise.all([
    prisma.customer.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      select: { id: true, customerCode: true, name: true, status: true },
      orderBy: { name: 'asc' },
      take: 5,
    }),
    prisma.$queryRaw<{ code: string; name: string; status: string | null }[]>`
      SELECT external_customer_id AS code, name, status
      FROM public.customers
      WHERE name ILIKE ${pattern}
      ORDER BY name
      LIMIT 5`.catch(() => []),
  ])

  return [
    ...local.map((c) => ({ id: c.id, code: c.customerCode, name: c.name, status: c.status, source: 'vaa_sys' as const })),
    ...legacy.map((c) => ({ id: null, code: c.code, name: c.name, status: c.status, source: 'legacy_cms' as const })),
  ]
}

// Account IDs keep the legacy CMS "Clients" format (CLT_ + 12 hex) and never
// reuse one that exists here or in the legacy mirror public.accounts.
export async function generateAccountCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `CLT_${randomBytes(6).toString('hex').toUpperCase()}`
    const local = await prisma.account.count({ where: { accountCode: code } })
    if (local > 0) continue
    const legacy = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM public.accounts WHERE external_account_id = ${code}`.catch(() => [{ n: BigInt(0) }])
    if (Number(legacy[0]?.n ?? 0) === 0) return code
  }
  throw new Error('Could not generate a unique account ID')
}
