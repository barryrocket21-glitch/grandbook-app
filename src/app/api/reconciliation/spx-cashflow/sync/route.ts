import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import {
  buildSpxFinanceTransactionUrl,
  extractSpxList,
  normalizeSpxFinanceApiRows,
  toUnixEndOfDay,
  toUnixStartOfDay,
} from '@/lib/recon/spx-api'

const SPX_ORIGIN = 'https://spx.co.id'
const DEFAULT_BUSINESS_ENTITY = '4'
const DEFAULT_PRODUCT_LINE = '7'
const DEFAULT_PAGE_SIZE = 100
const MAX_PAGES = 20

type RequestBody = {
  from?: string
  to?: string
  bizAccountId?: string
  businessEntity?: string
  productLine?: string
  spxCookie?: string
}

async function requireManager() {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner' && profile?.role !== 'admin' && profile?.role !== 'akunting') {
    return { error: 'Hanya owner/admin/akunting yang bisa sync SPX', status: 403 as const }
  }
  return { ok: true as const, sb }
}

function sanitizeCookie(cookie: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ')
}

function getCookie(body: RequestBody): string {
  const fromBody = body.spxCookie ? sanitizeCookie(body.spxCookie) : ''
  const fromEnv = process.env.SPX_ADMIN_COOKIE ? sanitizeCookie(process.env.SPX_ADMIN_COOKIE) : ''
  return fromBody || fromEnv
}

export async function POST(request: Request) {
  const auth = await requireManager()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({})) as RequestBody
  const from = body.from
  const to = body.to || body.from
  if (!from || !to) {
    return NextResponse.json({ error: 'Range tanggal wajib: from dan to (YYYY-MM-DD)' }, { status: 400 })
  }

  const bizAccountId = body.bizAccountId || process.env.SPX_BIZ_ACCOUNT_ID
  if (!bizAccountId) {
    return NextResponse.json({
      error: 'bizAccountId SPX belum diisi',
      hint: 'Isi dari Network SPX atau env SPX_BIZ_ACCOUNT_ID. Contoh akun yang kemarin kebaca: 6182855474.',
    }, { status: 400 })
  }

  const spxCookie = getCookie(body)
  if (!spxCookie) {
    return NextResponse.json({
      error: 'Session cookie SPX belum ada',
      hint: 'Login SPX dulu, lalu isi cookie sementara di form Auto Sync atau set env SPX_ADMIN_COOKIE. Cookie tidak disimpan oleh GrandBook.',
    }, { status: 400 })
  }

  const startUnix = toUnixStartOfDay(from)
  const endUnix = toUnixEndOfDay(to)
  const businessEntity = body.businessEntity || process.env.SPX_BUSINESS_ENTITY || DEFAULT_BUSINESS_ENTITY
  const productLine = body.productLine || process.env.SPX_PRODUCT_LINE || DEFAULT_PRODUCT_LINE

  const apiRows: Record<string, unknown>[] = []
  let lastPayload: unknown = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * DEFAULT_PAGE_SIZE
    const path = buildSpxFinanceTransactionUrl({
      businessEntity,
      productLine,
      bizAccountId,
      startUnix,
      endUnix,
      offset,
      size: DEFAULT_PAGE_SIZE,
    })

    const res = await fetch(`${SPX_ORIGIN}${path}`, {
      headers: {
        cookie: spxCookie,
        accept: 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 GrandBook SPX Sync',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json({
        error: `SPX API gagal: HTTP ${res.status}`,
        hint: 'Session kemungkinan expired / perlu login ulang / OTP. Manual upload tetap bisa dipakai.',
      }, { status: 502 })
    }

    const payload = await res.json().catch(() => null)
    lastPayload = payload
    const list = extractSpxList(payload)
    apiRows.push(...list)
    if (list.length < DEFAULT_PAGE_SIZE) break
  }

  const rows = normalizeSpxFinanceApiRows(apiRows)
  if (rows.length === 0) {
    return NextResponse.json({
      error: 'SPX API tidak mengembalikan transaksi valid',
      pulled: apiRows.length,
      sampleShape: lastPayload && typeof lastPayload === 'object' ? Object.keys(lastPayload as Record<string, unknown>).slice(0, 20) : [],
    }, { status: 400 })
  }

  const { data, error } = await auth.sb.rpc('preview_spx_cashflow_recon', {
    p_rows: rows.map((r) => ({
      external_id: r.external_id,
      tx_type: r.tx_type,
      tracking: r.tracking,
      update_time: r.update_time,
      nominal: r.nominal,
      balance_before: r.balance_before,
      balance_after: r.balance_after,
      withdrawal_fee: r.withdrawal_fee,
      net_received: r.net_received,
      status: r.status,
      bank_account: r.bank_account,
      reference_no: r.reference_no,
      rejection_reason: r.rejection_reason,
      create_time: r.create_time,
      complete_time: r.complete_time,
    })),
    p_file_name: `spx-api-${from}-to-${to}.json`,
    p_file_size_bytes: JSON.stringify(apiRows).length,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const result = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    ok: true,
    source: 'spx_api',
    pulled_rows: apiRows.length,
    normalized_rows: rows.length,
    preview: result,
  })
}
