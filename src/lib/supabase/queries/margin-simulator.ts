// =============================================================
// Phase 7 — Margin Simulator query helpers
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  MarginSimulatorPreset,
  ProductForSimulator,
  SimulatorInput,
} from '@/lib/types'

export async function fetchProductsForSimulator(
  supabase: SupabaseClient,
  orgId: number
): Promise<ProductForSimulator[]> {
  const { data, error } = await supabase.rpc('get_products_for_simulator', {
    p_org_id: orgId,
  })
  if (error) throw new Error(`fetchProductsForSimulator: ${error.message}`)
  return (data || []) as ProductForSimulator[]
}

export async function fetchPresetsByProduct(
  supabase: SupabaseClient,
  productId: number
): Promise<MarginSimulatorPreset[]> {
  const { data, error } = await supabase.rpc('get_presets_by_product', {
    p_product_id: productId,
  })
  if (error) throw new Error(`fetchPresetsByProduct: ${error.message}`)
  return (data || []) as MarginSimulatorPreset[]
}

export async function fetchAllPresets(
  supabase: SupabaseClient
): Promise<MarginSimulatorPreset[]> {
  const { data, error } = await supabase
    .from('margin_simulator_presets')
    .select('*')
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`fetchAllPresets: ${error.message}`)
  return (data || []) as MarginSimulatorPreset[]
}

export interface SavePresetArgs {
  id?: number | null
  organization_id: number
  product_id: number
  scenario_name: string
  inputs: Omit<SimulatorInput, 'product_id'>
  is_default: boolean
  notes: string | null
  created_by: string | null
}

export async function savePreset(
  supabase: SupabaseClient,
  args: SavePresetArgs
): Promise<MarginSimulatorPreset> {
  const payload = {
    organization_id: args.organization_id,
    product_id: args.product_id,
    scenario_name: args.scenario_name,
    margin_item: args.inputs.margin_item,
    cpr_max: args.inputs.cpr_max,
    lead_dashboard: args.inputs.lead_dashboard,
    jenis_iklan: args.inputs.jenis_iklan,
    multiplier: args.inputs.multiplier,
    closing_rate: args.inputs.closing_rate,
    rts_rate: args.inputs.rts_rate,
    ppn_rate: args.inputs.ppn_rate,
    is_default: args.is_default,
    notes: args.notes,
    created_by: args.created_by,
  }

  // If marking as default, clear any existing default for (org, product) first
  // (unique partial index would otherwise reject the insert/update).
  if (args.is_default) {
    const { error: clearError } = await supabase
      .from('margin_simulator_presets')
      .update({ is_default: false })
      .eq('organization_id', args.organization_id)
      .eq('product_id', args.product_id)
      .eq('is_default', true)
      .neq('id', args.id ?? -1)
    if (clearError) throw new Error(`savePreset (clear default): ${clearError.message}`)
  }

  if (args.id) {
    const { data, error } = await supabase
      .from('margin_simulator_presets')
      .update(payload)
      .eq('id', args.id)
      .select('*')
      .single()
    if (error) throw new Error(`savePreset (update): ${error.message}`)
    return data as MarginSimulatorPreset
  }
  const { data, error } = await supabase
    .from('margin_simulator_presets')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw new Error(`savePreset (insert): ${error.message}`)
  return data as MarginSimulatorPreset
}

export async function deletePreset(
  supabase: SupabaseClient,
  presetId: number
): Promise<void> {
  const { error } = await supabase
    .from('margin_simulator_presets')
    .delete()
    .eq('id', presetId)
  if (error) throw new Error(`deletePreset: ${error.message}`)
}

export async function setPresetDefault(
  supabase: SupabaseClient,
  args: { presetId: number; organizationId: number; productId: number }
): Promise<void> {
  // Clear any other default first to avoid unique constraint violation.
  const { error: clearError } = await supabase
    .from('margin_simulator_presets')
    .update({ is_default: false })
    .eq('organization_id', args.organizationId)
    .eq('product_id', args.productId)
    .eq('is_default', true)
    .neq('id', args.presetId)
  if (clearError) throw new Error(`setPresetDefault (clear): ${clearError.message}`)

  const { error } = await supabase
    .from('margin_simulator_presets')
    .update({ is_default: true })
    .eq('id', args.presetId)
  if (error) throw new Error(`setPresetDefault: ${error.message}`)
}
