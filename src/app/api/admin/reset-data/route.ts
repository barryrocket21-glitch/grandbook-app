import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const CONFIRM_TOKEN = 'RESET'

export async function POST(request: Request) {
  // Owner only
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await sb.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'Hanya Owner' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || !body.tables || !Array.isArray(body.tables)) {
    return NextResponse.json({ error: 'Body wajib { tables: string[] }' }, { status: 400 })
  }
  // Phase 8I-Followup Fix 4.1 — confirm token diganti dari "HAPUS SEMUA" ke "RESET".
  if (body.confirm !== CONFIRM_TOKEN) {
    return NextResponse.json({ error: `Confirm token salah. Wajib kirim confirm: "${CONFIRM_TOKEN}".` }, { status: 400 })
  }

  const ALLOWED = new Set([
    'orders',           // cascades to order_items + commissions
    'ad_spend',
    'cs_daily_leads',
    'expenses',
    'ad_reconciliation',
    'customers',        // Brief #1 reputasi — cascade dgn orders (anti ghost data)
    // EXCLUDED (master/config — JANGAN wipe): products, campaigns, commission_rules,
    // suppliers, couriers, courier_channels/rates/statuses, converter_profiles +
    // mappings, master_wilayah(_spx), channel_billing_config, product_*, profiles.
    // Reset cuma boleh transaksional. Master data di-manage di Settings masing2.
  ])

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY belum di-set' }, { status: 500 })
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Phase 8I-Followup Fix 4.3 — META audit log entry SEBELUM delete. Capture
  // who/when/which tables/total rows. Per-row DELETE akan ke-log via trigger
  // (Fix 4.2). Meta event ini terpisah supaya searchable & ringkas.
  //
  // Pre-flight: hitung baris yang AKAN dihapus per table untuk include di payload.
  const tablesRequested: string[] = body.tables.filter((t: string) => ALLOWED.has(t))
  // Anti ghost data — reset orders WAJIB ikut reset customers (reputasi di-derive
  // dari orders; tanpa ini customers nyangkut tanpa order). Auto-cascade.
  if (tablesRequested.includes('orders') && !tablesRequested.includes('customers')) {
    tablesRequested.push('customers')
  }
  const preCounts: Record<string, number | null> = {}
  for (const t of tablesRequested) {
    const { count } = await admin.from(t).select('*', { head: true, count: 'exact' })
    preCounts[t] = count ?? null
  }
  const totalRows = Object.values(preCounts).reduce<number>((sum, c) => sum + (c ?? 0), 0)

  try {
    await admin.from('audit_log').insert({
      user_id: user.id,
      table_name: 'orders',  // Bucket dominant — orders is yang paling impactful biasanya
      record_id: 'RESET_ALL',
      action: 'BULK_DELETE',
      old_value: {
        reason: 'Reset Data button (/settings/reset-data)',
        tables: tablesRequested,
        pre_counts: preCounts,
        total_rows: totalRows,
        organization_id: profile?.organization_id ?? null,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    // Non-fatal — kalau audit_log insert gagal, lanjut tapi log warning di response.
    console.warn('Reset Data: audit_log insert failed', err)
  }

  const results: Record<string, number | string> = {}
  // Order matters: customers DULUAN (sebelum orders) supaya trigger order-DELETE
  // early-exit (gak full-scan recompute per row) → bulk delete tetap cepat.
  // Lalu orders (commissions cascade), baru sisanya.
  const order = ['customers', 'orders', 'cs_daily_leads', 'ad_spend', 'expenses', 'ad_reconciliation']
  for (const t of order) {
    if (!tablesRequested.includes(t)) continue
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results[t] = `error: ${msg}`
    }
  }

  return NextResponse.json({
    ok: true,
    results,
    audit: { user_id: user.id, total_rows_before_delete: totalRows, timestamp: new Date().toISOString() },
  })
}
