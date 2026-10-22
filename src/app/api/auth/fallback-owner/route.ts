import { NextResponse } from 'next/server'
import { clearLegacyOwnerCookies } from '@/lib/server/fallback-owner'

export async function POST() {
  return clearLegacyOwnerCookies(NextResponse.json(
    { error: 'Akses emergency sudah dinonaktifkan. Gunakan login biasa.' },
    { status: 410 },
  ))
}
