import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireOperationsUser } from './operations-auth'

export async function requireUserManager(request: Request, write = false) {
  const auth = await requireOperationsUser(request, write)
  if (auth.response) return auth
  if (!['owner', 'admin'].includes(auth.profile.role)) {
    return { response: NextResponse.json({ error: 'Hanya Owner atau Admin.' }, { status: 403 }) }
  }
  return auth
}

export function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return key ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) : null
}

export const accountRoles = ['owner', 'admin', 'cs', 'advertiser', 'akunting'] as const
export function canAssignRole(actor: string, requested: string) {
  return accountRoles.some(role => role === requested)
    && (actor === 'owner' || (actor === 'admin' && !['owner', 'admin'].includes(requested)))
}
