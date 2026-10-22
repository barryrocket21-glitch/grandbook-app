import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { clearLegacyOwnerCookies } from '@/lib/server/fallback-owner'
import { isAllowedRequestOrigin } from '@/lib/server/request-origin'

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ error: 'Origin tidak diizinkan.' }, { status: 403 })
  }
  const sb = await createClient()
  const { error } = await sb.auth.signOut({ scope: 'local' })
  if (error && error.name !== 'AuthSessionMissingError') {
    return clearLegacyOwnerCookies(NextResponse.json({ error: 'Logout belum berhasil. Coba lagi.' }, { status: 503 }))
  }
  return clearLegacyOwnerCookies(NextResponse.json({ ok: true }))
}
