import { requireCan } from '@/lib/auth'
import { ScheduleChangesPanel } from '@/components/requests/ScheduleChangesPanel'

// Lead Management: the schedule changes that affect billing, so the Lead
// Manager sees a request changed after the lead's onboarding (Nov 6, 2026).
export default async function LeadScheduleChangesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireCan('scheduleReviews', 'read', '/leads/schedule-changes')
  const { show } = await searchParams
  return <ScheduleChangesPanel user={user} area="lms" show={show === 'all' ? 'all' : 'waiting'} basePath="/leads/schedule-changes" />
}
