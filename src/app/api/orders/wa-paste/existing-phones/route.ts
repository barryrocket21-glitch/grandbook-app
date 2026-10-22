import { NextResponse } from 'next/server'
import { requireOperationsUser } from '@/lib/server/operations-auth'
import { z } from 'zod'
const input = z.object({ phones: z.array(z.string().trim().min(1).max(40)).max(1000) })

export async function POST(request: Request) {
  const auth = await requireOperationsUser(request)
  if ('response' in auth) return auth.response
  const parsed = input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Daftar telepon tidak valid.' }, { status: 400 })
  const phones = [...new Set(parsed.data.phones)]
  if (!phones.length) return NextResponse.json({ phones: [] })
  const { data, error } = await auth.sb.rpc('operations_existing_phones_today', { p_phones: phones })
  if (error) return NextResponse.json({ error: 'Pemeriksaan duplikat belum tersedia.' }, { status: 503 })
  return NextResponse.json({ phones: data || [] })
}
