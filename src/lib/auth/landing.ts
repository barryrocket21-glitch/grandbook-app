import type { UserRole } from '@/lib/types'

// This chooses an entry page only; server Auth/RLS still controls access.
const LANDING: Record<UserRole, string> = {
  owner: '/dashboard',
  admin: '/orders/draft',
  cs: '/cs/resi',
  advertiser: '/adv-dashboard',
  akunting: '/reconciliation/spx',
}

export function getRoleLanding(role: unknown): string | null {
  return typeof role === 'string' && Object.prototype.hasOwnProperty.call(LANDING, role)
    ? LANDING[role as UserRole]
    : null
}

export function getEntryRedirect(pathname: string, role: unknown): string | null {
  const landing = getRoleLanding(role)
  if (!landing) return null
  if (pathname === '/' || pathname === '/login') return landing
  if (pathname === '/dashboard' && role !== 'owner' && role !== 'admin') return landing
  return null
}
