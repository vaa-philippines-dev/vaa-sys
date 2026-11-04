import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'

// Marks a test lead (lib/test-leads.ts) in both areas. Outlined and neutral,
// so it reads the same in the LMS and CMS palettes.
export function TestBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 align-middle text-[11px] font-medium text-muted-foreground', className)}
      title="Test lead: not counted in reports"
    >
      <FlaskConical className="h-3 w-3" aria-hidden /> Test
    </span>
  )
}
