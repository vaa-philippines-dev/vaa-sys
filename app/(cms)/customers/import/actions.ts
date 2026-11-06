'use server'

import { revalidatePath } from 'next/cache'
import { getActorFor } from '@/lib/auth'
import { applyCustomerImport, customerPreviewOf, planCustomerImport, readCustomerFile } from '@/lib/customer-import'
import type { ActionResult } from '@/lib/customer-fields'
import type { ImportPreview } from '@/lib/lead-import-fields'

const NO_ACCESS = 'Only admins can import customers.'

function fileFrom(form: FormData): File | null {
  const file = form.get('file')
  return file instanceof File && file.size > 0 ? file : null
}

// Step 1: check the file and show what would happen, saving nothing.
export async function previewCustomerImport(form: FormData): Promise<ActionResult<ImportPreview>> {
  const actor = await getActorFor('customerImport', 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const file = fileFrom(form)
  if (!file) return { ok: false, error: 'Choose the filled-in template first.' }

  const read = await readCustomerFile(file)
  if ('error' in read) return { ok: false, error: read.error }
  const plans = await planCustomerImport(read.rows)
  return { ok: true, data: customerPreviewOf(file.name, plans) }
}

// Step 2: the same file again, checked from scratch (the database may have
// changed since the preview) and saved in one transaction.
export async function applyCustomerImportAction(form: FormData): Promise<ActionResult<{ created: number; updated: number; skipped: number }>> {
  const actor = await getActorFor('customerImport', 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const file = fileFrom(form)
  if (!file) return { ok: false, error: 'Choose the filled-in template first.' }

  const read = await readCustomerFile(file)
  if ('error' in read) return { ok: false, error: read.error }
  const plans = await planCustomerImport(read.rows)
  if (plans.some((p) => p.kind === 'error')) return { ok: false, error: 'Some rows have problems now. Check the file again and fix them first.' }

  try {
    const result = await applyCustomerImport(plans, actor, file.name)
    if ('error' in result) return { ok: false, error: result.error }
    revalidatePath('/customers', 'layout')
    revalidatePath('/accounts', 'layout')
    revalidatePath('/leads', 'layout')
    return { ok: true, data: result }
  } catch (err) {
    console.error('[applyCustomerImport]', err)
    return { ok: false, error: 'The import couldn’t be saved, so nothing was changed. Please try again.' }
  }
}
