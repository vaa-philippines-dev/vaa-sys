import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { findStaffUser, resolveAccess } from '@/lib/auth'
import { homeFor } from '@/lib/access-fields'

// Google OAuth landing point. Exchanges the code for a Supabase session, then
// lets the person in only if va-management has an active account for their
// email AND they have a vaa-sys role (admin, or a row on the Access page).
// Anyone else is signed straight back out.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next')
  // Only same-site paths, never an absolute URL handed in from outside.
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          },
        },
      }
    )

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      console.error('[callback] exchangeCodeForSession error:', exchangeError.message)
      return NextResponse.redirect(
        `${origin}/login?error=auth_failed&error_description=${encodeURIComponent(exchangeError.message)}`
      )
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    const staff = user?.email ? await findStaffUser(user.email) : null

    if (!staff) {
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/login?error=unauthorized`)
    }
    if (!staff.isActive) {
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/login?error=account_disabled`)
    }
    const { role } = await resolveAccess(staff)
    if (!role) {
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/login?error=no_access`)
    }

    // Lead Managers land in Lead Management, specialists and their manager in
    // Customer Management, admins on the area picker.
    return NextResponse.redirect(`${origin}${next ?? homeFor(role)}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[callback] Unhandled error:', message)
    return NextResponse.redirect(
      `${origin}/login?error=auth_failed&error_description=${encodeURIComponent(message)}`
    )
  }
}
