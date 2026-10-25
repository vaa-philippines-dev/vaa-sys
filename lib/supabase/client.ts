import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Module-level singleton. Every caller shares one client and one auth listener.
//
// This client is auth-only. Supabase Realtime is deliberately not wired up:
// the app previously held a websocket per signed-in tab (a dead `tasks`
// channel on every dashboard page, a `notifications` channel for the bell, and
// a `messages` channel per open Inbox conversation), which spends Realtime
// concurrent connections and messages continuously for features that are fine
// being fetched on demand. Nothing subscribes any more, so there's no
// realtime.setAuth() call to keep in sync with the session either.
let client: SupabaseClient | undefined

export function createClient() {
  if (client) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  }

  client = createBrowserClient(url, key)
  return client
}
