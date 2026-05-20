import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Phase 8H audit — extend ke admin. Critical role changes (e.g. demote owner)
// tetap perlu owner-only nanti kalau Barry minta restrict di operation-level.
async function requireOwner() {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await sb.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (profile?.role !== 'owner' && profile?.role !== 'admin') {
    return { error: 'Hanya Owner atau Admin yang dapat mengakses', status: 403 as const }
  }
  return { ok: true as const, orgId: profile.organization_id as number | null }
}

function getAdmin() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return null
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  const auth = await requireOwner()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const admin = getAdmin()
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY belum di-set di env Vercel' }, { status: 500 })

  const [{ data: profiles }, { data: authList, error: authErr }] = await Promise.all([
    admin.from('profiles').select('*').order('created_at'),
    admin.auth.admin.listUsers({ perPage: 200 }),
  ])
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

  const emailById = new Map((authList?.users ?? []).map(u => [u.id, u.email ?? '']))
  const users = (profiles ?? []).map(p => ({ ...p, email: emailById.get(p.id) ?? '' }))
  return NextResponse.json({ users })
}

export async function POST(request: Request) {
  const auth = await requireOwner()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body?.email || !body?.password || !body?.full_name || !body?.role) {
    return NextResponse.json({ error: 'Field wajib: email, password, full_name, role' }, { status: 400 })
  }

  const admin = getAdmin()
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY belum di-set di env Vercel' }, { status: 500 })

  // Don't send user_metadata — many Supabase projects have a handle_new_user
  // trigger that reads metadata and crashes the insert if cast fails.
  // We upsert the profile ourselves below.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    console.error('createUser failed:', createErr)
    return NextResponse.json({
      error: createErr?.message || 'Gagal membuat user',
      hint: 'Jika pesan "Database error creating new user", cek trigger handle_new_user di Supabase SQL editor — biasanya ada baris yang assume role enum atau full_name NOT NULL.',
    }, { status: 400 })
  }

  // Upsert (handles both: trigger already inserted a row, or no trigger).
  // organization_id wajib di-set — tanpa ini RLS current_org_id() mismatch
  // dan user baru ke-block dari semua data (blank state).
  const { error: profileErr } = await admin.from('profiles').upsert({
    id: created.user.id,
    full_name: body.full_name,
    role: body.role,
    active: true,
    organization_id: auth.orgId,
  }, { onConflict: 'id' })
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: `Gagal simpan profile: ${profileErr.message}` }, { status: 400 })
  }

  return NextResponse.json({ id: created.user.id, email: created.user.email })
}
