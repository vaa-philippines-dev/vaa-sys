import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireCan } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { customerScopeWhere } from '@/lib/scope'
import { FIELD_TYPE_LABELS, formatSectionValue } from '@/lib/contract-fields'
import { ContractEditor, SectionDefControls } from '@/components/cms/ContractEditor'

// Contract templates (legacy Contracts page): typed sections every contract
// can fill in, the contracts themselves, and which accounts use each one.
// An account's contract is picked on the account's page.
export default async function ContractsPage() {
  const user = await requireCan('contracts', 'read', '/contracts')
  const manage = can(user.role, 'contracts', 'update')
  const scope = await customerScopeWhere(user)

  const [defs, contracts] = await Promise.all([
    prisma.contractSectionDef.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.contract.findMany({
      orderBy: { contractCode: 'asc' },
      include: {
        sections: true,
        accounts: { where: { customer: scope ?? {} }, select: { id: true, name: true, accountCode: true }, orderBy: { name: 'asc' } },
      },
    }),
  ])
  const activeDefs = defs.filter((d) => d.isActive)

  return (
    <main className="w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Contracts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each account points at the contract that applies to it, set on the account’s page.</p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Contracts</h2>
          {manage && <ContractEditor defs={activeDefs} />}
        </div>
        {contracts.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">No contracts yet.</p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {contracts.map((c) => (
              <li key={c.id} className={`space-y-3 rounded-2xl border bg-card p-5 ${c.isActive ? '' : 'opacity-60'}`}>
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">{c.contractCode}</p>
                    <h3 className="font-display font-semibold">
                      {c.name}
                      {!c.isActive && <span className="ml-2 text-xs font-normal text-muted-foreground">(switched off)</span>}
                    </h3>
                    <p className="text-xs text-muted-foreground">Reviewed: {c.period}</p>
                  </div>
                  {manage && (
                    <ContractEditor
                      defs={defs.filter((d) => d.isActive || c.sections.some((s) => s.sectionDefId === d.id))}
                      contract={{
                        id: c.id,
                        name: c.name,
                        description: c.description,
                        period: c.period,
                        notes: c.notes,
                        isActive: c.isActive,
                        sections: Object.fromEntries(c.sections.map((s) => [s.sectionDefId, s.value])),
                      }}
                    />
                  )}
                </header>
                {c.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{c.description}</p>}
                {c.sections.length > 0 && (
                  <dl className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                    {defs
                      .filter((d) => c.sections.some((s) => s.sectionDefId === d.id))
                      .map((d) => (
                        <div key={d.id} className="contents">
                          <dt className="text-muted-foreground">{d.name}</dt>
                          <dd>{formatSectionValue(d.fieldType, c.sections.find((s) => s.sectionDefId === d.id)!.value)}</dd>
                        </div>
                      ))}
                  </dl>
                )}
                {c.notes && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{c.notes}</p>}
                <div className="border-t pt-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {c.accounts.length} {c.accounts.length === 1 ? 'account' : 'accounts'}
                    {scope ? ' of yours' : ''}
                  </p>
                  {c.accounts.length > 0 && (
                    <p className="mt-1">
                      {c.accounts.map((a, i) => (
                        <span key={a.id}>
                          {i > 0 && ', '}
                          <Link href={`/accounts/${a.id}`} className="hover:underline">
                            {a.name}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Sections</h2>
        <p className="text-sm text-muted-foreground">The terms every contract can fill in. Switched-off sections stay on contracts that already have a value.</p>
        {defs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sections yet.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {defs.map((d) => (
              <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm ${d.isActive ? '' : 'opacity-60'}`}>
                <span>
                  <span className="font-medium">{d.name}</span> <span className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[d.fieldType]}</span>
                  {d.description && <span className="block text-xs text-muted-foreground">{d.description}</span>}
                </span>
                {manage && <SectionDefControls id={d.id} isActive={d.isActive} />}
              </li>
            ))}
          </ul>
        )}
        {manage && <SectionDefControls />}
      </section>
    </main>
  )
}
