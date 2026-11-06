'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getActorFor } from '@/lib/auth'
import {
  applyServiceRequestImport,
  planServiceRequestImport,
  problemRowsWorkbook,
  readServiceRequestFile,
  removeServiceMapping,
  saveServiceMappings,
  serviceRequestCheckOf,
} from '@/lib/service-request-import'
import type { ActionResult } from '@/lib/customer-fields'
import type { ServiceMapping, SrImportCheck } from '@/lib/service-request-import-fields'

const NO_ACCESS = 'Only admins can import service requests.'

function fileFrom(form: FormData): File | null {
  const file = form.get('file')
  return file instanceof File && file.size > 0 ? file : null
}

type Planned = { file: File } & Awaited<ReturnType<typeof planServiceRequestImport>>

async function planFile(form: FormData): Promise<Planned | { error: string }> {
  const file = fileFrom(form)
  if (!file) return { error: 'Choose the filled-in template first.' }
  const read = await readServiceRequestFile(file)
  if ('error' in read) return { error: read.error }
  return { file, ...(await planServiceRequestImport(read.rows)) }
}

// Step 1: check the file and show what would happen, saving nothing.
export async function checkServiceRequestImport(form: FormData): Promise<ActionResult<SrImportCheck>> {
  if (!(await getActorFor('serviceRequestImport', 'create'))) return { ok: false, error: NO_ACCESS }
  const r = await planFile(form)
  if ('error' in r) return { ok: false, error: r.error }
  return { ok: true, data: serviceRequestCheckOf(r.file.name, r.plans, r.unmapped) }
}

// Step 2: the same file again, checked from scratch. The rows ready to
// import are saved together; the ones with problems are left for the
// problems file.
export async function importServiceRequests(form: FormData): Promise<ActionResult<{ tickets: number; requests: number; skipped: number; problems: number }>> {
  const actor = await getActorFor('serviceRequestImport', 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const r = await planFile(form)
  if ('error' in r) return { ok: false, error: r.error }
  if (!r.plans.some((p) => p.kind === 'create')) return { ok: false, error: 'No rows are ready to import.' }
  try {
    const result = await applyServiceRequestImport(r.plans, actor, r.file.name)
    revalidatePath('/service-requests', 'layout')
    revalidatePath('/accounts', 'layout')
    revalidatePath('/customers', 'layout')
    return { ok: true, data: result }
  } catch (err) {
    console.error('[importServiceRequests]', err)
    return { ok: false, error: 'The import couldn’t be saved, so nothing was changed. Please try again.' }
  }
}

// The rows with problems, as a template with a Problem column (base64).
export async function downloadProblemRows(form: FormData): Promise<ActionResult<{ name: string; base64: string; rows: number }>> {
  if (!(await getActorFor('serviceRequestImport', 'create'))) return { ok: false, error: NO_ACCESS }
  const r = await planFile(form)
  if ('error' in r) return { ok: false, error: r.error }
  const rows = r.plans.filter((p) => p.kind === 'problem').length
  if (!rows) return { ok: false, error: 'No rows have problems.' }
  const buf = await problemRowsWorkbook(r.plans)
  const name = `${r.file.name.replace(/\.(xlsx|csv)$/i, '')} - problems.xlsx`
  return { ok: true, data: { name, base64: buf.toString('base64'), rows } }
}

const mappingSchema = z.object({ from: z.string().trim().min(1).max(120), service: z.string().trim().min(1).max(120), departmentId: z.string().trim().max(60).nullable() })

export async function saveServiceMappingsAction(input: ServiceMapping[]): Promise<ActionResult> {
  const actor = await getActorFor('serviceRequestImport', 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = z.array(mappingSchema).max(200).safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Pick a service for each name.' }
  const r = await saveServiceMappings(actor, parsed.data)
  if (r.ok) revalidatePath('/service-requests/import')
  return r
}

export async function removeServiceMappingAction(from: string): Promise<ActionResult> {
  const actor = await getActorFor('serviceRequestImport', 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const r = await removeServiceMapping(actor, from.slice(0, 120))
  if (r.ok) revalidatePath('/service-requests/import')
  return r
}
