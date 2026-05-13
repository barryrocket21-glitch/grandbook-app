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

/**
 * Phase 7 permission helper. ADV + Owner can access margin simulator tool.
 */
export function canAccessMarginSimulator(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'advertiser'
}

/**
 * Phase 8 — Team performance dashboards (/team/cs + /team/advertisers).
 * Hanya owner + admin: CS tidak boleh lihat performance CS lain, advertiser
 * juga tidak boleh lihat performance advertiser lain. Sendiri-sendiri pakai
 * /cs-dashboard atau /adv-dashboard masing-masing.
 */
export function canViewTeamPerformance(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}
