import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { environmentError, isReadOnlyEnvironment } from '@/lib/environment-safety'
import { isAllowedRequestOrigin } from './request-origin'

export async function requireOperationsUser(request: Request, write = false) {
  const configError = environmentError(process.env)
  if (configError) return { response: NextResponse.json({ error: configError }, { status: 503 }) }
  if (write && isReadOnlyEnvironment(process.env)) {
    return { response: NextResponse.json({ error: 'Lingkungan ini hanya untuk baca.' }, { status: 423 }) }
  }
  if (!isAllowedRequestOrigin(request)) {
    return { response: NextResponse.json({ error: 'Origin tidak diizinkan.' }, { status: 403 }) }
  }
  const sb = await createClient()
  const { data: { user }, error } = await sb.auth.getUser()
  if (error || !user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile, error: profileError } = await sb.from('profiles')
    .select('role, active, organization_id').eq('id', user.id).single()
  if (profileError) return { response: NextResponse.json({ error: 'Profil belum dapat diverifikasi.' }, { status: 503 }) }
  if (!profile?.active || !profile.organization_id || !['owner', 'admin', 'cs'].includes(profile.role)) {
    return { response: NextResponse.json({ error: 'Akses operasional tidak diizinkan.' }, { status: 403 }) }
  }
  return { sb, user, profile }
}
