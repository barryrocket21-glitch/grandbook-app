import { NextResponse } from 'next/server'
import { requireOperationsUser } from '@/lib/server/operations-auth'
import { buildMissingSpxDraftPayloads, type SpxShipmentDetailRow } from '@/lib/recon/spx-missing-order-persist'
import { spxMissingRequestSchema } from '@/lib/schemas/spx-missing-request'

export async function POST(request: Request) {
  const auth = await requireOperationsUser(request, true)
  if ('response' in auth) return auth.response
  if (!['owner', 'admin'].includes(auth.profile.role)) {
    return NextResponse.json({ error: 'Hanya owner/admin yang bisa menyimpan order SPX.' }, { status: 403 })
  }
  const parsed = spxMissingRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Data impor SPX tidak valid. Maksimal 200 baris per permintaan.' }, { status: 400 })
  const { rows, channelId, initialStatus, sourceProfileId } = parsed.data
  let payloads: Array<Record<string, unknown>>
  try {
    payloads = await buildMissingSpxDraftPayloads(auth.sb, auth.profile.organization_id, channelId, auth.user.id, rows as SpxShipmentDetailRow[])
  } catch {
    return NextResponse.json({ error: 'Referensi produk belum dapat dimuat. Coba lagi.' }, { status: 503 })
  }
  const { data, error } = await auth.sb.rpc('persist_missing_spx_orders', {
    p_rows: payloads, p_channel_id: channelId, p_initial_status: initialStatus,
    p_source_profile_id: sourceProfileId,
  })
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === '22023' ? 400 : error.code === '23505' ? 409 : 503
    return NextResponse.json({ error: status === 409
      ? 'Data order berubah saat impor. Ulangi pemeriksaan.'
      : status === 400 ? 'Isi order SPX tidak valid.'
        : status === 403 ? 'Akses atau referensi impor tidak diizinkan.'
          : 'Penyimpanan belum dikonfirmasi. Aman untuk mengulang impor yang sama.' }, { status })
  }
  return NextResponse.json({ ok: true, ...data })
}
