import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  // Verify caller is owner via cookie session
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Hanya Owner yang dapat menambah user' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.email || !body?.password || !body?.full_name || !body?.role) {
    return NextResponse.json({ error: 'Field wajib: email, password, full_name, role' }, { status: 400 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: 'Server belum dikonfigurasi (SUPABASE_SERVICE_ROLE_KEY missing)' }, { status: 500 })
  }

  // Admin client — bypass RLS, can create users without affecting current session
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true, // skip email verification — admin-created
    user_metadata: { full_name: body.full_name, role: body.role },
  })
  if (createErr || !created.user) {
    return NextResponse.json({ error: createErr?.message || 'Gagal membuat user' }, { status: 400 })
  }

  // Upsert profile (in case trigger doesn't exist or doesn't include role)
  const { error: profileErr } = await admin.from('profiles').upsert({
    id: created.user.id,
    full_name: body.full_name,
    role: body.role,
    active: true,
  })
  if (profileErr) {
    // Roll back the auth user so caller can retry
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: `Gagal simpan profile: ${profileErr.message}` }, { status: 400 })
  }

  return NextResponse.json({ id: created.user.id, email: created.user.email })
}
