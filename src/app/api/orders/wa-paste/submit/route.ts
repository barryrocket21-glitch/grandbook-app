import { NextResponse } from 'next/server'
import { requireOperationsUser } from '@/lib/server/operations-auth'
import { waPasteRequest } from '@/lib/schemas/wa-paste-request'

export async function POST(request: Request) {
  const auth = await requireOperationsUser(request, true)
  if ('response' in auth) return auth.response
  const parsed = waPasteRequest.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Data order tidak valid atau CS belum dipilih.' }, { status: 400 })
  const { data, error } = await auth.sb.rpc('submit_wa_orders_checked', {
    p_request_id: parsed.data.requestId,
    p_orders: parsed.data.orders,
    p_confirm_duplicate: parsed.data.confirmDuplicate,
  })
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === '22023' ? 409 : 503
    return NextResponse.json({ error: status === 409
      ? 'Permintaan tidak cocok. Periksa hasil sebelumnya sebelum mengirim data yang berbeda.'
      : 'Pengiriman belum berhasil dikonfirmasi. Coba kirim ulang data yang sama; order tidak akan digandakan.' }, { status })
  }
  if (data?.code === 'PHONE_DUPLICATE_TODAY') return NextResponse.json(data, { status: 409 })
  return NextResponse.json(data)
}
