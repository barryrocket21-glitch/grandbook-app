import { serverEnvironmentResponse } from '@/lib/server/environment-guard'
import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'

async function requireManager() {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await sb.from('profiles').select('role, active, organization_id').eq('id', user.id).single()
  if (!profile?.active || !profile.organization_id || (profile.role !== 'owner' && profile.role !== 'admin')) {
    return { error: 'Hanya owner/admin', status: 403 as const }
  }
  return { ok: true as const, sb }
}

export async function POST(request: Request) {
  const environmentResponse = serverEnvironmentResponse('POST', '/api/reconciliation/spx-status/debug-read')
  if (environmentResponse) return environmentResponse
  const auth = await requireManager()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({})) as { refs?: string[] }
  const refs = Array.isArray(body.refs) ? body.refs.filter(Boolean).slice(0, 200) : []
  if (refs.length === 0) return NextResponse.json({ error: 'refs wajib diisi' }, { status: 400 })

  const { data, error } = await auth.sb
    .from('orders_draft')
    .select('id, order_number, external_order_id, tracking_no, resi, status, customer_name, cs_name, campaign_id, advertiser_id, attribution_status, attribution_code_raw, attribution_platform, attribution_account_code, attribution_campaign_marker, meta, order_items_draft(product_id, product_name_raw, variation, qty, price)')
    .in('external_order_id', refs)
    .order('id', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, rows: data ?? [] })
}
