import { createBrowserClient } from '@supabase/ssr'
import { protectSupabaseClient } from '@/lib/staging-readonly'

export function createClient() {
  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  return protectSupabaseClient(client)
}
