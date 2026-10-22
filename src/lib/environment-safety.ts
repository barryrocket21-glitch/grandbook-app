const PRODUCTION_REF = 'ubksitifaprqofujhova'

type Environment = {
  [key: string]: string | undefined
  VERCEL_ENV?: string
  GRANDBOOK_ENV?: string
  GRANDBOOK_STAGING_READONLY?: string
  NEXT_PUBLIC_GRANDBOOK_STAGING_READONLY?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
}

export function environmentError(env: Environment): string | null {
  const isolated = env.VERCEL_ENV === 'preview' || env.GRANDBOOK_ENV === 'staging'
  if (!isolated) return null
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '')
    if (url.hostname === `${PRODUCTION_REF}.supabase.co`) {
      return 'Staging harus menggunakan database terpisah dari produksi.'
    }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid URL')
  } catch {
    return 'Konfigurasi database staging belum lengkap.'
  }
  return null
}

export function isReadOnlyEnvironment(env: Environment): boolean {
  return env.GRANDBOOK_STAGING_READONLY === '1' || env.NEXT_PUBLIC_GRANDBOOK_STAGING_READONLY === '1'
}

const READ_POST_ROUTES = new Set([
  '/api/orders/wa-paste/existing-phones',
  '/api/orders/address-review/autocomplete',
  '/api/orders/address-review/suggestions',
  '/api/orders/address-review/queue',
  '/api/reconciliation/spx-status/debug-read',
])

export function isBlockedWrite(method: string, pathname: string, env: Environment): boolean {
  if (!isReadOnlyEnvironment(env) || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return false
  if (pathname === '/api/auth/logout') return false
  return !(method === 'POST' && READ_POST_ROUTES.has(pathname))
}
