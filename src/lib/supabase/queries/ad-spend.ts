// =============================================================
// Ad Spend query helpers (Phase 5B)
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdSpend, AdSpendSource, Campaign, AdPlatform } from '@/lib/types'
import { completeReportRead } from '@/lib/analytics/complete-report-read'

export type AdSpendWithCampaign = Omit<AdSpend, 'campaign' | 'campaigns'> & {
  campaign?: Pick<Campaign, 'id' | 'campaign_name' | 'platform' | 'campaign_code'> | null
}

export interface AdSpendListArgs {
  from: string
  to: string
  campaignId?: number
  platform?: AdPlatform
  source?: AdSpendSource
  signal?: AbortSignal
}

export async function listAdSpend(
  supabase: SupabaseClient,
  args: AdSpendListArgs
): Promise<AdSpendWithCampaign[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to) || args.from > args.to) {
    throw new Error('Periode Ad Spend tidak valid')
  }
  // Keyset order is unique; a short server page is not evidence of completion.
  const scoped = (head = false) => {
    let q = supabase.from('ad_spend').select(head ? 'id' : `
      *, campaign:campaigns!ad_spend_campaign_id_fkey(id, campaign_name, platform, campaign_code)
    `, { count: 'exact', head }).gte('spend_date', args.from).lte('spend_date', args.to)
    if (args.campaignId !== undefined) q = q.eq('campaign_id', args.campaignId)
    if (args.source) q = q.eq('source', args.source)
    if (args.signal) q = q.abortSignal(args.signal)
    return q
  }
  const rows = await completeReportRead<AdSpendWithCampaign>(async after => {
    args.signal?.throwIfAborted()
    return await scoped().gt('id', after).order('id', { ascending: true }).limit(500)
      .returns<AdSpendWithCampaign[]>()
  })
  args.signal?.throwIfAborted()
  const end = await scoped(true)
  if (end.error || end.count !== rows.length) throw new Error('Data Ad Spend berubah atau belum terbaca lengkap; muat ulang')
  args.signal?.throwIfAborted()
  // Validate before calculating/displaying totals. Never turn an invalid cost into zero.
  summarizeAdSpend(rows)
  return rows.filter(r => !args.platform || r.campaign?.platform === args.platform)
    .sort((a, b) => b.spend_date.localeCompare(a.spend_date) ||
      (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id)
}

/** Existing KPI basis: stored spend_total (including recorded PPN), fallback spend. */
export function summarizeAdSpend(rows: AdSpendWithCampaign[]) {
  let spend = 0, spendTotal = 0, leads = 0
  const campaigns = new Set<number>()
  const numeric = (value: unknown, required = false) => {
    if ((required && (value == null || value === '')) ||
        (value != null && typeof value !== 'number' && typeof value !== 'string') ||
        !Number.isFinite(Number(value ?? 0))) throw new Error('Nilai Ad Spend tidak valid; muat ulang')
    return Number(value ?? 0)
  }
  for (const row of rows) {
    spend += numeric(row.spend, true)
    spendTotal += numeric(row.spend_total ?? row.spend, true)
    leads += numeric((row as { meta_lead_count?: number | null }).meta_lead_count)
    campaigns.add(row.campaign_id)
  }
  if (![spend, spendTotal, leads].every(Number.isFinite)) throw new Error('Total Ad Spend tidak valid')
  return { spend, spendTotal, leads, campaigns: campaigns.size, cpr: leads > 0 ? spendTotal / leads : 0 }
}

export interface AdSpendPayload {
  spend_date: string
  campaign_id: number
  spend: number
  ppn_rate?: number    // default 12 (Indonesia)
  impressions: number | null
  reach: number | null
  clicks: number | null
  meta_lead_count?: number | null  // Brief #25 — LEADS (sumber CPR = spend ÷ lead)
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
  total_spend: number              // gross (tanpa PPN)
  total_ppn?: number               // PPN amount (mig 073)
  total_spend_with_ppn?: number    // gross + PPN (mig 073) — actual cost
  total_campaigns?: number         // legacy alias, RPC returns campaigns_count
  campaigns_count?: number
  total_conversions: number
  total_impressions: number
  total_clicks: number
  by_platform: Record<string, unknown>
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
      total_spend: 0, total_ppn: 0, total_spend_with_ppn: 0,
      total_campaigns: 0, campaigns_count: 0, total_conversions: 0,
      total_impressions: 0, total_clicks: 0, by_platform: {},
    }
  }
  const row = data[0] as AdSpendSummary
  // Backward-compat alias
  return { ...row, total_campaigns: row.campaigns_count ?? row.total_campaigns ?? 0 }
}
