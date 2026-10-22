import type { NextResponse } from 'next/server'

// Retired credentials are never read or accepted. Only cookie names remain for cleanup.
export const LEGACY_OWNER_COOKIES = ['gb_emergency_owner', 'gb_emergency_owner_ui'] as const

export function clearLegacyOwnerCookies(response: NextResponse) {
  for (const name of LEGACY_OWNER_COOKIES) {
    response.cookies.set(name, '', { path: '/', maxAge: 0, expires: new Date(0), httpOnly: name === 'gb_emergency_owner', sameSite: 'lax' })
  }
  return response
}
