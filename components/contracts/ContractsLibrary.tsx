import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { FIELD_TYPE_LABELS, formatSectionValue } from '@/lib/contract-fields'
import { ContractEditor, SectionDefControls } from '@/components/cms/ContractEditor'
import type { ContractLibrary } from '@/lib/contracts'

// The contract database, as both areas show it: each contract with its ID,
// terms, template link and the accounts using it, then the terms (sections)
// every contract can fill in. Customer Management links each account to its
// page; Lead Management names them only.
export function ContractsLibrary({ library, manage, scoped, area }: { library: ContractLibrary; manage: boolean; scoped: boolean; area: 'cms' | 'lms' }) {
  const { defs, contracts } = library
  const activeDefs = defs.filter((d) => d.isActive)
  const heading = area === 'cms' ? 'font-display font-semibold' : 'font-semibold'

  return (
    <>
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
                    <h3 className={heading}>
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
                        templateUrl: c.templateUrl,
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
                <p className="text-sm">
                  {c.templateUrl ? (
                    <a href={c.templateUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> Template
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">No template link yet.</span>
                  )}
                </p>
                {c.notes && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{c.notes}</p>}
                <div className="border-t pt-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {c.accounts.length} {c.accounts.length === 1 ? 'account' : 'accounts'}
                    {scoped ? ' of yours' : ''}
                  </p>
                  {c.accounts.length > 0 && (
                    <p className="mt-1">
                      {c.accounts.map((a, i) => (
                        <span key={a.id}>
                          {i > 0 && ', '}
                          {area === 'cms' ? (
                            <Link href={`/accounts/${a.id}`} className="hover:underline">
                              {a.name}
                            </Link>
                          ) : (
                            a.name
                          )}
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
        <h2 className="font-semibold">Terms</h2>
        <p className="text-sm text-muted-foreground">
          The terms a contract can have: Yes/No, an amount, a percentage or text, e.g. “Night differential” (Yes/No) and “Night differential amount” (Amount). Each contract
          fills in only the terms it has. Switched-off terms stay on contracts that already have a value.
        </p>
        {defs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No terms yet.</p>
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
    </>
  )
}
