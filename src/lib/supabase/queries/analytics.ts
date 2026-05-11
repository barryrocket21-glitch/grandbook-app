// =============================================================
// Analytics RPC wrappers (Phase 4B)
// Server-side aggregation via SQL RPCs untuk dashboard pages.
// Semua function STABLE + scoped ke current_org_id().
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AnalyticsOverview {
  total_orders: number
  total_revenue: number
  total_cogs: number
  total_shipping_charged: number
  total_shipping_actual: number
  total_payout: number
  total_commissions_estimated: number
  total_commissions_earned: number
  total_commissions_paid: number
  // Phase 4C
  estimated_total_cost: number
  estimated_cash_in: number
  estimated_profit: number
  profit_margin_pct: number
  // Phase 5A
  total_operational_expenses: number
  // Phase 5B (analytics_overview_v3)
  total_ad_spend: number
  net_profit_before_ads: number
  net_profit_after_ads: number
  net_margin_pct: number
  orders_baru: number
  orders_siap_kirim: number
  orders_dikirim: number
  orders_diterima: number
  orders_problem: number
  orders_retur: number
  orders_cancel: number
  orders_fake: number
}

export interface DailyRevenuePoint {
  day: string // YYYY-MM-DD
  total_orders: number
  revenue: number
  diterima_orders: number
  retur_orders: number
}

export interface PerCsRow {
  cs_id: string
  cs_name: string | null
  total_orders: number
  total_revenue: number
  diterima_orders: number
  retur_orders: number
  conversion_rate: number
  total_commission_earned: number
  total_commission_paid: number
}

export interface PerAdvertiserRow {
  advertiser_id: string
  advertiser_name: string | null
  total_orders: number
  total_revenue: number
  diterima_orders: number
  retur_orders: number
  conversion_rate: number
  total_commission_earned: number
  total_commission_paid: number
}

export interface PerChannelRow {
  channel_id: number
  channel_code: string | null
  channel_name: string | null
  billing_model: string | null
  total_orders: number
  total_revenue: number
  total_shipping_charged: number
  total_shipping_actual: number
  shipping_diff: number
  diterima_orders: number
  retur_orders: number
  total_payout: number
  // Phase 4C
  estimated_total_cost: number
  estimated_cash_in: number
  estimated_profit: number
  profit_margin_pct: number
}

const EMPTY_OVERVIEW: AnalyticsOverview = {
  total_orders: 0,
  total_revenue: 0,
  total_cogs: 0,
  total_shipping_charged: 0,
  total_shipping_actual: 0,
  total_payout: 0,
  total_commissions_estimated: 0,
  total_commissions_earned: 0,
  total_commissions_paid: 0,
  estimated_total_cost: 0,
  estimated_cash_in: 0,
  estimated_profit: 0,
  profit_margin_pct: 0,
  total_operational_expenses: 0,
  total_ad_spend: 0,
  net_profit_before_ads: 0,
  net_profit_after_ads: 0,
  net_margin_pct: 0,
  orders_baru: 0,
  orders_siap_kirim: 0,
  orders_dikirim: 0,
  orders_diterima: 0,
  orders_problem: 0,
  orders_retur: 0,
  orders_cancel: 0,
  orders_fake: 0,
}

/**
 * Phase 5B: fetchOverview now calls analytics_overview_v3 which includes
 * total_ad_spend + net_profit_before_ads + net_profit_after_ads + net_margin_pct.
 * v1/v2 still callable directly via Supabase RPC.
 */
