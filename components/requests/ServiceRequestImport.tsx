'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, FileCheck2, Loader2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { SortableTable } from '@/components/ui/sortable-table'
import { checkServiceRequestImport, downloadProblemRows, importServiceRequests, removeServiceMappingAction, saveServiceMappingsAction } from '@/app/(cms)/service-requests/import/actions'
import type { ServiceMapping, SrImportCheck } from '@/lib/service-request-import-fields'
import { cn } from '@/lib/utils'

type Choices = { services: string[]; departments: { id: string; name: string }[] }

const ACTIONS: Record<SrImportCheck['rows'][number]['action'], { label: string; soft: string }> = {
  problem: { label: 'Held back', soft: 'bg-destructive/15 text-destructive' },
  create: { label: 'Import', soft: 'bg-success/15 text-success' },
  skip: { label: 'Skipped', soft: 'bg-muted text-muted-foreground' },
}

function saveFile(name: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// The Service Requests import (Nov 6, 2026): check a file, map its new
// service names, import the rows that are ready, and download the rows held
// back with their problems, to fix and import again.
export function ServiceRequestImport({ choices }: { choices: Choices }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [check, setCheck] = useState<SrImportCheck | null>(null)
  const [maps, setMaps] = useState<Record<string, { service: string; departmentId: string }>>({})
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const form = () => {
    const data = new FormData()
    if (file) data.set('file', file)
    return data
  }
  const runCheck = async () => {
    const r = await checkServiceRequestImport(form())
    if (!r.ok) {
      setCheck(null)
      return setError(r.error)
    }
    setError(null)
    setCheck(r.data)
  }

  const saveMappings = () =>
    start(async () => {
      const list: ServiceMapping[] = (check?.unmapped ?? []).filter((u) => maps[u.value]?.service).map((u) => ({ from: u.value, service: maps[u.value].service, departmentId: maps[u.value].departmentId || null }))
      if (!list.length) return void toast.error('Pick a service for at least one name.')
      const r = await saveServiceMappingsAction(list)
      if (!r.ok) return void toast.error(r.error)
      toast.success(`${list.length} mapping${list.length === 1 ? '' : 's'} saved.`)
      setMaps({})
      await runCheck()
      router.refresh()
    })

  const importReady = () =>
    start(async () => {
      const r = await importServiceRequests(form())
      if (!r.ok) return setError(r.error)
      const { tickets, requests, problems } = r.data
      const text = `Imported ${tickets} ticket${tickets === 1 ? '' : 's'} (${requests} VA request${requests === 1 ? '' : 's'}).${problems ? ` ${problems} row${problems === 1 ? ' was' : 's were'} held back: download them, fix them and import that file.` : ''}`
      toast.success(text)
      setDone(text)
      await runCheck()
      router.refresh()
    })

  const downloadProblems = () =>
    start(async () => {
      const r = await downloadProblemRows(form())
      if (!r.ok) return void toast.error(r.error)
      saveFile(r.data.name, r.data.base64)
    })

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
            setCheck(null)
            setDone(null)
            setError(null)
          }}
          className="text-sm file:mr-3 file:rounded-lg file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button onClick={() => start(runCheck)} disabled={!file || pending} variant="outline">
          {pending && !check ? <Loader2 className="animate-spin" /> : <FileCheck2 />} Check file
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {done && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{done}</p>}

      {check && check.unmapped.length > 0 && (
        <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <div>
            <h3 className="text-sm font-semibold">Map {check.unmapped.length === 1 ? 'this service name' : `these ${check.unmapped.length} service names`}</h3>
            <p className="text-xs text-muted-foreground">
              Each is mapped once and kept for every later import. A department left as the service’s comes from the service; pick one when the name means a particular
              department (e.g. Walmart PPC VA → PPC, Walmart).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">In the file</th>
                  <th className="px-3 py-2 font-medium">Service</th>
                  <th className="py-2 pl-3 font-medium">Department</th>
                </tr>
              </thead>
              <tbody>
                {check.unmapped.map((u) => {
                  const m = maps[u.value] ?? { service: '', departmentId: '' }
                  const set = (next: Partial<typeof m>) => setMaps({ ...maps, [u.value]: { ...m, ...next } })
                  return (
                    <tr key={u.value} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{u.value}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {u.rows.length} row{u.rows.length === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <NativeSelect aria-label={`Service for ${u.value}`} value={m.service} onChange={(e) => set({ service: e.target.value })} className="h-8 text-xs">
                          <option value="">Pick a service…</option>
                          {choices.services.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                      <td className="py-2 pl-3">
                        <NativeSelect aria-label={`Department for ${u.value}`} value={m.departmentId} onChange={(e) => set({ departmentId: e.target.value })} className="h-8 text-xs">
                          <option value="">The service’s</option>
                          {choices.departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Button size="sm" onClick={saveMappings} disabled={pending || !Object.values(maps).some((m) => m.service)}>
            {pending ? <Loader2 className="animate-spin" /> : null} Save mappings and check again
          </Button>
        </div>
      )}

      {check && (
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-medium">{check.fileName}</span>: {check.counts.create} VA request{check.counts.create === 1 ? '' : 's'} ready ({check.counts.tickets} ticket
            {check.counts.tickets === 1 ? '' : 's'}), {check.counts.skip} skipped
            {check.counts.problem > 0 && <span className="text-destructive">, {check.counts.problem} held back with problems</span>}.
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-xl border">
            <SortableTable
              className="w-full min-w-[720px] text-left text-[13px]"
              theadClassName="sticky top-0 bg-card text-[12px] text-muted-foreground"
              headRowClassName="border-b"
              columns={[
                { key: 'row', label: 'Row', className: 'px-3 py-2 font-medium' },
                { key: 'action', label: 'What happens', className: 'px-3 py-2 font-medium' },
                { key: 'account', label: 'Account', className: 'px-3 py-2 font-medium' },
                { key: 'detail', label: 'Sub-ticket · type · service · phase', className: 'px-3 py-2 font-medium' },
                { key: 'notes', label: 'Notes', className: 'px-3 py-2 font-medium' },
              ]}
              rows={check.rows.map((r) => ({
                id: String(r.row),
                values: { row: r.row, action: ['problem', 'create', 'skip'].indexOf(r.action), account: r.account, detail: r.detail, notes: r.messages.join(' ') },
                node: (
                  <tr key={r.row} className="border-b align-top last:border-0">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                    <td className="px-3 py-2">
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium', ACTIONS[r.action].soft)}>{ACTIONS[r.action].label}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.account}
                      {r.customer && <span className="block text-[11px] text-muted-foreground">{r.customer}</span>}
                    </td>
                    <td className="px-3 py-2">{r.detail ?? '—'}</td>
                    <td className={cn('px-3 py-2', r.action === 'problem' ? 'text-destructive' : 'text-muted-foreground')}>
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
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={importReady} disabled={pending || check.counts.create === 0}>
              {pending ? <Loader2 className="animate-spin" /> : <Upload />} Import {check.counts.create} ready VA request{check.counts.create === 1 ? '' : 's'}
            </Button>
            {check.counts.problem > 0 && (
              <Button variant="outline" onClick={downloadProblems} disabled={pending}>
                <Download /> Download the {check.counts.problem} held back (.xlsx)
              </Button>
            )}
          </div>
          {check.counts.problem > 0 && (
            <p className="text-xs text-muted-foreground">
              The held-back rows come in the template with a Problem column. Fix them and import that file; tickets already imported are skipped.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

// The saved service mappings, each removable.
export function ServiceMappingsList({ mappings, departments }: { mappings: ServiceMapping[]; departments: { id: string; name: string }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (mappings.length === 0) return <p className="text-sm text-muted-foreground">None yet. New service names are mapped when you check a file.</p>
  return (
    <ul className="divide-y rounded-xl border text-[13px]">
      {mappings.map((m) => (
        <li key={m.from} className="flex items-center justify-between gap-3 px-3 py-2">
          <span>
            <span className="font-medium">{m.from}</span>
            <span className="text-muted-foreground"> → </span>
            {m.service}
            {m.departmentId && <span className="text-muted-foreground"> · {departments.find((d) => d.id === m.departmentId)?.name ?? 'unknown department'}</span>}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove the mapping for ${m.from}`}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeServiceMappingAction(m.from)
                if (!r.ok) return void toast.error(r.error)
                toast.success(`Mapping for “${m.from}” removed.`)
                router.refresh()
              })
            }
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  )
}
