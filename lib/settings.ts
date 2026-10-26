import { prisma } from '@/lib/prisma'
import type { SettingCategory, SettingOptionLite } from '@/lib/settings-fields'

// Server-only reads of the Settings lookup lists.

const lite = { id: true, value: true, label: true, isActive: true, timezone: true } as const

// What a form offers: the active options in order, plus the one already
// chosen if it has since been deactivated (so editing never drops it).
export async function settingOptions(category: SettingCategory, keepId?: string | null): Promise<SettingOptionLite[]> {
  return prisma.settingOption.findMany({
    where: { category, OR: [{ isActive: true }, ...(keepId ? [{ id: keepId }] : [])] },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: lite,
  })
}

export async function settingOptionsFor<C extends SettingCategory>(categories: readonly C[]): Promise<Record<C, SettingOptionLite[]>> {
  const rows = await prisma.settingOption.findMany({
    where: { category: { in: [...categories] } },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { ...lite, category: true },
  })
  return Object.fromEntries(categories.map((c) => [c, rows.filter((r) => r.category === c)])) as unknown as Record<C, SettingOptionLite[]>
}

export async function allSettingsIn(category: SettingCategory) {
  return prisma.settingOption.findMany({ where: { category }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })
}
