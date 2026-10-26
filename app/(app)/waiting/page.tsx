import { redirect } from 'next/navigation'
import { requireSignedIn } from '@/lib/auth'
import { homeFor, ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/lib/access-fields'

// Where roles land whose own pages arrive with later modules (HR,
// Recruitment, Training). They have access, just nothing to open yet.
export default async function WaitingPage() {
  const user = await requireSignedIn()
  if (homeFor(user.role) !== '/waiting') redirect(homeFor(user.role))
  return (
    <div className="mx-auto max-w-xl space-y-2 rounded-xl border bg-card p-6">
      <h1 className="text-lg font-semibold">You’re set up as {ROLE_LABELS[user.role]}</h1>
      <p className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[user.role]}</p>
      <p className="text-sm text-muted-foreground">Your pages are being moved over from the old Customer Management System and will appear here as they’re ready.</p>
    </div>
  )
}
