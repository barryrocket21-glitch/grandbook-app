import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Generate a unique order_number per organization per day.
 * Format: GB-YYYYMMDD-NNNNNN
 * Backed by SQL function (migration 012).
 */
export async function generateOrderNumber(
  supabase: SupabaseClient,
  orgId: number
): Promise<string> {
  const { data, error } = await supabase.rpc('generate_order_number', { org_id: orgId })
  if (error) throw new Error(`generate_order_number failed: ${error.message}`)
  if (!data) throw new Error('generate_order_number returned null')
  return String(data)
}

/**
 * Update order status with note + source via SQL function (atomic).
 * Returns the inserted history id.
 */
export async function updateOrderStatus(
  supabase: SupabaseClient,
  opts: {
    orderId: number
    newStatus: string
    source?: string
    note?: string | null
  }
): Promise<number> {
  const { data, error } = await supabase.rpc('update_order_status', {
    p_order_id: opts.orderId,
    p_new_status: opts.newStatus,
    p_source: opts.source ?? 'admin_review',
    p_note: opts.note ?? null,
  })
  if (error) throw new Error(`update_order_status failed: ${error.message}`)
  return Number(data)
}
