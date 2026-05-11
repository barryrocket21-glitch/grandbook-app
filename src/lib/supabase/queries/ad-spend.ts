// =============================================================
// Ad Spend query helpers (Phase 5B)
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdSpend, AdSpendSource, Campaign, AdPlatform } from '@/lib/types'

export type AdSpendWithCampaign = Omit<AdSpend, 'campaign' | 'campaigns'> & {
  campaign?: Pick<Campaign, 'id' | 'campaign_name' | 'platform' | 'campaign_code'> | null
}

export interface AdSpendListArgs {
  from: string
  to: string
  campaignId?: number
  platform?: AdPlatform
  source?: AdSpendSource
}

export async function listAdSpend(
  supabase: SupabaseClient,
  args: AdSpendListArgs
): Promise<AdSpendWithCampaign[]> {
  let q = supabase
    .from('ad_spend')
    .select(`
      *,
      campaign:campaigns!ad_spend_campaign_id_fkey(id, campaign_name, platform, campaign_code)
    `)
    .gte('spend_date', args.from)
    .lte('spend_date', args.to)
    .order('spend_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000)
  if (args.campaignId) q = q.eq('campaign_id', args.campaignId)
  if (args.source) q = q.eq('source', args.source)
  const { data, error } = await q
  if (error) throw new Error(`listAdSpend: ${error.message}`)
  let rows = (data || []) as AdSpendWithCampaign[]
  if (args.platform) rows = rows.filter(r => r.campaign?.platform === args.platform)
  return rows
}

export interface AdSpendPayload {
  spend_date: string
  campaign_id: number
  spend: number
  impressions: number | null
  reach: number | null
  clicks: number | null
  conversions: number | null
  revenue_reported: number | null
  notes: string | null
  source?: AdSpendSource
  import_batch_id?: string | null
}

export async function insertAdSpend(
  supabase: SupabaseClient,
  args: { orgId: number; createdBy: string | null; payload: AdSpendPayload }
): Promise<AdSpend> {
  const { data, error } = await supabase
    .from('ad_spend')
    .insert({
      ...args.payload,
      organization_id: args.orgId,
      created_by: args.createdBy,
      source: args.payload.source ?? 'MANUAL',
    })
    .select('*')
    .single()
  if (error) throw new Error(`insertAdSpend: ${error.message}`)
  return data as AdSpend
}

export async function updateAdSpend(
  supabase: SupabaseClient,
  id: number,
  payload: Partial<AdSpendPayload>
): Promise<AdSpend> {
  const { data, error } = await supabase
    .from('ad_spend')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`updateAdSpend: ${error.message}`)
  return data as AdSpend
}

export async function deleteAdSpend(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await supabase.from('ad_spend').delete().eq('id', id)
  if (error) throw new Error(`deleteAdSpend: ${error.message}`)
}

/**
 * Bulk insert dari CSV import. Returns per-row status (inserted/skipped/error).
 * Pakai upsert dengan onConflict supaya idempotent per (org+date+campaign).
 */
export interface BulkInsertResult {
  inserted: number
  skipped_duplicate: number
  errors: Array<{ row: number; error: string }>
}

export async function bulkInsertAdSpend(
  supabase: SupabaseClient,
  args: {
    orgId: number
    createdBy: string | null
    rows: AdSpendPayload[]
    importBatchId: string
  }
): Promise<BulkInsertResult> {
  const result: BulkInsertResult = { inserted: 0, skipped_duplicate: 0, errors: [] }
  if (args.rows.length === 0) return result

  const payload = args.rows.map(r => ({
    ...r,
    organization_id: args.orgId,
    created_by: args.createdBy,
    source: 'CSV_IMPORT' as const,
    import_batch_id: args.importBatchId,
  }))

  // Try bulk insert with ignoreDuplicates via upsert
  const { data, error } = await supabase
    .from('ad_spend')
    .upsert(payload, {
      onConflict: 'organization_id,spend_date,campaign_id',
      ignoreDuplicates: true,
    })
    .select('id')
  if (error) {
    result.errors.push({ row: -1, error: error.message })
    return result
  }
  const insertedCount = (data || []).length
  result.inserted = insertedCount
  result.skipped_duplicate = args.rows.length - insertedCount
  return result
}

// ----- Summary RPCs -----

export interface AdSpendSummary {
  total_spend: number
  total_campaigns: number
  total_conversions: number
  total_impressions: number
  total_clicks: number
  by_platform: Record<string, number>
}

export async function fetchAdSpendSummary(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<AdSpendSummary> {
  const { data, error } = await supabase.rpc('analytics_ad_spend_summary', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_ad_spend_summary: ${error.message}`)
  if (!data || data.length === 0) {
    return {
      total_spend: 0, total_campaigns: 0, total_conversions: 0,
      total_impressions: 0, total_clicks: 0, by_platform: {},
    }
  }
  return data[0] as AdSpendSummary
}
