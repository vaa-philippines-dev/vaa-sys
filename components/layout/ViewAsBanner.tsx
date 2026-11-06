import { Eye } from 'lucide-react'
import { displayName, type SessionUser } from '@/lib/auth'
import { ROLE_LABELS } from '@/lib/access-fields'
import { StopViewAsButton } from '@/components/layout/ViewAsControls'

// Shown at the top of every area while an admin views the app as someone
// else (lib/auth.ts): who, and that nothing can be changed meanwhile.
export function ViewAsBanner({ user }: { user: SessionUser }) {
  if (!user.viewingAs) return null
  return (
    <div role="status" className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-[13px] sm:px-6">
      <p className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0 text-warning" />
        <span>
          Viewing as <span className="font-semibold">{displayName(user)}</span> ({user.role ? ROLE_LABELS[user.role] : 'no role'}). Read-only: nothing can be changed, and the confidential rates are hidden.
        </span>
      </p>
      <StopViewAsButton />
    </div>
  )
}
