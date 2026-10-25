import { LeadsBoard, type BoardLead } from '@/components/lms/LeadsBoard'
import { StatsRow } from '@/components/lms/StatsRow'
import { STAGE_COLUMNS, dayOf } from '@/components/lms/stage-meta'
import { requireArea } from '@/lib/auth'
import { listLeads } from '@/lib/customers'
import type { OnboardingStage } from '@/lib/customer-fields'

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ stage?: string; new?: string }> }) {
  await requireArea('leads', '/leads')
  const { stage: rawStage, new: openNew } = await searchParams
  const stage = STAGE_COLUMNS.includes(rawStage as OnboardingStage) ? (rawStage as OnboardingStage) : null

  const leads = await listLeads()
  const now = new Date()
  const board: BoardLead[] = leads
    .filter((l) => !stage || l.stage === stage)
    .map((l) => ({ id: l.id, name: l.name, code: l.customerCode, email: l.email, stage: l.stage, day: dayOf(l.createdAt, now) }))

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <StatsRow leads={leads} now={now} />
      <LeadsBoard leads={board} stage={stage} openNew={openNew === '1'} />
    </main>
  )
}
