import { NextResponse } from 'next/server'
import { requireOperationsUser } from '@/lib/server/operations-auth'
import { inboxResiRequestSchema } from '@/lib/schemas/inbox-resi-request'

async function authorize(request: Request, write = false) {
  const auth = await requireOperationsUser(request, write)
  if ('response' in auth) return auth
  if (!['owner', 'admin'].includes(auth.profile.role)) {
    return { response: NextResponse.json({ error: 'Hanya owner/admin yang bisa mengelola inbox resi.' }, { status: 403 }) }
  }
  return auth
}

export async function GET(request: Request) {
  const auth = await authorize(request)
  if ('response' in auth) return auth.response
  const params = new URL(request.url).searchParams
  const mode = params.get('mode') ?? 'queue'
  if (mode === 'orders') {
    const query = params.get('q')?.trim() ?? ''
    if (query.length < 2 || query.length > 200) return NextResponse.json({ error: 'Isi pencarian 2–200 karakter.' }, { status: 400 })
    const { data, error } = await auth.sb.rpc('search_unmatched_resi_orders', { p_query: query })
    if (error) return NextResponse.json({ error: 'Pencarian order belum berhasil. Coba lagi.' }, { status: 503 })
    return NextResponse.json({ rows: data })
  }
  if (mode === 'references') {
    const org = auth.profile.organization_id
    const responses = await Promise.all([
      auth.sb.from('converter_profiles').select('id,code,name').order('code'),
      auth.sb.from('courier_channels').select('id,code,name').eq('active', true).order('name'),
      auth.sb.from('products').select('id,name,price_default,has_variants').eq('organization_id', org).eq('active', true).order('name'),
      auth.sb.from('product_variants').select('id,product_id,variant_name,price').eq('organization_id', org).eq('active', true).order('variant_name'),
      auth.sb.from('profiles').select('id,full_name').eq('organization_id', org).eq('active', true).in('role', ['owner', 'admin', 'cs']).order('full_name'),
    ])
    if (responses.some(r => r.error)) return NextResponse.json({ error: 'Referensi belum dapat dimuat. Coba lagi.' }, { status: 503 })
    const [profiles, channels, products, variants, cs] = responses.map(r => r.data)
    return NextResponse.json({ profiles, channels, products, variants, cs })
  }
  const status = params.get('status') ?? 'PENDING'
  const query = params.get('q')?.trim() ?? ''
  const profile = params.get('profile') ?? 'ALL'
  const page = Number(params.get('page') ?? '0')
  if (mode !== 'queue' || !['PENDING', 'RESOLVED', 'ALL'].includes(status) || query.length > 200
    || !Number.isSafeInteger(page) || page < 0 || page > 10000 || (profile !== 'ALL' && !/^[1-9][0-9]{0,14}$/.test(profile))) {
    return NextResponse.json({ error: 'Filter inbox tidak valid.' }, { status: 400 })
  }
  let requestQuery = auth.sb.from('inbox_unmatched_resi')
    .select('id,source_profile_id,raw_resi,raw_data,resolved,resolution,resolved_to_order_id,resolved_to_draft_id,resolved_order_number,resolution_note,resolved_at,created_at,updated_at,resolved_order:orders!resolved_to_order_id(order_number)', { count: 'exact' })
    .eq('organization_id', auth.profile.organization_id).order('created_at', { ascending: false }).order('id', { ascending: false })
  if (status === 'PENDING') requestQuery = requestQuery.or('resolved.eq.false,resolved.is.null')
  if (status === 'RESOLVED') requestQuery = requestQuery.eq('resolved', true)
  if (profile !== 'ALL') requestQuery = requestQuery.eq('source_profile_id', Number(profile))
  if (query) requestQuery = requestQuery.ilike('raw_resi', `%${query.replace(/[\\%_]/g, '\\$&')}%`)
  const { data, error, count } = await requestQuery.range(page * 100, page * 100 + 99)
  if (error) return NextResponse.json({ error: 'Inbox belum dapat dimuat. Coba lagi.' }, { status: 503 })
  const rows = data?.map(row => {
    const legacy = row.resolved_order as unknown as { order_number: string } | null
    return { ...row, resolved_order_number: row.resolved_order_number ?? legacy?.order_number ?? null }
  })
  return NextResponse.json({ rows, count, page })
}

export async function POST(request: Request) {
  const auth = await authorize(request, true)
  if ('response' in auth) return auth.response
  const text = await request.text()
  if (text.length > 100000) return NextResponse.json({ error: 'Permintaan terlalu besar.' }, { status: 400 })
  const parsed = inboxResiRequestSchema.safeParse(await Promise.resolve().then(() => JSON.parse(text)).catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Lengkapi data yang wajib diisi; periksa telepon, tanggal, produk, jumlah dan harga.' }, { status: 400 })
  const input = parsed.data
  const { data, error } = await auth.sb.rpc('resolve_unmatched_resi', {
    p_inbox_id: input.inboxId, p_request_id: input.requestId, p_expected_updated_at: input.updatedAt,
    p_action: input.action, p_payload: input.payload,
  }).abortSignal(AbortSignal.timeout(20000))
  if (error) {
    const code = error.code ?? ''
    const status = ['PT409', '40001', '23505'].includes(code) ? 409 : code === '42501' ? 403 : code.startsWith('22') ? 400 : 503
    return NextResponse.json({ error: status === 409
      ? 'Data berubah atau resi/referensi sudah dipakai. Muat ulang inbox dan cari order yang sesuai.'
      : status === 403 ? 'Inbox, order, atau referensi tidak tersedia untuk akun ini.'
        : status === 400 ? 'Data order tidak lengkap atau tidak valid. Periksa item dan variannya.'
          : 'Penyimpanan belum dikonfirmasi. Aman untuk mengulang permintaan yang sama.' }, { status })
  }
  return NextResponse.json({ ok: true, ...data })
}
