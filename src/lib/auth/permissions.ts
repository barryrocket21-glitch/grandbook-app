import type { UserRole } from '@/lib/types'

/**
 * Phase 2A permission helper.
 * Owner & admin can manage settings (CRUD master data).
 * Other roles: read-only.
 */
export function canManageSettings(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Phase 3A permission helper.
 * Owner & admin can approve/reject orders + skip review by inserting at SIAP_KIRIM directly.
 * Other roles must go through admin review (insert at BARU only).
 */
export function canApproveOrders(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Phase 3A permission helper. Roles allowed to create orders (manual / paste / bulk).
 */
export function canCreateOrders(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'cs'
}
