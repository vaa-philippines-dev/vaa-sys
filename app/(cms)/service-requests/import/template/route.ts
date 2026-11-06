import { NextResponse } from 'next/server'
import { getActorFor } from '@/lib/auth'
import { buildServiceRequestTemplate } from '@/lib/service-request-import'
import { manilaToday } from '@/lib/customer-fields'

// The Service Requests import template (lib/service-request-import.ts),
// built fresh each time so its dropdowns list the departments, services and
// Service Managers in the system now.
export async function GET() {
  const actor = await getActorFor('serviceRequestImport', 'create')
  if (!actor) return new NextResponse('Only admins can download the Service Requests import template.', { status: 403 })

  const file = await buildServiceRequestTemplate()
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="vaa-service-requests-import-template-${manilaToday()}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
