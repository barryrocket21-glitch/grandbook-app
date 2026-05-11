// =============================================================
// Commissions query helpers (Phase 4A)
// Client-side query helpers untuk halaman /commissions/my dan
// /commissions/manage. RLS handle org isolation + per-user filter.
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommissionV2Status,
  UserRole,
  OrderStatus,
} from '@/lib/types'

export interface CommissionRow {
  id: number
  order_id: number
  user_id: string
  role: UserRole
  amount: number
  status: CommissionV2Status
  paid_at: string | null
  paid_by: string | null
  payment_method: string | null
  payment_reference: string | null
  payment_note: string | null
  created_at: string
  user?: { id: string; full_name: string; role: UserRole }
  paid_by_user?: { id: string; full_name: string }
  order?: {
    id: number
    order_number: string
    status: OrderStatus
    customer_name: string
    total: number
    order_date: string
  }
}

export interface CommissionFilter {
  /** When provided, filter to specific user (only for /my and /manage when filtering one user). */
  userId?: string | null
  /** When provided, only commissions in these statuses are returned. */
  statuses?: CommissionV2Status[]
  /** Inclusive lower bound on order_date (YYYY-MM-DD). */
  dateFrom?: string | null
  /** Inclusive upper bound on order_date (YYYY-MM-DD). */
  dateTo?: string | null
  /** Free-text search across order_number / customer_name. */
  search?: string | null
  /** Cap on rows returned (default 500 to keep client memory bounded). */
  limit?: number
}

// `!inner` on the order embed makes order_date filters affect parent rows
// (PostgREST defaults to LEFT JOIN otherwise). Safe because order_id NOT NULL.
const SELECT_COLUMNS =
  'id, order_id, user_id, role, amount, status, paid_at, paid_by, payment_method, payment_reference, payment_note, created_at, ' +
  'user:profiles!commissions_user_id_fkey1(id, full_name, role), ' +
  'paid_by_user:profiles!commissions_paid_by_fkey(id, full_name), ' +
  'order:orders!commissions_order_id_fkey!inner(id, order_number, status, customer_name, total, order_date)'

/**
 * Build a base query for commissions with the standard SELECT shape and
 * apply common filters. Intentionally not awaited so caller can chain
 * additional filters before awaiting.
 */
function buildBaseQuery(supabase: SupabaseClient, filter: CommissionFilter) {
  let q = supabase
    .from('commissions')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 500)
  if (filter.userId) q = q.eq('user_id', filter.userId)
  if (filter.statuses && filter.statuses.length > 0) q = q.in('status', filter.statuses)
  // order_date filter via embedded relation: PostgREST supports `order.order_date` filter
  if (filter.dateFrom) q = q.gte('order.order_date', filter.dateFrom)
  if (filter.dateTo) q = q.lte('order.order_date', filter.dateTo)
  return q
}

/**
 * Get commissions filtered to current authenticated user (for /commissions/my).
 * RLS scoping is handled by Supabase, but we also pass userId explicitly so the
 * caller can pre-filter (e.g. owner viewing another user's commissions).
 */
export async function listCommissions(
  supabase: SupabaseClient,
  filter: CommissionFilter
): Promise<CommissionRow[]> {
  const { data, error } = await buildBaseQuery(supabase, filter)
  if (error) throw new Error(`Gagal load commissions: ${error.message}`)
  let rows = (data || []) as unknown as CommissionRow[]
  // Apply free-text search client-side because Postgres can't filter
  // across embedded relation columns with `ilike` chained after `in()`.
  if (filter.search && filter.search.trim()) {
    const q = filter.search.toLowerCase().trim()
    rows = rows.filter((r) => {
      const orderNum = r.order?.order_number?.toLowerCase() || ''
      const cust = r.order?.customer_name?.toLowerCase() || ''
      return orderNum.includes(q) || cust.includes(q)
    })
  }
  return rows
}

export interface CommissionStats {
  estimatedTotal: number
  estimatedCount: number
  earnedTotal: number
  earnedCount: number
  paidTotal: number
  paidCount: number
  cancelledCount: number
}

export function computeStats(rows: CommissionRow[]): CommissionStats {
  const stats: CommissionStats = {
    estimatedTotal: 0,
    estimatedCount: 0,
    earnedTotal: 0,
    earnedCount: 0,
    paidTotal: 0,
    paidCount: 0,
    cancelledCount: 0,
  }
  for (const r of rows) {
    const amt = Number(r.amount) || 0
    switch (r.status) {
      case 'ESTIMATED':
        stats.estimatedTotal += amt
        stats.estimatedCount++
        break
      case 'EARNED':
        stats.earnedTotal += amt
        stats.earnedCount++
        break
      case 'PAID':
        stats.paidTotal += amt
        stats.paidCount++
        break
      case 'CANCELLED':
        stats.cancelledCount++
        break
    }
  }
  return stats
}

export interface PaymentArgs {
  paymentMethod: string
  paymentReference?: string | null
  paymentNote?: string | null
}

export async function markCommissionPaid(
  supabase: SupabaseClient,
  commissionId: number,
  args: PaymentArgs
): Promise<void> {
  const { error } = await supabase.rpc('mark_commission_paid', {
    p_commission_id: commissionId,
    p_payment_method: args.paymentMethod,
    p_payment_reference: args.paymentReference ?? null,
    p_payment_note: args.paymentNote ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function bulkMarkCommissionPaid(
  supabase: SupabaseClient,
  commissionIds: number[],
  args: PaymentArgs
): Promise<number> {
  if (commissionIds.length === 0) return 0
  const { data, error } = await supabase.rpc('bulk_mark_commission_paid', {
    p_commission_ids: commissionIds,
    p_payment_method: args.paymentMethod,
    p_payment_reference: args.paymentReference ?? null,
    p_payment_note: args.paymentNote ?? null,
  })
  if (error) throw new Error(error.message)
  return typeof data === 'number' ? data : 0
}

/**
 * Period preset → [from, to] dates (YYYY-MM-DD). Returns nulls for "all time".
 */
export function periodToDates(
  period: 'this_month' | 'last_month' | 'all' | 'custom',
  customFrom?: string | null,
  customTo?: string | null
): { dateFrom: string | null; dateTo: string | null } {
  if (period === 'custom') return { dateFrom: customFrom || null, dateTo: customTo || null }
  if (period === 'all') return { dateFrom: null, dateTo: null }
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() // 0-indexed
  if (period === 'this_month') {
    const from = new Date(Date.UTC(year, month, 1))
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: null }
  }
  if (period === 'last_month') {
    const from = new Date(Date.UTC(year, month - 1, 1))
    const to = new Date(Date.UTC(year, month, 0)) // last day of previous month
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
    }
  }
  return { dateFrom: null, dateTo: null }
}
