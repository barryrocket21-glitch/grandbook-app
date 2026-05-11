// =============================================================
// Shipping Diff query helpers (Phase 6.5)
//
// Wrappers untuk 2 RPC dari migration 024:
//   - shipping_diff_per_order: per-order breakdown 3 angka + 2 selisih
//   - shipping_diff_summary: stat cards aggregate
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrderStatus } from '@/lib/types'

export interface ShippingDiffRow {
  order_id: number
  order_number: string
  order_date: string
  status: OrderStatus
  channel_id: number | null
  channel_name: string | null
  courier_id: number | null
  courier_name: string | null
  customer_name: string
  ongkir_customer: number
  ongkir_gross: number
  ongkir_net: number
  cashback_amount: number
  cashback_pct: number
  selisih_gross: number
  selisih_net: number
  margin_pct_gross: number
  margin_pct_net: number
}

export interface ShippingDiffSummary {
  total_orders: number
  total_ongkir_customer: number
  total_ongkir_gross: number
  total_ongkir_net: number
  total_cashback: number
  total_selisih_gross: number
  total_selisih_net: number
  avg_margin_pct_gross: number
  avg_margin_pct_net: number
  orders_with_loss: number
  orders_breakeven: number
  orders_profit: number
}

const EMPTY_SUMMARY: ShippingDiffSummary = {
  total_orders: 0,
  total_ongkir_customer: 0,
  total_ongkir_gross: 0,
  total_ongkir_net: 0,
  total_cashback: 0,
  total_selisih_gross: 0,
  total_selisih_net: 0,
  avg_margin_pct_gross: 0,
  avg_margin_pct_net: 0,
  orders_with_loss: 0,
  orders_breakeven: 0,
  orders_profit: 0,
}

export interface ShippingDiffArgs {
  from: string
  to: string
  channelId?: number | null
  courierId?: number | null
  status?: OrderStatus | 'ALL' | null
}

function rpcParams(args: ShippingDiffArgs): Record<string, unknown> {
  return {
    p_from: args.from,
    p_to: args.to,
    p_channel_id: args.channelId ?? null,
    p_courier_id: args.courierId ?? null,
    p_status: args.status && args.status !== 'ALL' ? args.status : null,
  }
}

export async function fetchShippingDiffRows(
  supabase: SupabaseClient,
  args: ShippingDiffArgs
): Promise<ShippingDiffRow[]> {
  const { data, error } = await supabase.rpc('shipping_diff_per_order', rpcParams(args))
  if (error) throw new Error(`shipping_diff_per_order gagal: ${error.message}`)
  return (data || []) as ShippingDiffRow[]
}

export async function fetchShippingDiffSummary(
  supabase: SupabaseClient,
  args: ShippingDiffArgs
): Promise<ShippingDiffSummary> {
  const { data, error } = await supabase.rpc('shipping_diff_summary', rpcParams(args))
  if (error) throw new Error(`shipping_diff_summary gagal: ${error.message}`)
  if (!data || data.length === 0) return EMPTY_SUMMARY
  return data[0] as ShippingDiffSummary
}
