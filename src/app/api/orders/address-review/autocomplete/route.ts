import { NextResponse } from 'next/server'
import { requireOperationsUser } from '@/lib/server/operations-auth'
import { z } from 'zod'
const input = z.object({ query: z.string().trim().min(2).max(200), limit: z.number().int().min(1).max(20).default(8) })

export async function POST(request: Request) {
  const auth = await requireOperationsUser(request)
  if ('response' in auth) return auth.response
  const parsed = input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Pencarian tidak valid.' }, { status: 400 })
  const { data, error } = await auth.sb.rpc('wilayah_autocomplete', { p_query: parsed.data.query, p_limit: parsed.data.limit })
  if (error) return NextResponse.json({ error: 'Pencarian wilayah gagal.' }, { status: 503 })
  return NextResponse.json(data || [])
}
