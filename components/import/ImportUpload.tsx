'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FileCheck2, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SortableTable } from '@/components/ui/sortable-table'
import type { ActionResult } from '@/lib/customer-fields'
import type { ImportAction, ImportPreview } from '@/lib/lead-import-fields'
import { cn } from '@/lib/utils'

type Counts = { created: number; updated: number; skipped: number }

// Upload a filled-in template: check it (nothing saved), then import it.
// The file is sent again on import and checked from scratch on the server.
// Used by the Leads import (/leads/import) and the Customers import
// (/customers/import); each passes its own two Server Actions.
export function ImportUpload({
  check: checkFile,
  save: saveFile,
  record,
  detail,
  doneHref,
}: {
  check: (form: FormData) => Promise<ActionResult<ImportPreview>>
  save: (form: FormData) => Promise<ActionResult<Counts>>
  // What a row is ('lead', 'customer') and what its detail column shows.
  record: string
  detail: string
  doneHref: string
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const recordTitle = record.charAt(0).toUpperCase() + record.slice(1)
  const ACTION_META: Record<ImportAction, { label: string; soft: string }> = {
    create: { label: `New ${record}`, soft: 'bg-success/15 text-success' },
    update: { label: 'Update', soft: 'bg-info/15 text-info' },
    skip: { label: 'Skipped', soft: 'bg-muted text-muted-foreground' },
    error: { label: 'Problem', soft: 'bg-destructive/15 text-destructive' },
  }

  const form = () => {
    const data = new FormData()
    if (file) data.set('file', file)
    return data
  }

  const check = () =>
    start(async () => {
      const result = await checkFile(form())
      if (!result.ok) {
        setPreview(null)
        return setError(result.error)
      }
      setError(null)
      setPreview(result.data)
    })

  const save = () =>
    start(async () => {
      const result = await saveFile(form())
      if (!result.ok) return setError(result.error)
      const { created, updated, skipped } = result.data
      toast.success(`Imported: ${created} new, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}.`)
      setPreview(null)
      setFile(null)
      if (input.current) input.current.value = ''
      router.push(doneHref)
    })

  const canSave = !!preview && preview.counts.error === 0 && preview.counts.create + preview.counts.update > 0

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <h2 className="font-semibold">2. Upload it</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="import-file" className="sr-only">
          Filled-in template
        </label>
        <input
          ref={input}
          id="import-file"
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={pending}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setPreview(null)
            setError(null)
          }}
          className="text-sm file:mr-3 file:rounded-lg file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button onClick={check} disabled={!file || pending} variant="outline">
          {pending && !preview ? <Loader2 className="animate-spin" /> : <FileCheck2 />} Check file
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {preview && (
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-medium">{preview.fileName}</span>: {preview.counts.create} new, {preview.counts.update} to update, {preview.counts.skip} skipped
            {preview.counts.error > 0 && <span className="text-destructive">, {preview.counts.error} with problems</span>}.
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-xl border">
            <SortableTable
              className="w-full min-w-[640px] text-left text-[13px]"
              theadClassName="sticky top-0 bg-card text-[12px] text-muted-foreground"
              headRowClassName="border-b"
              columns={[
                { key: 'row', label: 'Row', className: 'px-3 py-2 font-medium' },
                { key: 'action', label: 'What happens', className: 'px-3 py-2 font-medium' },
                { key: 'name', label: recordTitle, className: 'px-3 py-2 font-medium' },
                { key: 'detail', label: detail, className: 'px-3 py-2 font-medium' },
                { key: 'notes', label: 'Notes', className: 'px-3 py-2 font-medium' },
              ]}
              rows={preview.rows.map((r) => ({
                id: String(r.row),
                // Problems first when sorting by what happens.
                values: { row: r.row, action: ['error', 'create', 'update', 'skip'].indexOf(r.action), name: r.name, detail: r.detail, notes: r.messages.join(' ') },
                node: (
                  <tr key={r.row} className="border-b align-top last:border-0">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-[12px] font-medium', ACTION_META[r.action].soft)}>{ACTION_META[r.action].label}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.name || <span className="text-muted-foreground">(no name)</span>}
                      {r.customerCode && <span className="block font-mono text-[11px] text-muted-foreground">{r.customerCode}</span>}
                    </td>
                    <td className="px-3 py-2">{r.detail ?? <span className="text-muted-foreground">unchanged</span>}</td>
                    <td className={cn('px-3 py-2', r.action === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                      {r.messages.length ? (
                        <ul className="space-y-0.5">
                          {r.messages.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ),
              }))}
            />
          </div>
          {preview.counts.error > 0 ? (
            <p className="text-sm text-muted-foreground">Fix the rows with problems in the file, then check it again. Nothing is saved until every row is fine.</p>
          ) : (
            <Button onClick={save} disabled={!canSave || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Upload />} Import {preview.counts.create + preview.counts.update}{' '}
              {preview.counts.create + preview.counts.update === 1 ? 'row' : 'rows'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
