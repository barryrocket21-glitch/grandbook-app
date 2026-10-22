// Owner/admin report uses one server-side cohort for overview and drilldown.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CsPerformance, AdvertiserPerformance, CsDetailResponse, AdvertiserDetailResponse } from '@/lib/types'
import { wibTimestampBounds } from '@/lib/date/ranges'

export async function fetchCsTeamSummary(supabase: SupabaseClient, from: string, to: string): Promise<CsPerformance[]> {
  wibTimestampBounds(from, to)
  const { data, error } = await supabase.rpc('operations_cs_report', { p_date_from: from, p_date_to: to })
  if (error) throw new Error(error.message)
  return data.summary
}

export async function fetchCsTeamDetail(supabase: SupabaseClient, userId: string, from: string, to: string): Promise<CsDetailResponse> {
  wibTimestampBounds(from, to)
  const { data, error } = await supabase.rpc('operations_cs_report', { p_date_from: from, p_date_to: to, p_user_id: userId })
  if (error) throw new Error(error.message)
  return data
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
