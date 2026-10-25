import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Everything is protected except the login screen, the OAuth callback and
// the customer onboarding form (gated by its own link token instead).
// This only checks for a Supabase session; whether that person is allowed in
// (an active, non-VA account in public.users) is checked per page in
// lib/auth.ts, same split as va-management.
const publicPaths = ['/login', '/callback', '/onboarding']

export async function proxy(request: NextRequest) {
  // Dev-only auth bypass — see lib/auth.ts.
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS_EMAIL) {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl
  const isPublic = publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL('/login', request.url))
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!isPublic && !session) {
    const loginUrl = new URL('/login', request.url)
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Signed in already: skip the login screen (but not when it's showing an
  // error, e.g. a signed-in Google account that isn't allowed in).
  if (pathname === '/login' && session && !request.nextUrl.searchParams.has('error')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.png|.*\\.png$).*)'],
}
