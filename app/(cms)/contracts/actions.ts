'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getActorFor } from '@/lib/auth'
import { fieldChanges, logActivity } from '@/lib/activity'
import { contractSchema, sectionDefSchema, validSectionValue, FIELD_TYPE_LABELS, type ContractInput, type SectionDefInput } from '@/lib/contract-fields'
import type { ActionResult } from '@/lib/customer-fields'

const NO_ACCESS = "You don't have permission to manage contracts."

// Contract codes keep the legacy format, CON-001, CON-002…
async function nextContractCode(): Promise<string> {
  const codes = await prisma.contract.findMany({ select: { contractCode: true } })
  const max = codes.reduce((n, c) => Math.max(n, Number(c.contractCode.replace(/^CON-/, '')) || 0), 0)
  return `CON-${String(max + 1).padStart(3, '0')}`
}

// Creates (id null) or updates a contract and its section values.
export async function saveContract(id: string | null, input: ContractInput): Promise<ActionResult<{ id: string }>> {
  const actor = await getActorFor('contracts', id ? 'update' : 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = contractSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { sections, ...fields } = parsed.data

  const defs = await prisma.contractSectionDef.findMany({ where: { id: { in: Object.keys(sections) } } })
  for (const def of defs) {
    if (!validSectionValue(def.fieldType, sections[def.id] ?? '')) return { ok: false, error: `${def.name} needs a ${FIELD_TYPE_LABELS[def.fieldType].toLowerCase()} value.` }
  }
  const email = actor.email.toLowerCase()

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const before = id ? await tx.contract.findUnique({ where: { id }, select: { name: true, description: true, period: true, notes: true, sections: { select: { sectionDefId: true, value: true } } } }) : null
        if (id && !before) throw new Error('missing')
        const contract = id
          ? await tx.contract.update({ where: { id }, data: { ...fields, updatedByEmail: email } })
          : await tx.contract.create({ data: { ...fields, contractCode: await nextContractCode(), createdByEmail: email } })

        for (const def of defs) {
          const value = sections[def.id] ?? ''
          if (value === '') await tx.contractSection.deleteMany({ where: { contractId: contract.id, sectionDefId: def.id } })
          else
            await tx.contractSection.upsert({
              where: { contractId_sectionDefId: { contractId: contract.id, sectionDefId: def.id } },
              create: { contractId: contract.id, sectionDefId: def.id, value, updatedByEmail: email },
              update: { value, updatedByEmail: email },
            })
        }

        const base = { entityType: 'Contract', entityId: contract.id, entityLabel: `${contract.name} (${contract.contractCode})` }
        if (!before) {
          await logActivity(tx, actor, { ...base, action: 'CREATE', newValue: contract.name })
        } else {
          const oldSections = Object.fromEntries(defs.map((d) => [`section:${d.name}`, before.sections.find((s) => s.sectionDefId === d.id)?.value ?? null]))
          const newSections = Object.fromEntries(defs.map((d) => [`section:${d.name}`, sections[d.id] || null]))
          const { sections: _old, ...oldFields } = before
          void _old
          await logActivity(tx, actor, fieldChanges(base, { ...oldFields, ...oldSections }, { ...fields, ...newSections }))
        }
        return contract
      })
      revalidatePath('/contracts')
      return { ok: true, data: { id: saved.id } }
    } catch (err) {
      if (err instanceof Error && err.message === 'missing') return { ok: false, error: 'That contract no longer exists.' }
      // Two contracts created at once can pick the same code; try again.
      if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002' && !id) continue
      throw err
    }
  }
  return { ok: false, error: 'Could not number the new contract. Please try again.' }
}

export async function setContractActive(id: string, isActive: boolean): Promise<ActionResult> {
  const actor = await getActorFor('contracts', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const contract = await prisma.contract.findUnique({ where: { id }, select: { name: true, contractCode: true, isActive: true } })
  if (!contract) return { ok: false, error: 'That contract no longer exists.' }
  await prisma.$transaction(async (tx) => {
    await tx.contract.update({ where: { id }, data: { isActive, updatedByEmail: actor.email.toLowerCase() } })
    await logActivity(tx, actor, { entityType: 'Contract', entityId: id, entityLabel: `${contract.name} (${contract.contractCode})`, action: 'UPDATE', field: 'isActive', oldValue: contract.isActive, newValue: isActive })
  })
  revalidatePath('/contracts')
  return { ok: true, data: null }
}

export async function addSectionDef(input: SectionDefInput): Promise<ActionResult> {
  const actor = await getActorFor('contracts', 'create')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const parsed = sectionDefSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const count = await prisma.contractSectionDef.count()
  await prisma.$transaction(async (tx) => {
    const def = await tx.contractSectionDef.create({ data: { ...parsed.data, sortOrder: count + 1, createdByEmail: actor.email.toLowerCase() } })
    await logActivity(tx, actor, { entityType: 'ContractSection', entityId: def.id, entityLabel: def.name, action: 'CREATE', newValue: FIELD_TYPE_LABELS[def.fieldType] })
  })
  revalidatePath('/contracts')
  return { ok: true, data: null }
}

// Sections are switched off, never deleted, so old values stay readable.
export async function setSectionDefActive(id: string, isActive: boolean): Promise<ActionResult> {
  const actor = await getActorFor('contracts', 'update')
  if (!actor) return { ok: false, error: NO_ACCESS }
  const def = await prisma.contractSectionDef.findUnique({ where: { id } })
  if (!def) return { ok: false, error: 'That section no longer exists.' }
  await prisma.$transaction(async (tx) => {
    await tx.contractSectionDef.update({ where: { id }, data: { isActive } })
    await logActivity(tx, actor, { entityType: 'ContractSection', entityId: id, entityLabel: def.name, action: 'UPDATE', field: 'isActive', oldValue: def.isActive, newValue: isActive })
  })
  revalidatePath('/contracts')
  return { ok: true, data: null }
}
