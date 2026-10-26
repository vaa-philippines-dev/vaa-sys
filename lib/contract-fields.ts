import { z } from 'zod'

// Client-safe: contract templates and their typed sections (legacy
// ContractService.js and the Contracts page in scripts-va-ops.html).

export const CONTRACT_PERIODS = ['Annual', 'Semi-Annual', 'Quarterly', 'Monthly', 'Not Updated'] as const

export const FIELD_TYPES = ['PERCENTAGE', 'AMOUNT', 'TEXT', 'YES_NO'] as const
export type ContractFieldType = (typeof FIELD_TYPES)[number]

export const FIELD_TYPE_LABELS: Record<ContractFieldType, string> = {
  PERCENTAGE: 'Percentage',
  AMOUNT: 'Amount',
  TEXT: 'Text',
  YES_NO: 'Yes / No',
}

// How a stored value reads on the page.
export function formatSectionValue(type: ContractFieldType, value: string): string {
  if (value === '') return '–'
  if (type === 'PERCENTAGE') return `${value}%`
  if (type === 'AMOUNT') {
    const n = Number(value)
    return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : value
  }
  return value
}

export function validSectionValue(type: ContractFieldType, value: string): boolean {
  if (value === '') return true
  if (type === 'PERCENTAGE' || type === 'AMOUNT') return Number.isFinite(Number(value))
  if (type === 'YES_NO') return value === 'Yes' || value === 'No'
  return value.length <= 2000
}

export const contractSchema = z.object({
  name: z.string().trim().min(1, 'Enter the contract name.').max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v)),
  period: z.enum(CONTRACT_PERIODS),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v)),
  // sectionDefId → value; blank values are removed.
  sections: z.record(z.string(), z.string().trim().max(2000)),
})
export type ContractInput = z.input<typeof contractSchema>

export const sectionDefSchema = z.object({
  name: z.string().trim().min(1, 'Enter the section name.').max(120),
  fieldType: z.enum(FIELD_TYPES),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === '' ? null : v)),
})
export type SectionDefInput = z.input<typeof sectionDefSchema>
