import { requireCan } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { customerScopeWhere } from '@/lib/scope'
import { contractLibrary } from '@/lib/contracts'
import { ContractsLibrary } from '@/components/contracts/ContractsLibrary'

// Contract templates (legacy Contracts page): typed terms every contract
// can fill in, the contracts themselves, and which accounts use each one.
// An account's contract is picked on the account's page. Lead Management
// shows the same database at /leads/contracts.
export default async function ContractsPage() {
  const user = await requireCan('contracts', 'read', '/contracts')
  const scope = await customerScopeWhere(user)
  const library = await contractLibrary(scope)

  return (
    <main className="w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Contracts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each account points at the contract that applies to it, set on the account’s page.</p>
      </div>
      <ContractsLibrary library={library} manage={can(user.role, 'contracts', 'update')} scoped={!!scope} area="cms" />
    </main>
  )
}
