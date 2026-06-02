// =============================================================
// Campaigns + Linked Products query helpers (Phase 5B)
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Campaign, CampaignProduct, AdPlatform, CampaignStatus, Profile, Product } from '@/lib/types'

export type CampaignWithRelations = Omit<Campaign, 'linked_products'> & {
  advertiser?: Profile | null
  linked_products?: CampaignProductWithProduct[]
}

export type CampaignProductWithProduct = Omit<CampaignProduct, 'product'> & {
  product?: Pick<Product, 'id' | 'name' | 'sku' | 'active'> | null
}

export async function listCampaigns(supabase: SupabaseClient): Promise<CampaignWithRelations[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select(`
      *,
      advertiser:profiles!campaigns_advertiser_id_fkey(id, full_name, role),
      linked_products:campaign_products(
        id, campaign_id, product_id, allocation_pct, notes,
        product:products(id, name, sku, active)
      )
    `)
    .order('campaign_name')
  if (error) throw new Error(`listCampaigns: ${error.message}`)
  return (data || []) as CampaignWithRelations[]
}

interface CampaignPayload {
  campaign_name: string
  campaign_code: string | null
  platform: AdPlatform
  advertiser_id: string | null
  status: CampaignStatus
  start_date: string | null
  end_date: string | null
  daily_budget: number | null
  objective: string | null
  notes: string | null
  active: boolean
}

export async function insertCampaign(
  supabase: SupabaseClient,
  orgId: number,
  payload: CampaignPayload
): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ ...payload, organization_id: orgId })
    .select('*')
    .single()
  if (error) throw new Error(`insertCampaign: ${error.message}`)
  return data as Campaign
}

export async function updateCampaign(
  supabase: SupabaseClient,
  id: number,
  payload: Partial<CampaignPayload>
): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`updateCampaign: ${error.message}`)
  return data as Campaign
}

export async function deleteCampaign(supabase: SupabaseClient, id: number): Promise<void> {
  // Brief #21 — guard dependent server-side (order ter-atribusi / ad_spend → blok).
  const { error } = await supabase.rpc('delete_campaign', { p_id: id })
  if (error) throw error
}

// ----- Linked products -----

interface LinkedProductPayload {
  campaign_id: number
  product_id: number
  allocation_pct: number
  notes: string | null
}

export async function insertCampaignProduct(
  supabase: SupabaseClient,
  orgId: number,
  payload: LinkedProductPayload
): Promise<CampaignProduct> {
  const { data, error } = await supabase
    .from('campaign_products')
    .insert({ ...payload, organization_id: orgId })
    .select('*')
    .single()
  if (error) throw new Error(`insertCampaignProduct: ${error.message}`)
  return data as CampaignProduct
}

export async function updateCampaignProduct(
  supabase: SupabaseClient,
  id: number,
  payload: Partial<LinkedProductPayload>
): Promise<CampaignProduct> {
  const { data, error } = await supabase
    .from('campaign_products')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`updateCampaignProduct: ${error.message}`)
  return data as CampaignProduct
}

export async function deleteCampaignProduct(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await supabase.from('campaign_products').delete().eq('id', id)
  if (error) throw new Error(`deleteCampaignProduct: ${error.message}`)
}

/**
 * Sum allocation_pct yang sudah ada untuk satu campaign.
 * Optionally exclude 1 row id (untuk edit case).
 */
export async function getCampaignAllocationTotal(
  supabase: SupabaseClient,
  campaignId: number,
  excludeId?: number
): Promise<number> {
  let q = supabase
    .from('campaign_products')
    .select('allocation_pct')
    .eq('campaign_id', campaignId)
  if (excludeId !== undefined) q = q.neq('id', excludeId)
  const { data, error } = await q
  if (error) throw new Error(`getCampaignAllocationTotal: ${error.message}`)
  return (data || []).reduce((s: number, r: { allocation_pct: number }) => s + Number(r.allocation_pct), 0)
}
