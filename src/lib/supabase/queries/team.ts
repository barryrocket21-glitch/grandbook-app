// =============================================================
// Team Performance query helpers (/team/cs + /team/advertisers)
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CsPerformance,
  AdvertiserPerformance,
  CsDetailResponse,
  AdvertiserDetailResponse,
} from '@/lib/types'

export async function fetchCsTeamSummary(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<CsPerformance[]> {
  const { data, error } = await supabase.rpc('team_cs_summary', {
    p_date_from: from,
    p_date_to: to,
  })
  if (error) throw new Error(`fetchCsTeamSummary: ${error.message}`)
  return (data || []) as CsPerformance[]
}

export async function fetchCsTeamDetail(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<CsDetailResponse> {
  const { data, error } = await supabase.rpc('team_cs_detail', {
    p_user_id: userId,
    p_date_from: from,
    p_date_to: to,
  })
  if (error) throw new Error(`fetchCsTeamDetail: ${error.message}`)
  return (data || { stats: null, daily_trend: [], recent_orders: [], commission_history: [], product_breakdown: [] }) as CsDetailResponse
}

export async function fetchAdvertiserTeamSummary(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<AdvertiserPerformance[]> {
  const { data, error } = await supabase.rpc('team_advertiser_summary', {
    p_date_from: from,
    p_date_to: to,
  })
  if (error) throw new Error(`fetchAdvertiserTeamSummary: ${error.message}`)
  return (data || []) as AdvertiserPerformance[]
}

export async function fetchAdvertiserTeamDetail(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<AdvertiserDetailResponse> {
  const { data, error } = await supabase.rpc('team_advertiser_detail', {
    p_user_id: userId,
    p_date_from: from,
    p_date_to: to,
  })
  if (error) throw new Error(`fetchAdvertiserTeamDetail: ${error.message}`)
  return (data || { stats: null, daily_spend: [], campaigns: [], commission_history: [], product_breakdown: [] }) as AdvertiserDetailResponse
}
