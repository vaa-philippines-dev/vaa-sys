import { z } from 'zod'

// Client-safe: the Settings lookup lists (legacy Settings tab). The names
// are the legacy CMS's own category names so the later data import maps
// one to one. Department and Service are listed for the Settings page but
// come from Workforce, so they can't be edited here.

export const SETTING_CATEGORIES = [
  'Category',
  'Type',
  'CountryRegion',
  'TerminationReason',
  'VARequestLostReason',
  'InquiryType',
  'InquiryLostReason',
] as const
export type SettingCategory = (typeof SETTING_CATEGORIES)[number]

export const WORKFORCE_CATEGORIES = ['Department', 'Service'] as const
export type WorkforceCategory = (typeof WORKFORCE_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<SettingCategory | WorkforceCategory, string> = {
  Category: 'Account categories',
  Type: 'Account types',
  CountryRegion: 'Countries / regions',
  TerminationReason: 'Termination reasons',
  VARequestLostReason: 'Service request lost reasons',
  InquiryType: 'Inquiry types',
  InquiryLostReason: 'Inquiry lost reasons',
  Department: 'Departments',
  Service: 'Services',
}

export const CATEGORY_HINTS: Record<SettingCategory | WorkforceCategory, string> = {
  Category: 'Picked on each account (Seller, Agency…).',
  Type: 'Picked on each account (Silver, Gold, Platinum).',
  CountryRegion: 'Picked on each account. The time zone is used for the customer’s local time.',
  TerminationReason: 'Offered when a customer or account is terminated or cancelled.',
  VARequestLostReason: 'Offered when a service request is closed as lost.',
  InquiryType: 'The kinds of concerns and inquiries.',
  InquiryLostReason: 'Offered when an inquiry is closed unresolved.',
  Department: 'Workforce’s service departments. Add or rename them in VAA Workforce.',
  Service: 'Workforce’s services, under the department that offers them. Manage them in VAA Workforce.',
}

export function isSettingCategory(v: string | null | undefined): v is SettingCategory {
  return SETTING_CATEGORIES.includes(v as SettingCategory)
}

export const settingSchema = z.object({
  category: z.enum(SETTING_CATEGORIES),
  value: z.string().trim().min(1, 'Enter a value.').max(120),
  label: z.string().trim().max(120),
  timezone: z
    .string()
    .trim()
    .max(64)
    .refine((v) => v === '' || isTimeZone(v), 'Enter an IANA time zone, e.g. Asia/Manila.'),
})
export type SettingInput = z.input<typeof settingSchema>

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export type SettingOptionLite = { id: string; value: string; label: string; isActive: boolean; timezone: string | null }
