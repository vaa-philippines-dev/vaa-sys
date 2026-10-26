import { cache } from 'react'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { createServerSupabase } from '@/lib/supabase/server'
import { canUse, homeFor, type AccessRole, type Area } from '@/lib/access-fields'
import { can, type Action, type Module } from '@/lib/permissions'

// Identity is Supabase Auth (Google only, the same Supabase project as
// va-management), and the person must have an active va-management account
// (public.users, read with raw SQL). What they can open in vaa-sys comes
// from their role: va-management SUPER_ADMIN/SYSTEM_ADMIN are admins here;
// everyone else needs a row in vaa_sys.access_users.

export type StaffUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  systemRole: string
  isActive: boolean
  isBot: boolean
}

// departmentId: a Service Manager's Workforce department (public.departments).
export type SessionUser = StaffUser & { role: AccessRole | null; departmentId: string | null }
export type Actor = SessionUser & { role: AccessRole }

const ADMIN_SYSTEM_ROLES = ['SUPER_ADMIN', 'SYSTEM_ADMIN']
// Workforce also has system and test accounts with admin roles (e.g. the
// VAConnections sync user); only real company mailboxes count as admins here.
export const ADMIN_EMAIL_DOMAIN = '@vaaphilippines.com'

// Dev-only: same DEV_AUTH_BYPASS_EMAIL switch as va-management. Never set it
// on Vercel/production; NODE_ENV is always 'production' there.
const DEV_AUTH_BYPASS_EMAIL =
  process.env.NODE_ENV !== 'production' ? process.env.DEV_AUTH_BYPASS_EMAIL : undefined

export async function findStaffUser(email: string): Promise<StaffUser | null> {
  const rows = await prisma.$queryRaw<StaffUser[]>`
    SELECT id,
           email,
           first_name        AS "firstName",
           last_name         AS "lastName",
           system_role::text AS "systemRole",
           is_active         AS "isActive",
           is_bot            AS "isBot"
    FROM public.users
    WHERE lower(email) = lower(${email})
    LIMIT 1`
  return rows[0] ?? null
}

// No auto-provisioning: anyone who isn't a Workforce admin and has no
// active access row gets no role, and so no access at all.
export async function resolveAccess(staff: StaffUser): Promise<{ role: AccessRole | null; departmentId: string | null }> {
  if (!staff.isActive || staff.isBot) return { role: null, departmentId: null }
  if (ADMIN_SYSTEM_ROLES.includes(staff.systemRole) && staff.email.toLowerCase().endsWith(ADMIN_EMAIL_DOMAIN)) return { role: 'ADMIN', departmentId: null }
  const access = await prisma.accessUser.findUnique({
    where: { email: staff.email.toLowerCase() },
    select: { role: true, isActive: true, departmentId: true },
  })
  return access?.isActive ? { role: access.role, departmentId: access.departmentId } : { role: null, departmentId: null }
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  let email = DEV_AUTH_BYPASS_EMAIL
  if (!email) {
    const supabase = await createServerSupabase()
    if (!supabase) return null
    const {
      data: { user },
    } = await supabase.auth.getUser()
    email = user?.email
  }
  if (!email) return null

  const staff = await findStaffUser(email)
  if (!staff) return null
  return { ...staff, ...(await resolveAccess(staff)) }
})

// For pages: anyone signed out goes to login, anyone without this area goes
// to their own landing page.
export async function requireArea(area: Area, next?: string): Promise<Actor> {
  const user = await requireSignedIn(next)
  if (!canUse(user.role, area)) redirect(homeFor(user.role))
  return user
}

// Same, for a module of the capability map (lib/permissions.ts).
export async function requireCan(module: Module, action: Action = 'read', next?: string): Promise<Actor> {
  const user = await requireSignedIn(next)
  if (!can(user.role, module, action)) redirect(homeFor(user.role))
  return user
}

export async function requireSignedIn(next?: string): Promise<Actor> {
  const user = await getCurrentUser()
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  if (!user.role) redirect('/login?error=no_access')
  return user as Actor
}

// For Server Actions: null instead of a redirect, so the caller can answer
// with an error message.
export async function getActor(area: Area): Promise<Actor | null> {
  const user = await getCurrentUser()
  return user && canUse(user.role, area) ? (user as Actor) : null
}

export async function getActorFor(module: Module, action: Action): Promise<Actor | null> {
  const user = await getCurrentUser()
  return user && can(user.role, module, action) ? (user as Actor) : null
}

export function displayName(user: Pick<StaffUser, 'firstName' | 'lastName' | 'email'>) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
}
