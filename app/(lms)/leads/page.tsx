import { LeadsBoard, type BoardLead } from '@/components/lms/LeadsBoard'
import { StatsRow } from '@/components/lms/StatsRow'
import { BOARD_COLUMNS, boardColumnOf, dayOf, type BoardColumn } from '@/components/lms/stage-meta'
import { requireArea } from '@/lib/auth'
import { listLeads } from '@/lib/customers'

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ stage?: string; new?: string }> }) {
  await requireArea('leads', '/leads')
  const { stage: rawStage, new: openNew } = await searchParams
  const column = BOARD_COLUMNS.includes(rawStage as BoardColumn) ? (rawStage as BoardColumn) : null

  const leads = await listLeads()
  const now = new Date()
  const board: BoardLead[] = leads
    .map((l) => ({ id: l.id, name: l.name, code: l.customerCode, email: l.email, column: boardColumnOf(l.stage, l.leadPhase), special: l.requestType === 'SPECIAL', day: dayOf(l.createdAt, now) }))
    .filter((l) => !column || l.column === column)

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      <StatsRow leads={leads} now={now} />
      <LeadsBoard leads={board} column={column} openNew={openNew === '1'} />
    </main>
  )
}
