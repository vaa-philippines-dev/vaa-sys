import Link from 'next/link'
import { ArrowLeft, Download } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { getServiceMappings, mappingChoices } from '@/lib/service-request-import'
import { SR_IMPORT_COLUMNS, SR_IMPORT_MAX_ROWS } from '@/lib/service-request-import-fields'
import { ServiceMappingsList, ServiceRequestImport } from '@/components/requests/ServiceRequestImport'

// Admins: add tickets in bulk from the Excel template (Nov 6, 2026), e.g.
// the tickets of accounts from the old system.
export default async function ServiceRequestImportPage() {
  await requireCan('serviceRequestImport', 'create', '/service-requests/import')
  const [choices, mappings] = await Promise.all([mappingChoices(), getServiceMappings()])

  return (
    <main className="w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <Link href="/service-requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Service Requests
      </Link>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management · Admins</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Import service requests</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          One row per VA request, on an existing account found by its Account ID; rows with the same Ticket ID make one ticket. Service names from another system are
          mapped once. Rows with a problem are held back with the rest of their ticket while the others import, and you can download them to fix and import again.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">1. Download the template</h2>
        <p className="text-sm text-muted-foreground">
          An Excel file with a sample row to write over. The request type, group, department, service, phase, schedule and time zone columns have dropdowns of what is in
          the system today; service and department also take other names. Up to {SR_IMPORT_MAX_ROWS} rows per file.
        </p>
        <a
          href="/service-requests/import/template"
          download
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Download className="h-4 w-4" /> Download template (.xlsx)
        </a>
        <details className="text-sm">
          <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">What each column means</summary>
          <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-[14rem_minmax(0,1fr)]">
            {SR_IMPORT_COLUMNS.map((c) => (
              <div key={c.key} className="contents">
                <dt className="font-medium">{c.header}</dt>
                <dd className="text-muted-foreground">{c.note}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <ServiceRequestImport choices={choices} />

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <div>
          <h2 className="font-semibold">Service mappings</h2>
          <p className="text-sm text-muted-foreground">Names from other systems and the service (and department) they import as.</p>
        </div>
        <ServiceMappingsList mappings={mappings} departments={choices.departments} />
      </section>
    </main>
  )
}
