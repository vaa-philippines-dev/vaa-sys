import Link from 'next/link'
import { ArrowLeft, Download } from 'lucide-react'
import { requireCan } from '@/lib/auth'
import { ImportUpload } from '@/components/import/ImportUpload'
import { CUSTOMER_IMPORT_COLUMNS, CUSTOMER_IMPORT_MAX_ROWS } from '@/lib/customer-import-fields'
import { applyCustomerImportAction, previewCustomerImport } from './actions'

// Admins: add or update customers in bulk from the Excel template.
export default async function CustomerImportPage() {
  await requireCan('customerImport', 'create', '/customers/import')

  return (
    <main className="w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Customers
      </Link>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Customer Management · Admins</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Import customers</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Download the template, fill in one row per customer, and upload it here. A row without a Customer ID adds a new customer; a row with one updates that customer.
          You see what will happen before anything is saved, and the whole file is saved together or not at all. Leads are imported in Lead Management.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">1. Download the template</h2>
        <p className="text-sm text-muted-foreground">
          An Excel file whose Status, Termination reason and CS Specialist columns are dropdowns of what is in the system today. Download a new copy after adding
          termination reasons or CS team members. Up to {CUSTOMER_IMPORT_MAX_ROWS} rows per file.
        </p>
        <a
          href="/customers/import/template"
          download
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Download className="h-4 w-4" /> Download template (.xlsx)
        </a>
        <details className="text-sm">
          <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">What each column means</summary>
          <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
            {CUSTOMER_IMPORT_COLUMNS.map((c) => (
              <div key={c.key} className="contents">
                <dt className="font-medium">{c.header}</dt>
                <dd className="text-muted-foreground">{c.note}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <ImportUpload check={previewCustomerImport} save={applyCustomerImportAction} record="customer" detail="Status" doneHref="/customers?status=all" />
    </main>
  )
}
