import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminClient, accountRoles, canAssignRole, requireUserManager } from '@/lib/server/admin-users'

const createSchema = z.object({
  email: z.email().max(254), password: z.string().min(8).max(128),
  full_name: z.string().trim().min(1).max(200), role: z.enum(accountRoles),
}).strict()

export async function GET(request: Request) {
  const auth = await requireUserManager(request)
  if (auth.response) return auth.response
  const admin = adminClient()
  if (!admin) return NextResponse.json({ error: 'Layanan akun belum tersedia.' }, { status: 503 })
  const { data: profiles, error } = await auth.sb.from('profiles')
    .select('id, full_name, role, active, organization_id, created_at')
    .eq('organization_id', auth.profile.organization_id).order('created_at')
  if (error) return NextResponse.json({ error: 'Daftar user belum dapat dimuat.' }, { status: 503 })
  // Fetch only users selected through the caller's organization, never the global Auth directory.
  const users = []
  for (const profile of profiles ?? []) {
    const { data, error: authError } = await admin.auth.admin.getUserById(profile.id)
    if (authError) return NextResponse.json({ error: 'Email user belum dapat dimuat.' }, { status: 503 })
    users.push({ ...profile, email: data.user.email ?? '' })
  }
  return NextResponse.json({ users })
}

export async function POST(request: Request) {
  const auth = await requireUserManager(request, true)
  if (auth.response) return auth.response
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Nama, email, password minimal 8 karakter, dan role wajib valid.' }, { status: 400 })
  const body = parsed.data
  if (!canAssignRole(auth.profile.role, body.role)) return NextResponse.json({ error: 'Admin hanya dapat membuat CS, Advertiser, dan Akunting.' }, { status: 403 })
  const admin = adminClient()
  if (!admin) return NextResponse.json({ error: 'Layanan akun belum tersedia.' }, { status: 503 })
  // New accounts cannot sign in while their organization/profile is being provisioned.
  const { data: created, error } = await admin.auth.admin.createUser({
    email: body.email, password: body.password, email_confirm: true, ban_duration: '876000h',
  })
  if (error || !created.user) return NextResponse.json({ error: error?.message ?? 'Gagal membuat akun.' }, { status: 400 })
  const id = created.user.id
  const latest = await requireUserManager(request, true)
  if (latest.response || latest.profile.organization_id !== auth.profile.organization_id || !canAssignRole(latest.profile.role, body.role)) {
    await admin.auth.admin.deleteUser(id)
    return NextResponse.json({ error: 'Hak akses berubah. Muat ulang sebelum mencoba lagi.' }, { status: 403 })
  }
  const { error: profileError } = await admin.from('profiles').upsert({
    id, full_name: body.full_name, role: body.role, active: true, organization_id: auth.profile.organization_id,
  }, { onConflict: 'id' })
  if (profileError) {
    await admin.auth.admin.deleteUser(id)
    return NextResponse.json({ error: 'Gagal menyiapkan profil; akun belum diaktifkan.' }, { status: 400 })
  }
  const { error: activationError } = await admin.auth.admin.updateUserById(id, { ban_duration: 'none' })
  if (activationError) {
    await admin.auth.admin.deleteUser(id)
    return NextResponse.json({ error: 'Gagal mengaktifkan akun baru.' }, { status: 503 })
  }
  return NextResponse.json({ id, email: created.user.email })
}
