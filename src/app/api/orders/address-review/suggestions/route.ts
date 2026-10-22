import { NextResponse } from 'next/server'
import { requireOperationsUser } from '@/lib/server/operations-auth'
import { z } from 'zod'
const input = z.object({ draftId: z.number().int().positive(), limit: z.number().int().min(1).max(20).default(6) })

export async function POST(request: Request) {
  const auth = await requireOperationsUser(request)
  if ('response' in auth) return auth.response
  const parsed = input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Draft tidak valid.' }, { status: 400 })
  const { data: draft, error: draftError } = await auth.sb.from('orders_draft').select('id')
    .eq('id', parsed.data.draftId).eq('organization_id', auth.profile.organization_id).maybeSingle()
  if (draftError) return NextResponse.json({ error: 'Draft belum dapat diverifikasi.' }, { status: 503 })
  if (!draft) return NextResponse.json({ error: 'Draft tidak ditemukan.' }, { status: 404 })
  const { data, error } = await auth.sb.rpc('suggest_draft_wilayah', { p_draft_id: parsed.data.draftId, p_limit: parsed.data.limit })
  if (error) return NextResponse.json({ error: 'Saran wilayah gagal dimuat.' }, { status: 503 })
  return NextResponse.json(data || [])
}
