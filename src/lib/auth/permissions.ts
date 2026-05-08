import type { UserRole } from '@/lib/types'

/**
 * Phase 2A permission helper.
 * Owner & admin can manage settings (CRUD master data).
 * Other roles: read-only.
 */
export function canManageSettings(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}
