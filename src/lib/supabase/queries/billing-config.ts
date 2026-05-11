// =============================================================
// Billing config query helpers (Phase 4C)
// Wrapper untuk channel_billing_config table + RPCs.
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BillingModel,
  ChannelBillingConfig,
  CourierChannel,
  CourierChannelRate,
  CodFeeBase,
  CodFeeRounding,
  PpnAppliedTo,
} from '@/lib/types'

/** Bundle config aktif lengkap (numeric rates + categorical config + channel meta) untuk satu channel. */
export interface ChannelCostBundle {
  channel: CourierChannel
  shipping_discount_rate: number
  cod_fee_rate: number
  ppn_rate: number
  cod_fee_base: CodFeeBase
  cod_fee_rounding: CodFeeRounding
  ppn_applied_to: PpnAppliedTo
}

export async function fetchChannelCostBundle(
  supabase: SupabaseClient,
  channelId: number,
  orderDate?: string
): Promise<ChannelCostBundle | null> {
  const date = orderDate || new Date().toISOString().slice(0, 10)
  const [{ data: ch }, sdR, cfR, ppR, cfg] = await Promise.all([
    supabase.from('courier_channels').select('*').eq('id', channelId).single(),
    supabase.rpc('get_active_rate', { p_channel_id: channelId, p_rate_key: 'shipping_discount_rate', p_order_date: date }),
    supabase.rpc('get_active_rate', { p_channel_id: channelId, p_rate_key: 'cod_fee_rate', p_order_date: date }),
    supabase.rpc('get_active_rate', { p_channel_id: channelId, p_rate_key: 'ppn_rate', p_order_date: date }),
    supabase.rpc('get_active_billing_config', { p_channel_id: channelId, p_order_date: date }),
  ])
  if (!ch) return null
  const cfgRow = (cfg.data as Array<{ cod_fee_base: CodFeeBase; cod_fee_rounding: CodFeeRounding; ppn_applied_to: PpnAppliedTo }> | null)?.[0]
  return {
    channel: ch as CourierChannel,
    shipping_discount_rate: Number(sdR.data) || 0,
    cod_fee_rate: Number(cfR.data) || 0,
    ppn_rate: Number(ppR.data) || 0,
    cod_fee_base: cfgRow?.cod_fee_base || 'NOMINAL_COD',
    cod_fee_rounding: cfgRow?.cod_fee_rounding || 'FLOOR',
    ppn_applied_to: cfgRow?.ppn_applied_to || 'COD_FEE_ONLY',
  }
}

export async function listChannelBillingConfigs(
  supabase: SupabaseClient,
  channelId: number
): Promise<ChannelBillingConfig[]> {
  const { data, error } = await supabase
    .from('channel_billing_config')
    .select('*')
    .eq('channel_id', channelId)
    .order('effective_from', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as ChannelBillingConfig[]
}

export async function listChannelRates(
  supabase: SupabaseClient,
  channelId: number,
  rateKeys: string[]
): Promise<CourierChannelRate[]> {
  const { data, error } = await supabase
    .from('courier_channel_rates')
    .select('*')
    .eq('channel_id', channelId)
    .in('rate_key', rateKeys)
    .order('effective_from', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as CourierChannelRate[]
}

export async function updateChannelBillingMeta(
  supabase: SupabaseClient,
  channelId: number,
  args: { billing_model: BillingModel; shipping_discount_label: string }
): Promise<void> {
  const { error } = await supabase
    .from('courier_channels')
    .update({
      billing_model: args.billing_model,
      shipping_discount_label: args.shipping_discount_label,
    })
    .eq('id', channelId)
  if (error) throw new Error(error.message)
}

export interface UpsertBillingConfigArgs {
  channel_id: number
  cod_fee_base: CodFeeBase
  cod_fee_rounding: CodFeeRounding
  ppn_applied_to: PpnAppliedTo
  effective_from: string
  notes?: string | null
}

/** Upsert config period; auto-set effective_to dari row terbaru sebelumnya jadi (effective_from - 1 day). */
export async function upsertBillingConfig(
  supabase: SupabaseClient,
  args: UpsertBillingConfigArgs
): Promise<void> {
  // Auto-close previous active config (effective_to IS NULL) jika new row > nya
  const { data: prevList } = await supabase
    .from('channel_billing_config')
    .select('id, effective_from, effective_to')
    .eq('channel_id', args.channel_id)
    .lt('effective_from', args.effective_from)
    .is('effective_to', null)
    .order('effective_from', { ascending: false })
    .limit(1)

  if (prevList && prevList.length > 0) {
    const prev = prevList[0]
    const newEffTo = subtractOneDay(args.effective_from)
    await supabase
      .from('channel_billing_config')
      .update({ effective_to: newEffTo })
      .eq('id', prev.id)
  }

  const { error } = await supabase
    .from('channel_billing_config')
    .upsert(
      {
        channel_id: args.channel_id,
        cod_fee_base: args.cod_fee_base,
        cod_fee_rounding: args.cod_fee_rounding,
        ppn_applied_to: args.ppn_applied_to,
        effective_from: args.effective_from,
        notes: args.notes ?? null,
      },
      { onConflict: 'channel_id,effective_from' }
    )
  if (error) throw new Error(error.message)
}

function subtractOneDay(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Trigger compute_order_costs untuk satu order via RPC (manual recompute). */
export async function recomputeOrderCosts(
  supabase: SupabaseClient,
  orderId: number
): Promise<void> {
  const { error } = await supabase.rpc('compute_order_costs', { p_order_id: orderId })
  if (error) throw new Error(error.message)
}
