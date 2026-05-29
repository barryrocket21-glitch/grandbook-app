// =============================================================
// Brief #1 — Customer Reputation + Blacklist (migration 077)
// Query wrappers + canonical phone helper (mirror SQL normalize_phone_canonical).
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerEnriched, CustomerReputation, CustomerRiskTier } from '@/lib/types'

/**
 * Canonical phone untuk lookup ke customers.phone_normalized.
 * MIRROR persis SQL public.normalize_phone_canonical: strip non-digit →
 * strip leading 62 / 0 → "8xxxxxxxxx". NULL kalau < 8 digit.
 * (orders.customer_phone bisa "0xxx" dari form ATAU "8xxx" dari converter —
 *  keduanya collapse ke "8xxx" di sini, konsisten dgn backfill.)
 */
export function toCanonicalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8) return null
  if (digits.startsWith('62')) return digits.slice(2)
  if (digits.startsWith('0')) return digits.slice(1)
  return digits
}

const EMPTY_REPUTATION: CustomerReputation = {
  found: false,
  phone_normalized: null,
  name_latest: null,
  risk_tier: 'NEW',
  is_blacklisted: false,
  blacklist_reason: null,
  is_vip: false,
  total_orders: 0,
  delivered_count: 0,
  returned_count: 0,
  fake_count: 0,
  cancel_count: 0,
  delivery_rate: 0,
  return_rate: 0,
  last_order_at: null,
  blacklist_mode: 'block',
}

/** Dipanggil dari form input (debounced). Aman dipanggil cs/admin/owner. */
export async function getCustomerReputation(
  supabase: SupabaseClient,
  phone: string
): Promise<CustomerReputation> {
  const { data, error } = await supabase.rpc('get_customer_reputation', { p_phone: phone })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return EMPTY_REPUTATION
  return row as CustomerReputation
}

export interface ListCustomersParams {
  search?: string | null
  tier?: CustomerRiskTier | null
  blacklisted?: boolean | null
  limit?: number
  offset?: number
}

export async function listCustomers(
  supabase: SupabaseClient,
  params: ListCustomersParams
): Promise<{ rows: CustomerEnriched[]; total: number }> {
  const { data, error } = await supabase.rpc('list_customers_enriched', {
    p_search: params.search?.trim() || null,
    p_tier: params.tier || null,
    p_blacklisted: params.blacklisted ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const rows = (data || []) as CustomerEnriched[]
  return { rows, total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 }
}

/**
 * Batch lookup reputasi utk daftar nomor (dipakai /orders/draft quality flag).
 * Input boleh raw phone (di-canonical-kan dulu). Return Map<canonical, {tier,blacklisted}>.
 */
export async function fetchRiskByPhones(
  supabase: SupabaseClient,
  rawPhones: Array<string | null | undefined>
): Promise<Map<string, { tier: CustomerRiskTier; blacklisted: boolean }>> {
  const canon = Array.from(
    new Set(rawPhones.map(toCanonicalPhone).filter((p): p is string => !!p))
  )
  const map = new Map<string, { tier: CustomerRiskTier; blacklisted: boolean }>()
  if (canon.length === 0) return map
  const { data, error } = await supabase
    .from('customers')
    .select('phone_normalized, risk_tier, is_blacklisted')
    .in('phone_normalized', canon)
  if (error) return map
  for (const r of (data || []) as Array<{ phone_normalized: string; risk_tier: CustomerRiskTier; is_blacklisted: boolean }>) {
    map.set(r.phone_normalized, { tier: r.risk_tier, blacklisted: r.is_blacklisted })
  }
  return map
}
