import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  // Owner only
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'Hanya Owner' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || !body.tables || !Array.isArray(body.tables)) {
    return NextResponse.json({ error: 'Body wajib { tables: string[] }' }, { status: 400 })
  }
  if (body.confirm !== 'HAPUS SEMUA') {
    return NextResponse.json({ error: 'Confirm token salah. Wajib kirim confirm: "HAPUS SEMUA".' }, { status: 400 })
  }

  const ALLOWED = new Set([
    'orders',           // cascades to order_items + commissions
    'ad_spend',
    'cs_daily_leads',
    'expenses',
    'ad_reconciliation',
    'campaigns',
    'commission_rules',
    'products',         // also cascades order_items if not already gone
  ])

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY belum di-set' }, { status: 500 })
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const results: Record<string, number | string> = {}
  // Order matters: kill orders first so commissions cascade, lalu yang lain
  const order = ['orders', 'cs_daily_leads', 'ad_spend', 'expenses', 'ad_reconciliation', 'campaigns', 'commission_rules', 'products']
  for (const t of order) {
    if (!body.tables.includes(t)) continue
    if (!ALLOWED.has(t)) {
      results[t] = 'skipped (not allowed)'
      continue
    }
    try {
      // delete all rows; .neq with impossible id
      const { error, count } = await admin.from(t).delete({ count: 'exact' }).gte('id', 0)
      if (error) {
        // Some tables don't have a numeric id (e.g. uuid). Try a different filter.
        const r2 = await admin.from(t).delete({ count: 'exact' }).not('id', 'is', null)
        if (r2.error) { results[t] = `error: ${r2.error.message}`; continue }
        results[t] = `${r2.count ?? 0} rows`
      } else {
        results[t] = `${count ?? 0} rows`
      }
    } catch (err: any) {
      results[t] = `error: ${err.message}`
    }
  }

  return NextResponse.json({ ok: true, results })
}
