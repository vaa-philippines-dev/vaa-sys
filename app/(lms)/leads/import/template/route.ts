import { NextResponse } from 'next/server'
import { getActorFor } from '@/lib/auth'
import { buildImportTemplate } from '@/lib/lead-import'
import { manilaToday } from '@/lib/customer-fields'

// The Leads import template (lib/lead-import.ts), built fresh each time so
// its dropdowns list the phases, CS team and contracts in the system now.
export async function GET() {
  const actor = await getActorFor('leadImport', 'create')
  if (!actor) return new NextResponse('Only admins can download the Leads import template.', { status: 403 })

  const file = await buildImportTemplate()
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="vaa-leads-import-template-${manilaToday()}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
