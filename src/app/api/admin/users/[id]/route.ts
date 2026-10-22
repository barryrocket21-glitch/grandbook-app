import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminClient, accountRoles, requireUserManager } from '@/lib/server/admin-users'

const patchSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(accountRoles).optional(), active: z.boolean().optional(),
  email: z.email().max(254).optional(), password: z.string().min(8).max(128).optional(),
}).strict().refine(value => Object.keys(value).length > 0)

export async function DELETE(request: Request) {
  const auth = await requireUserManager(request, true)
  if (auth.response) return auth.response
  return NextResponse.json({ error: 'Penghapusan permanen akun dinonaktifkan. Gunakan Nonaktifkan untuk mempertahankan riwayat transaksi.' }, { status: 405 })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserManager(request, true)
  if (auth.response) return auth.response
  const { id } = await params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: 'Perubahan user tidak valid.' }, { status: 400 })
  const { data: target, error } = await auth.sb.from('profiles').select('id, role')
    .eq('id', id).eq('organization_id', auth.profile.organization_id).maybeSingle()
  if (error) return NextResponse.json({ error: 'User belum dapat diverifikasi.' }, { status: 503 })
  if (!target) return NextResponse.json({ error: 'User tidak ditemukan.' }, { status: 404 })
  const { email, password, ...profile } = parsed.data
  if (email !== undefined || password !== undefined) {
    if (auth.profile.role !== 'owner') return NextResponse.json({ error: 'Perubahan email/password dilakukan oleh Owner.' }, { status: 403 })
    if (Object.keys(profile).length) return NextResponse.json({ error: 'Simpan perubahan profil dan email/password secara terpisah.' }, { status: 400 })
    const admin = adminClient()
    if (!admin) return NextResponse.json({ error: 'Layanan akun belum tersedia.' }, { status: 503 })
    const { error: updateError } = await admin.auth.admin.updateUserById(id, { ...(email !== undefined ? { email } : {}), ...(password !== undefined ? { password } : {}) })
    return updateError ? NextResponse.json({ error: updateError.message }, { status: 400 }) : NextResponse.json({ ok: true })
  }
  // Database rechecks the actor and target under an organization lock, preventing role races.
  const { error: updateError } = await auth.sb.rpc('manage_org_profile', { p_target: id, p_patch: profile })
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: updateError.code === '42501' ? 403 : updateError.code === 'P0002' ? 404 : 400 })
  return NextResponse.json({ ok: true })
}
