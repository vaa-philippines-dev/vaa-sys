import { requireCan } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { customerScopeWhere } from '@/lib/scope'
import { contractLibrary } from '@/lib/contracts'
import { ContractsLibrary } from '@/components/contracts/ContractsLibrary'

// Contract & Billing Initiation's contract database: the same contracts as
// Customer Management's /contracts. The one picked for a lead's account, and
// its template link, is what the lead is sent.
export default async function LeadContractsPage() {
  const user = await requireCan('contracts', 'read', '/leads/contracts')
  const scope = await customerScopeWhere(user)
  const library = await contractLibrary(scope)

  return (
    <main className="w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Lead Management · Contract &amp; Billing</p>
        <h1 className="mt-1 text-2xl font-semibold">Contracts</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every contract has its own ID and its own terms. Pick one for a lead on the lead’s page during Contract &amp; Billing Initiation, then send it with its template
          link. Customer Management uses the same contracts.
        </p>
      </div>
      <ContractsLibrary library={library} manage={can(user.role, 'contracts', 'update')} scoped={!!scope} area="lms" />
    </main>
  )
}
