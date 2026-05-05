import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST() {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'Hanya Owner' }, { status: 403 })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY belum di-set' }, { status: 500 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await admin.rpc('repair_user_creation')
  if (error) {
    return NextResponse.json({
      error: error.message,
      hint: 'Function repair_user_creation belum di-install. Buka Supabase → SQL Editor → paste isi file src/lib/supabase/migrations/003_install_repair_function.sql, lalu Run. Setelah itu klik tombol Auto-Fix lagi.',
    }, { status: 400 })
  }

  return NextResponse.json({ ok: true, message: data })
}