export async function fetchOverview(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<AnalyticsOverview> {
  const { data, error } = await supabase.rpc('analytics_overview_v3', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_overview_v3 gagal: ${error.message}`)
  if (!data || data.length === 0) return EMPTY_OVERVIEW
  return data[0] as AnalyticsOverview
}

// Phase 5A — Per Produk (extended Phase 5B dengan ad spend allocation)
export interface PerProductRow {
  product_id: number
  product_name: string | null
  product_sku: string | null
  category_name: string | null
  total_qty: number
  total_orders: number
  total_revenue: number
  total_hpp: number
  gross_profit: number
  margin_pct: number
  // Phase 5B
  allocated_ad_spend: number
  net_profit_after_ads: number
  net_margin_pct: number
  diterima_orders: number
  final_orders: number
  conversion_rate: number
  roas: number
}

/**
 * Phase 5B: switched ke analytics_profit_per_product_v2 yang include
 * allocated_ad_spend + net_profit_after_ads + roas. Sort default by
 * net_profit_after_ads DESC.
 */
export async function fetchPerProduct(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<PerProductRow[]> {
  const { data, error } = await supabase.rpc('analytics_profit_per_product_v2', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_profit_per_product_v2 gagal: ${error.message}`)
  return (data || []) as PerProductRow[]
}

// Phase 5B — ROAS per Campaign
export interface RoasPerCampaignRow {
  campaign_id: number
  campaign_name: string
  platform: string
  advertiser_id: string | null
  advertiser_name: string | null
  campaign_status: string
  total_spend: number
  total_conversions: number
  total_impressions: number
  total_clicks: number
  linked_products: string
  linked_orders_count: number
  linked_revenue: number
  linked_revenue_diterima: number
  roas_gross: number
  roas_diterima: number
  cost_per_conversion: number
  cost_per_order: number
}

export async function fetchRoasPerCampaign(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<RoasPerCampaignRow[]> {
  const { data, error } = await supabase.rpc('analytics_roas_per_campaign', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_roas_per_campaign gagal: ${error.message}`)
  return (data || []) as RoasPerCampaignRow[]
}

// Phase 6 — Funnel & Cross-Check per Product
export interface FunnelPerProductRow {
  product_id: number
  product_name: string | null
  product_sku: string | null
  category_name: string | null
  // Layer 1: META
  total_spend: number
  meta_lead_count: number
  meta_purchases: number
  // Layer 2: CS
  cs_lead_count: number
  cs_closing_count: number
  // Layer 3: System
  system_orders_count: number
  system_orders_diterima: number
  system_revenue: number
  // Variances
  variance_lead_meta_cs: number       // cs_lead - meta_lead (positive = banyak organic)
  variance_closing_cs_system: number  // system_orders - cs_closing (positive = CS lupa input)
  // Funnel metrics
  cpl_meta: number
  cpl_cs_real: number
  cpo: number
  close_rate_cs: number
  close_rate_meta: number
  roas_system: number
  // Source presence flags
  has_meta_data: boolean
  has_cs_data: boolean
  has_system_data: boolean
}

export async function fetchFunnelPerProduct(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<FunnelPerProductRow[]> {
  const { data, error } = await supabase.rpc('analytics_funnel_per_product', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_funnel_per_product gagal: ${error.message}`)
  return (data || []) as FunnelPerProductRow[]
}

// Phase 6 redesign — Detail page per produk: CS performance breakdown
export interface CsPerformanceRow {
  cs_id: string
  cs_name: string | null
  lead_count: number
  closing_count: number
  close_rate: number
}

export async function fetchCsPerformancePerProduct(
  supabase: SupabaseClient,
  args: { productId: number; from: string; to: string }
): Promise<CsPerformanceRow[]> {
  const { data, error } = await supabase.rpc('analytics_cs_performance_per_product', {
    p_product_id: args.productId,
    p_from: args.from,
    p_to: args.to,
  })
  if (error) throw new Error(`analytics_cs_performance_per_product gagal: ${error.message}`)
  return (data || []) as CsPerformanceRow[]
}

// Phase 6 redesign — Detail page per produk: campaign-level breakdown
export interface CampaignsForProductRow {
  campaign_id: number
  campaign_name: string
  platform: string
  campaign_status: string
  allocation_pct: number
  total_spend: number
  total_conversions: number
  total_impressions: number
  total_clicks: number
  meta_lead_count: number
  roas: number
}

export async function fetchCampaignsForProduct(
  supabase: SupabaseClient,
  args: { productId: number; from: string; to: string }
): Promise<CampaignsForProductRow[]> {
  const { data, error } = await supabase.rpc('analytics_campaigns_per_product', {
    p_product_id: args.productId,
    p_from: args.from,
    p_to: args.to,
  })
  if (error) throw new Error(`analytics_campaigns_per_product gagal: ${error.message}`)
  return (data || []) as CampaignsForProductRow[]
}

export async function fetchDailyRevenue(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<DailyRevenuePoint[]> {
  const { data, error } = await supabase.rpc('analytics_daily_revenue', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_daily_revenue gagal: ${error.message}`)
  return (data || []) as DailyRevenuePoint[]
}

export async function fetchPerCs(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<PerCsRow[]> {
  const { data, error } = await supabase.rpc('analytics_per_cs', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_per_cs gagal: ${error.message}`)
  return (data || []) as PerCsRow[]
}

export async function fetchPerAdvertiser(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<PerAdvertiserRow[]> {
  const { data, error } = await supabase.rpc('analytics_per_advertiser', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_per_advertiser gagal: ${error.message}`)
  return (data || []) as PerAdvertiserRow[]
}

export async function fetchPerChannel(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<PerChannelRow[]> {
  const { data, error } = await supabase.rpc('analytics_per_channel', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_per_channel gagal: ${error.message}`)
  return (data || []) as PerChannelRow[]
}

// =============================================================
// Personal-dashboard helpers (CS / advertiser scoped)
// Pattern: filter orders by user_id (cs_id atau advertiser_id) + date range,
// embed commissions yang related. Tidak pakai RPC — query langsung supaya
// dapat detail row-level (10 order terbaru) di same fetch.
// =============================================================

export interface PersonalDashboardData {
  totals: {
    total_orders: number
    total_revenue: number
    diterima: number
    retur: number
    conversion_rate: number
    commission_earned: number
    commission_paid: number
  }
  dailySeries: DailyRevenuePoint[]
  recentOrders: Array<{
    id: number
    order_number: string
    order_date: string
    customer_name: string
    status: string
    total: number
    commission_amount: number | null
    commission_status: string | null
  }>
}

export async function fetchPersonalDashboard(
  supabase: SupabaseClient,
  args: {
    role: 'cs' | 'advertiser'
    userId: string
    from: string
    to: string
  }
): Promise<PersonalDashboardData> {
  const ownerCol = args.role === 'cs' ? 'cs_id' : 'advertiser_id'

  // 1. Aggregate orders di range
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, order_date, customer_name, status, total')
    .eq(ownerCol, args.userId)
    .gte('order_date', args.from)
    .lte('order_date', args.to)
    .order('order_date', { ascending: false })
    .limit(1000)
  if (ordersErr) throw new Error(`fetchPersonalDashboard orders: ${ordersErr.message}`)
  const orderRows = orders || []

  // 2. Commissions yang related ke user (role-scoped)
  const orderIds = orderRows.map((o) => o.id)
  let commissionMap = new Map<number, { amount: number; status: string }>()
  if (orderIds.length > 0) {
    const { data: comms, error: commsErr } = await supabase
      .from('commissions')
      .select('order_id, amount, status')
      .eq('user_id', args.userId)
      .eq('role', args.role)
      .in('order_id', orderIds)
    if (commsErr) throw new Error(`fetchPersonalDashboard commissions: ${commsErr.message}`)
    commissionMap = new Map(
      (comms || []).map((c) => [c.order_id, { amount: Number(c.amount) || 0, status: c.status }])
    )
  }

  // 3. Compute totals
  let total_revenue = 0
  let diterima = 0
  let retur = 0
  let commission_earned = 0
  let commission_paid = 0
  for (const o of orderRows) {
    total_revenue += Number(o.total) || 0
    if (o.status === 'DITERIMA') diterima++
    if (o.status === 'RETUR') retur++
  }
  for (const c of commissionMap.values()) {
    if (c.status === 'EARNED') commission_earned += c.amount
    if (c.status === 'PAID') commission_paid += c.amount
  }
  const final_count = diterima + retur
  const conversion_rate = final_count > 0 ? Math.round((diterima * 10000) / final_count) / 100 : 0

  // 4. Daily series — group by order_date
  const dailyMap = new Map<string, DailyRevenuePoint>()
  for (const o of orderRows) {
    const day = o.order_date
    let p = dailyMap.get(day)
    if (!p) {
      p = { day, total_orders: 0, revenue: 0, diterima_orders: 0, retur_orders: 0 }
      dailyMap.set(day, p)
    }
    p.total_orders++
    p.revenue += Number(o.total) || 0
    if (o.status === 'DITERIMA') p.diterima_orders++
    if (o.status === 'RETUR') p.retur_orders++
  }
  const dailySeries = Array.from(dailyMap.values()).sort((a, b) => a.day.localeCompare(b.day))

  // 5. Recent orders (top 10) with commission info
  const recentOrders = orderRows.slice(0, 10).map((o) => {
    const c = commissionMap.get(o.id)
    return {
      id: o.id,
      order_number: o.order_number,
      order_date: o.order_date,
      customer_name: o.customer_name,
      status: o.status,
      total: Number(o.total) || 0,
      commission_amount: c ? c.amount : null,
      commission_status: c ? c.status : null,
    }
  })

  return {
    totals: {
      total_orders: orderRows.length,
      total_revenue,
      diterima,
      retur,
      conversion_rate,
      commission_earned,
      commission_paid,
    },
    dailySeries,
    recentOrders,
  }
}
