import { NextResponse } from 'next/server'
import { getActorFor } from '@/lib/auth'
import { buildCustomerTemplate } from '@/lib/customer-import'
import { manilaToday } from '@/lib/customer-fields'

// The Customers import template (lib/customer-import.ts), built fresh each
// time so its dropdowns list the CS team and termination reasons in the
// system now.
export async function GET() {
  const actor = await getActorFor('customerImport', 'create')
  if (!actor) return new NextResponse('Only admins can download the Customers import template.', { status: 403 })

  const file = await buildCustomerTemplate()
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="vaa-customers-import-template-${manilaToday()}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
