// =============================================================
// Phase 7 v2 — Margin Simulator query helper
// =============================================================
// v2 hanya butuh fetch produk untuk dropdown. Presets / save / load
// pindah ke localStorage (lihat lib/margin-simulator/useLocalState.ts).
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductForSimulator } from '@/lib/types'

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
