import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'

// Server-only: the one contract database both areas show (Customer
// Management's /contracts and Lead Management's /leads/contracts).
// scope: the person's customer scope (lib/scope.ts), so the accounts listed
// under each contract are only theirs.
export async function contractLibrary(scope: Prisma.CustomerWhereInput | null) {
  const [defs, contracts] = await Promise.all([
    prisma.contractSectionDef.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.contract.findMany({
      orderBy: { contractCode: 'asc' },
      include: {
        sections: true,
        accounts: { where: { customer: scope ?? {} }, select: { id: true, name: true, accountCode: true, customerId: true }, orderBy: { name: 'asc' } },
      },
    }),
  ])
  return { defs, contracts }
}

export type ContractLibrary = Awaited<ReturnType<typeof contractLibrary>>

// Active contracts to pick from for a lead's account, with their terms.
export async function contractChoices() {
  const contracts = await prisma.contract.findMany({
    where: { isActive: true },
    orderBy: { contractCode: 'asc' },
    select: {
      id: true,
      contractCode: true,
      name: true,
      templateUrl: true,
      sections: { select: { value: true, sectionDef: { select: { name: true, fieldType: true, sortOrder: true } } } },
    },
  })
  return contracts.map(({ sections, ...c }) => ({
    ...c,
    terms: sections
      .sort((a, b) => a.sectionDef.sortOrder - b.sectionDef.sortOrder || a.sectionDef.name.localeCompare(b.sectionDef.name))
      .map((s) => ({ name: s.sectionDef.name, fieldType: s.sectionDef.fieldType, value: s.value })),
  }))
}

export type ContractChoice = Awaited<ReturnType<typeof contractChoices>>[number]
