import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperationsUser } from '@/lib/server/operations-auth'
const input = z.object({
  status: z.string().max(50).optional(), search: z.string().max(200).optional(),
  dateFrom: z.string().date().or(z.literal('')).optional(), dateTo: z.string().date().or(z.literal('')).optional(),
  includeComplete: z.boolean().default(false), after: z.number().int().nonnegative().default(0),
})
export async function POST(request: Request) {
  const auth = await requireOperationsUser(request)
  if ('response' in auth) return auth.response
  const parsed = input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Filter alamat tidak valid.' }, { status: 400 })
  const p = parsed.data
  const { data, error } = await auth.sb.rpc('address_review_queue', {
    p_status: p.status || null, p_search: p.search || null, p_from: p.dateFrom || null,
    p_to: p.dateTo || null, p_include_complete: p.includeComplete, p_after: p.after,
  })
  if (error) return NextResponse.json({ error: 'Antrean alamat gagal dimuat.' }, { status: 503 })
  return NextResponse.json(data || [])
}
