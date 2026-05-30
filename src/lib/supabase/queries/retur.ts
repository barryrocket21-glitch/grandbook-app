// =============================================================
// Brief #4 — Retur Root-Cause query wrappers
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ReturPerCs, ReturPerProduk, ReturPerCampaign, ReturPerWilayah, ReturPerKurir, ReturReason,
} from '@/lib/types'

const d = (x: Date | string | null | undefined): string | null =>
  x == null ? null : typeof x === 'string' ? x : x.toISOString().slice(0, 10)

export async function fetchReturPerCs(s: SupabaseClient, from?: Date | string | null, to?: Date | string | null): Promise<ReturPerCs[]> {
  const { data, error } = await s.rpc('analytics_retur_per_cs', { p_start: d(from), p_end: d(to) })
  if (error) throw new Error(error.message)
  return (data || []) as ReturPerCs[]
}
export async function fetchReturPerProduk(s: SupabaseClient, from?: Date | string | null, to?: Date | string | null): Promise<ReturPerProduk[]> {
  const { data, error } = await s.rpc('analytics_retur_per_produk', { p_start: d(from), p_end: d(to) })
  if (error) throw new Error(error.message)
  return (data || []) as ReturPerProduk[]
}
export async function fetchReturPerCampaign(s: SupabaseClient, from?: Date | string | null, to?: Date | string | null): Promise<ReturPerCampaign[]> {
  const { data, error } = await s.rpc('analytics_retur_per_campaign', { p_start: d(from), p_end: d(to) })
  if (error) throw new Error(error.message)
  return (data || []) as ReturPerCampaign[]
}
export async function fetchReturPerWilayah(s: SupabaseClient, from?: Date | string | null, to?: Date | string | null): Promise<ReturPerWilayah[]> {
  const { data, error } = await s.rpc('analytics_retur_per_wilayah', { p_start: d(from), p_end: d(to) })
  if (error) throw new Error(error.message)
  return (data || []) as ReturPerWilayah[]
}
export async function fetchReturPerKurir(s: SupabaseClient, from?: Date | string | null, to?: Date | string | null): Promise<ReturPerKurir[]> {
  const { data, error } = await s.rpc('analytics_retur_per_kurir', { p_start: d(from), p_end: d(to) })
  if (error) throw new Error(error.message)
  return (data || []) as ReturPerKurir[]
}
export async function fetchReturReasons(
  s: SupabaseClient, dimension: string, value: string, from?: Date | string | null, to?: Date | string | null
): Promise<ReturReason[]> {
  const { data, error } = await s.rpc('analytics_retur_reasons', {
    p_dimension: dimension, p_value: value, p_start: d(from), p_end: d(to),
  })
  if (error) throw new Error(error.message)
  return (data || []) as ReturReason[]
}

/** Warna konsisten dgn customer risk: >=30% merah, >=15% amber, else normal. */
export function returRateColor(rate: number | null): string {
  const r = Number(rate ?? 0)
  if (r >= 0.3) return 'text-red-600 font-semibold'
  if (r >= 0.15) return 'text-amber-600 font-medium'
  return ''
}
