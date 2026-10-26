import { prisma } from '@/lib/prisma'
import { DEFAULT_MINIMUMS, minimumsSchema, type WorkHourMinimums } from '@/lib/onboarding-fields'
import type { SettingCategory, SettingOptionLite } from '@/lib/settings-fields'

// Server-only reads of the Settings lookup lists, and the general settings
// admins edit in the app (vaa_sys.app_settings).

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

// ── Work hour type minimums (onboarding form) ────────────────────

const MINIMUMS_KEY = 'work_hour_minimums'

// The work hour type minimums, or the built-in defaults where none are saved.
export async function getWorkHourMinimums(): Promise<WorkHourMinimums> {
  const row = await prisma.appSetting.findUnique({ where: { key: MINIMUMS_KEY } }).catch(() => null)
  const parsed = minimumsSchema.partial().safeParse(row?.value ?? {})
  return { ...DEFAULT_MINIMUMS, ...(parsed.success ? parsed.data : {}) }
}

export async function getWorkHourMinimumsRow() {
  return prisma.appSetting.findUnique({ where: { key: MINIMUMS_KEY }, select: { updatedAt: true, updatedByEmail: true } })
}

export async function saveWorkHourMinimums(value: WorkHourMinimums, email: string) {
  await prisma.appSetting.upsert({
    where: { key: MINIMUMS_KEY },
    create: { key: MINIMUMS_KEY, value, updatedByEmail: email },
    update: { value, updatedByEmail: email, updatedAt: new Date() },
  })
}
