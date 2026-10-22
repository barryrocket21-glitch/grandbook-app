import { NextResponse } from 'next/server'
import { requireOperationsUser } from '@/lib/server/operations-auth'
import { z } from 'zod'
const input = z.object({ draftId: z.number().int().positive(), wilayahId: z.number().int().positive(), detail: z.string().trim().min(1).max(10000), expectedUpdatedAt: z.string().datetime({ offset: true }) })

export async function PATCH(request: Request) {
  const auth = await requireOperationsUser(request, true)
  if ('response' in auth) return auth.response
  const parsed = input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Alamat tidak valid.' }, { status: 400 })
  const { data: wilayah, error } = await auth.sb.from('master_wilayah')
    .select('id, province, city, subdistrict, zip').eq('id', parsed.data.wilayahId).maybeSingle()
  if (error) return NextResponse.json({ error: 'Wilayah belum dapat diverifikasi.' }, { status: 503 })
  if (!wilayah) return NextResponse.json({ error: 'Wilayah tidak ditemukan.' }, { status: 400 })
  const { data: updated, error: saveError } = await auth.sb.from('orders_draft').update({
    wilayah_id: wilayah.id, customer_province: wilayah.province, customer_city: wilayah.city,
    customer_subdistrict: wilayah.subdistrict, customer_zip: wilayah.zip,
    customer_address_detail: parsed.data.detail,
  }).eq('id', parsed.data.draftId).eq('organization_id', auth.profile.organization_id).eq('updated_at', parsed.data.expectedUpdatedAt).select('id').maybeSingle()
  if (saveError) return NextResponse.json({ error: 'Gagal menyimpan alamat.' }, { status: 400 })
  if (!updated) return NextResponse.json({ error: 'Draft sudah berubah atau tidak tersedia. Buka ulang alamat sebelum menyimpan.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
