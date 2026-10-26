import { prisma } from '@/lib/prisma'
import { DEFAULT_MINIMUMS, minimumsSchema, type WorkHourMinimums } from '@/lib/onboarding-fields'

// Server-only: general settings admins edit in the app (vaa_sys.app_settings).

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
