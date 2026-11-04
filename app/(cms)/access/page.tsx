import { requireArea } from '@/lib/auth'
import { AccessPanel } from '@/components/access/AccessPanel'

// Customer Management's Access page. CS Managers manage their own team here
// (grantableRoles); admins also have it in Lead Management (/leads/access).
export default async function AccessPage() {
  const user = await requireArea('access', '/access')
  return <AccessPanel user={user} area="Customer Management" title="Access" titleClass="font-display" />
}
