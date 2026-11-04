import { LeadsTable, type TableLead } from '@/components/lms/LeadsTable'
import { StatsRow } from '@/components/lms/StatsRow'
import { BOARD_COLUMNS, boardColumnOf, dayOf, type BoardColumn } from '@/components/lms/stage-meta'
import { requireArea } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { listLeads } from '@/lib/customers'
import { manilaDate } from '@/lib/customer-fields'
import { staffNames } from '@/lib/workforce'

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ stage?: string; new?: string }> }) {
  const user = await requireArea('leads', '/leads')
  const { stage: rawStage, new: openNew } = await searchParams
  const column = BOARD_COLUMNS.includes(rawStage as BoardColumn) ? (rawStage as BoardColumn) : null

  const leads = await listLeads()
  const names = await staffNames(leads.map((l) => l.createdByEmail))
  const now = new Date()
  const rows: TableLead[] = leads
    .map((l) => ({
      id: l.id,
      name: l.name,
      code: l.customerCode,
      email: l.email,
      column: boardColumnOf(l.stage, l.leadPhase),
      special: l.requestType === 'SPECIAL',
      day: dayOf(l.createdAt, now),
      addedOn: l.createdAt.toLocaleDateString('en-PH', manilaDate),
      addedBy: names.get(l.createdByEmail.toLowerCase()) ?? l.createdByEmail,
      test: l.isTest,
    }))
    .filter((l) => !column || l.column === column)

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
      {/* Test leads are listed but never counted. */}
      <StatsRow leads={leads.filter((l) => !l.isTest)} now={now} />
      <LeadsTable
        leads={rows}
        column={column}
        openNew={openNew === '1'}
        canImport={can(user.role, 'leadImport', 'create')}
        canTest={can(user.role, 'testLeads', 'create')}
      />
    </main>
  )
}
