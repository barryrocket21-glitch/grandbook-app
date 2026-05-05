import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

async function requireOwner() {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const, callerId: '' }
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'owner') return { error: 'Hanya Owner yang dapat mengakses', status: 403 as const, callerId: user.id }
  return { ok: true as const, callerId: user.id }
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

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  if (id === auth.callerId) {
    return NextResponse.json({ error: 'Tidak bisa menghapus akun sendiri' }, { status: 400 })
  }

  const admin = getAdmin()
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY belum di-set' }, { status: 500 })

  // Delete profile first (FK cascade may handle this, but be explicit)
  await admin.from('profiles').delete().eq('id', id)
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Body kosong' }, { status: 400 })

  const admin = getAdmin()
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY belum di-set' }, { status: 500 })

  // Allowed updates: password, full_name, role, active
  if (body.password) {
    if (body.password.length < 8) return NextResponse.json({ error: 'Password minimal 8 karakter' }, { status: 400 })
    const { error } = await admin.auth.admin.updateUserById(id, { password: body.password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const profileUpdate: Record<string, unknown> = {}
  if (body.full_name !== undefined) profileUpdate.full_name = body.full_name
  if (body.role !== undefined) profileUpdate.role = body.role
  if (body.active !== undefined) profileUpdate.active = body.active

  if (Object.keys(profileUpdate).length > 0) {
    const { error } = await admin.from('profiles').update(profileUpdate).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
