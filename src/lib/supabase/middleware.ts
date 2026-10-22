import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { clearLegacyOwnerCookies, LEGACY_OWNER_COOKIES } from '@/lib/server/fallback-owner'
import { getEntryRedirect } from '@/lib/auth/landing'
import { environmentError, isBlockedWrite } from '@/lib/environment-safety'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const finish = (result: NextResponse) => {
    if (result !== response) {
      for (const cookie of response.cookies.getAll()) result.cookies.set(cookie)
    }
    if (LEGACY_OWNER_COOKIES.some(name => request.cookies.has(name))) clearLegacyOwnerCookies(result)
    return result
  }
  const pathname = request.nextUrl.pathname
  if (pathname === '/emergency-owner') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return clearLegacyOwnerCookies(NextResponse.redirect(url))
  }
  // These handlers must also work when the only remaining cookie is obsolete.
  // Each handler owns cleanup; duplicate middleware/handler Set-Cookie headers
  // can be merged into empty session cookies by the framework.
  if (pathname === '/api/auth/fallback-owner' || pathname === '/api/auth/logout') return response
  const configError = environmentError(process.env)
  if (configError) return finish(NextResponse.json({ error: configError }, { status: 503 }))
  if (isBlockedWrite(request.method, pathname, process.env)) {
    return finish(NextResponse.json({ error: 'Lingkungan ini hanya untuk baca.' }, { status: 423 }))
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey || supabaseUrl.includes('placeholder')) {
    return finish(NextResponse.json({ error: 'Konfigurasi login belum tersedia.' }, { status: 503 }))
  }
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  const { data: { user } } = await supabase.auth.getUser()
  const publicPage = pathname === '/login' || pathname.startsWith('/auth/')
  if (!user) {
    if (publicPage) return finish(response)
    if (pathname.startsWith('/api/')) return finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return finish(NextResponse.redirect(url))
  }
  const { data: profile, error } = await supabase.from('profiles')
    .select('active, organization_id, role').eq('id', user.id).single()
  const active = !error && profile?.active && profile.organization_id
    && ['owner', 'admin', 'cs', 'advertiser', 'akunting'].includes(profile.role)
  if (!active && !publicPage) {
    return finish(NextResponse.json({ error: 'Profil akun tidak aktif atau belum dapat diverifikasi.' }, { status: error ? 503 : 403 }))
  }
  const landing = active ? getEntryRedirect(pathname, profile.role) : null
  if (landing) {
    const url = request.nextUrl.clone()
    url.pathname = landing
    url.search = ''
    return finish(NextResponse.redirect(url))
  }
  return finish(response)
}
