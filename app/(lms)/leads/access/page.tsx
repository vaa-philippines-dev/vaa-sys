import { requireCan } from '@/lib/auth'
import { AccessPanel } from '@/components/access/AccessPanel'

// Lead Management's User access page: the same list as Customer
// Management's /access, for admins only (userAccess in lib/permissions.ts).
export default async function LeadsAccessPage() {
  const user = await requireCan('userAccess', 'read', '/leads/access')
  return <AccessPanel user={user} area="Lead Management · Admins" title="User access" />
}
