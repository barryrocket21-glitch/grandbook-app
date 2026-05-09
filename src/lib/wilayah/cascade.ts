import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cascade dropdown helpers for master_wilayah (82k rows).
 * All queries filter to distinct values to keep the dropdown manageable.
 * RLS allows all authenticated users to SELECT.
 */

export interface WilayahMatch {
  id: number
  province: string
  city: string
  subdistrict: string
  village: string
  zip: string
}

const PAGE_SIZE = 2000

async function fetchAll<T>(
  supabase: SupabaseClient,
  build: (from: number, to: number) => any
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const chunk = (data || []) as T[]
    all.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
    from += PAGE_SIZE
    if (from > 100_000) break
  }
  return all
}

export async function loadProvinces(supabase: SupabaseClient): Promise<string[]> {
  const rows = await fetchAll<{ province: string }>(supabase, (from, to) =>
    supabase.from('master_wilayah').select('province').order('province').range(from, to)
  )
  return Array.from(new Set(rows.map((r) => r.province))).sort()
}

export async function loadCities(supabase: SupabaseClient, province: string): Promise<string[]> {
  const rows = await fetchAll<{ city: string }>(supabase, (from, to) =>
    supabase
      .from('master_wilayah')
      .select('city')
      .eq('province', province)
      .order('city')
      .range(from, to)
  )
  return Array.from(new Set(rows.map((r) => r.city))).sort()
}

export async function loadSubdistricts(
  supabase: SupabaseClient,
  province: string,
  city: string
): Promise<string[]> {
  const rows = await fetchAll<{ subdistrict: string }>(supabase, (from, to) =>
    supabase
      .from('master_wilayah')
      .select('subdistrict')
      .eq('province', province)
      .eq('city', city)
      .order('subdistrict')
      .range(from, to)
  )
  return Array.from(new Set(rows.map((r) => r.subdistrict))).sort()
}

export async function loadVillages(
  supabase: SupabaseClient,
  province: string,
  city: string,
  subdistrict: string
): Promise<Array<{ village: string; zip: string; id: number }>> {
  const { data, error } = await supabase
    .from('master_wilayah')
    .select('id, village, zip')
    .eq('province', province)
    .eq('city', city)
    .eq('subdistrict', subdistrict)
    .order('village')
    .limit(1000)
  if (error) throw error
  return data || []
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
