'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const errorMessages: Record<string, string> = {
  unauthorized: "This Google account isn't registered in the VAA system. Please use the account your manager provided.",
  no_access: "Your account doesn't have access to VAA Systems yet. Ask your manager or an admin to add you.",
  auth_failed: 'Sign in failed. Please try again.',
  access_denied: 'You declined the Google sign-in. Please try again.',
  account_disabled: 'Your account has been disabled. Please contact your administrator.',
}

function describeError(code?: string, description?: string) {
  if (!code) return null
  return errorMessages[code] ?? description ?? `Sign in failed (${code}). Please try again.`
}

export function LoginForm({
  className,
  next,
  errorCode,
  errorDescription,
}: {
  className?: string
  next?: string
  errorCode?: string
  errorDescription?: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(describeError(errorCode, errorDescription))

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError(null)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      // Clear any leftover session (e.g. an account that was just refused)
      // so the Google account picker starts clean.
      await supabase.auth.signOut().catch(() => {})
      const callbackUrl = new URL('/callback', window.location.origin)
      if (next) callbackUrl.searchParams.set('next', next)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) {
        setError(error.message)
        setLoading(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div
      className={cn(
        'relative w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-950 px-8 py-10 shadow-2xl',
        className
      )}
    >
      <div className="fade-in-stagger flex flex-col items-center">
        <Image
          src="/vaa-logo-white.png"
          alt="VAA Philippines"
          width={350}
          height={134}
          className="h-auto w-28"
          priority
        />

        <p
          className="mt-4 mb-10 whitespace-nowrap text-center font-semibold leading-none tracking-[0.10em] text-white"
          style={{
            fontFamily: 'var(--font-montserrat)',
            fontSize: 'clamp(0.2rem, 4.0vw, 0.8rem)',
          }}
        >
          Our <span style={{ color: '#9CA3AF' }}>E</span>xperts . Your Growth
        </p>
        <p className="mt-1 text-center text-sm font-semibold uppercase tracking-wide text-white">
          Customer &amp; Lead Management
        </p>
        <p className="mt-1.5 text-center text-xs text-white/50">
          Continue with your VAA Philippines Google account.
        </p>

        <Button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="mt-6 h-9 w-full rounded-lg border border-black/10 bg-white text-sm font-medium text-black hover:bg-neutral-100"
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 48 48" aria-hidden>
            <path
              fill="#FFC107"
              d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
              c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
              c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
            />
            <path
              fill="#FF3D00"
              d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039
              l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
            />
            <path
              fill="#4CAF50"
              d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
              c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
            />
            <path
              fill="#1976D2"
              d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
              c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
            />
          </svg>
          {loading ? 'Redirecting...' : 'Sign in with Google'}
        </Button>

        {error && (
          <div className="mt-4 w-full rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">Sign in failed</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        <p className="mt-6 text-center text-[11px] text-white/30">
          Uses your VAA Workforce Google account.
        </p>
      </div>
    </div>
  )
}
