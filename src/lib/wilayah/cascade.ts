import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cascade dropdown helpers for master_wilayah (~82k rows).
 *
 * Phase 3A fix: previously fetchAll'd rows client-side and dedup'd with Set,
 * but Supabase REST clamps to db_max_rows=1000 per request — so .range(0, 1999)
 * returned 1000 rows then exited the loop early. Now we call SQL functions
 * (migration 013) that DISTINCT server-side. Faster + correct.
 */

export interface WilayahMatch {
  id: number
  province: string
  city: string
  subdistrict: string
  village: string
  zip: string
}

export async function loadProvinces(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_distinct_provinces')
  if (error) throw error
  return ((data as Array<{ province: string }>) || []).map((r) => r.province)
}

export async function loadCities(supabase: SupabaseClient, province: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_distinct_cities', { p_province: province })
  if (error) throw error
  return ((data as Array<{ city: string }>) || []).map((r) => r.city)
}

export async function loadSubdistricts(
  supabase: SupabaseClient,
  province: string,
  city: string
): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_distinct_subdistricts', {
    p_province: province,
    p_city: city,
  })
  if (error) throw error
  return ((data as Array<{ subdistrict: string }>) || []).map((r) => r.subdistrict)
}

export async function loadVillages(
  supabase: SupabaseClient,
  province: string,
  city: string,
  subdistrict: string
): Promise<Array<{ village: string; zip: string; id: number }>> {
  const { data, error } = await supabase.rpc('get_distinct_villages', {
    p_province: province,
    p_city: city,
    p_subdistrict: subdistrict,
  })
  if (error) throw error
  return (data as Array<{ id: number; village: string; zip: string }>) || []
}

export async function findWilayahId(
  supabase: SupabaseClient,
  parts: {
    province: string
    city: string
    subdistrict: string
    village: string
  }
): Promise<number | null> {
  const { data } = await supabase
    .from('master_wilayah')
    .select('id')
    .eq('province', parts.province)
    .eq('city', parts.city)
    .eq('subdistrict', parts.subdistrict)
    .eq('village', parts.village)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}
