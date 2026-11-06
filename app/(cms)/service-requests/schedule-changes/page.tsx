import { requireCan } from '@/lib/auth'
import { ScheduleChangesPanel } from '@/components/requests/ScheduleChangesPanel'

// Customer Management: schedule changes waiting for Executive Support's
// check, and the history of every change.
export default async function ScheduleChangesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireCan('scheduleReviews', 'read', '/service-requests/schedule-changes')
  const { show } = await searchParams
  return <ScheduleChangesPanel user={user} area="cms" show={show === 'all' ? 'all' : 'waiting'} basePath="/service-requests/schedule-changes" />
}
