// =============================================================
// Outbound resolvers (Phase 3C, Phase 8G: async + SPX wilayah lookups)
// Pure functions that map a `source_field` mapping path into a
// concrete value pulled from an order (orders + order_items + channel).
// Used by engine-outbound.ts for both preview and final generation.
//
// Phase 8G: returns `unknown | Promise<unknown>`. Sync resolvers tetap sync
// (Promise.resolve wrap di engine). Async resolvers (SPX wilayah lookup via
// RPC `lookup_spx_wilayah`) return Promise.
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Order, OrderItem, CourierChannel } from '@/lib/types'

export interface OutboundResolveWarning {
  orderId: number
  orderNumber: string | null
  message: string
}

export interface OrderForOutbound extends Order {
  items?: OrderItem[]
  channel?: CourierChannel
}

/**
 * Default weight per item (kg) when items have no weight_per_unit set.
 * Mirrors the Phase 3C brief: when weight is unknown we ship 1kg per
 * unit (qty * 1) and emit a warning so the operator can fix the
 * product master afterwards.
 */
export const DEFAULT_ITEM_WEIGHT_KG = 1

/**
 * Resolve a `source_field` path (as defined in converter_field_mappings)
 * to a value derived from the order context.
 * `warnings` is appended in-place when fallbacks (e.g. default weight)
 * or unknown paths are hit.
 *
 * Recognized patterns:
 *   - `customer_name`, `order_number`, `notes`, ... → direct order column
 *   - `order_items.<aggregate>` → SUM/concat over order_items
 *   - `meta.<key>` → orders.meta JSON field
 *   - `channel_courier_code` / `channel_aggregator` / `channel_name`
 *   - `total_if_cod` / `total_if_transfer` / `cod_amount_or_empty`
 */
/**
 * Sync resolveSourceValue — semua resolver yang tidak butuh DB lookup.
 * Phase 8G: SPX wilayah lookups + shipping_payment moved ke resolveSourceValueAsync.
 */
export function resolveSourceValue(
  sourceField: string,
  order: OrderForOutbound,
  warnings: OutboundResolveWarning[]
): unknown {
  if (sourceField.startsWith('order_items.')) {
    return resolveItemsAggregate(sourceField.slice('order_items.'.length), order, warnings)
  }
  if (sourceField.startsWith('meta.')) {
    const key = sourceField.slice('meta.'.length)
    return order.meta?.[key] ?? ''
  }
  switch (sourceField) {
    case 'channel_courier_code':
      return order.channel?.code ?? ''
    case 'channel_aggregator':
      return order.channel?.aggregator ?? ''
    case 'channel_name':
      return order.channel?.name ?? ''
    case 'total_if_cod':
      return order.payment_method === 'COD' ? order.total : null
    case 'total_if_transfer':
      return order.payment_method === 'TRANSFER' ? order.total : null
    case 'cod_amount_or_empty':
      return order.payment_method === 'COD' ? order.cod_amount ?? order.total : null
    // SPX outbound derived fields (Phase 8E)
    case 'payment_method_cod_label_id':
      return order.payment_method === 'COD' ? 'Paket COD' : 'Bukan Paket COD'
    case 'payment_method_label_id':
      // Deprecated Phase 8G — gunakan `shipping_payment_default_id`. Kept for backward compat.
      return order.payment_method === 'COD' ? 'COD' : 'Bank Transfer'
    case 'insurance_default_n':
      return 'N'
    // Phase 8G — SPX *Metode Pembayaran kolom adalah "siapa bayar ongkir", bukan
    // payment method customer. SPX cuma support 1 value: "Dibayar Pengirim".
    case 'shipping_payment_default_id':
      return 'Dibayar Pengirim'
    case 'concat_address':
      return concatFullAddress(order)
    // Phase 8G — SPX wilayah lookups (handled in async path; sync fallback uppercase)
    case 'spx_state_lookup':
      return (order.customer_province ?? '').toUpperCase()
    case 'spx_city_lookup':
      return (order.customer_city ?? '').toUpperCase()
    case 'spx_district_lookup':
      return (order.customer_subdistrict ?? '').toUpperCase()
    case 'spx_postal_lookup':
      return order.customer_zip ?? ''
    default: {
      const v = (order as unknown as Record<string, unknown>)[sourceField]
      if (v === undefined) {
        warnings.push({
          orderId: order.id,
          orderNumber: order.order_number,
          message: `source_field "${sourceField}" tidak dikenali — output kosong`,
        })
        return ''
      }
      return v ?? ''
    }
  }
}

// =============================================================
// Phase 8G — Async SPX wilayah resolvers (RPC lookup_spx_wilayah)
// =============================================================

const SPX_LOOKUP_FIELDS = new Set([
  'spx_state_lookup',
  'spx_city_lookup',
  'spx_district_lookup',
  'spx_postal_lookup',
])

export function isAsyncSpxLookup(sourceField: string): boolean {
  return SPX_LOOKUP_FIELDS.has(sourceField)
}

/**
 * Phase 8G — async resolver untuk SPX wilayah lookup. Engine outbound call
 * ini kalau `isAsyncSpxLookup(source_field)` true. Cache hasil per-order via
 * `SpxLookupCache` supaya 4 field (state/city/district/postal) cuma 1 RPC call.
 */
export interface SpxLookupResult {
  spx_state: string | null
  spx_city: string | null
  spx_district: string | null
  spx_postal_code: string | null
  is_serviceable: boolean | null
  match_confidence: string  // 'normalized' | 'partial' | 'district_only' | 'not_found'
}

export type SpxLookupCache = Map<number, SpxLookupResult | null>

export async function getSpxLookupForOrder(
  order: OrderForOutbound,
  supabase: SupabaseClient,
  cache: SpxLookupCache,
): Promise<SpxLookupResult | null> {
  if (cache.has(order.id)) return cache.get(order.id) ?? null

  if (!order.customer_province || !order.customer_city || !order.customer_subdistrict) {
    cache.set(order.id, null)
    return null
  }

  try {
    const { data, error } = await supabase.rpc('lookup_spx_wilayah', {
      p_province: order.customer_province,
      p_city: order.customer_city,
      p_subdistrict: order.customer_subdistrict,
    })
    if (error || !data || data.length === 0) {
      cache.set(order.id, null)
      return null
    }
    const first = (data as SpxLookupResult[])[0]
    if (first.match_confidence === 'not_found') {
      cache.set(order.id, null)
      return null
    }
    cache.set(order.id, first)
    return first
  } catch {
    cache.set(order.id, null)
    return null
  }
}

/**
 * Async dispatcher untuk SPX lookup fields. Caller-nya engine-outbound.buildRow.
 * Pakai sync resolver sebagai fallback kalau RPC lookup gagal.
 */
export async function resolveSpxLookupAsync(
  sourceField: string,
  order: OrderForOutbound,
  supabase: SupabaseClient,
  cache: SpxLookupCache,
  warnings: OutboundResolveWarning[],
): Promise<unknown> {
  const lookup = await getSpxLookupForOrder(order, supabase, cache)
  if (!lookup) {
    // Fallback: sync uppercase. Emit warning supaya operator aware.
    warnings.push({
      orderId: order.id,
      orderNumber: order.order_number,
      message: `SPX wilayah lookup gagal untuk ${sourceField} (province="${order.customer_province ?? ''}", city="${order.customer_city ?? ''}", subdistrict="${order.customer_subdistrict ?? ''}"). Fallback uppercase. Order ini kemungkinan akan ditolak SPX.`,
    })
    return resolveSourceValue(sourceField, order, warnings)
  }
  switch (sourceField) {
    case 'spx_state_lookup':    return lookup.spx_state ?? ''
    case 'spx_city_lookup':     return lookup.spx_city ?? ''
    case 'spx_district_lookup': return lookup.spx_district ?? ''
    case 'spx_postal_lookup':   return lookup.spx_postal_code ?? ''
    default: return ''
  }
}

function resolveItemsAggregate(
  agg: string,
  order: OrderForOutbound,
  warnings: OutboundResolveWarning[]
): unknown {
  const items = order.items ?? []
  switch (agg) {
    case 'total_qty':
      return items.reduce((acc, it) => acc + (Number(it.qty) || 0), 0)
    case 'total_weight':
      return computeTotalWeight(items, order, warnings)
    case 'total_price':
      return items.reduce((acc, it) => {
        const qty = Number(it.qty) || 0
        const price = Number(it.price) || 0
        return acc + qty * price
      }, 0)
    case 'product_summary':
      return formatProductSummary(items)
    case 'product_names':
      return items.map((it) => it.product_name_raw).filter(Boolean).join(', ')
    case 'count':
      return items.length
    case 'first_product_name':
      return items[0]?.product_name_raw ?? ''
    case 'first_product_variation':
      return items[0]?.variation ?? ''
    default:
      warnings.push({
        orderId: order.id,
        orderNumber: order.order_number,
        message: `order_items aggregate "${agg}" tidak dikenali — output kosong`,
      })
      return ''
  }
}

/**
 * Sum (qty × weight_per_unit) across items. When an item has no
 * weight_per_unit set, fall back to DEFAULT_ITEM_WEIGHT_KG and warn
 * so the operator can fix the product master afterwards.
 */
export function computeTotalWeight(
  items: OrderItem[],
  order: OrderForOutbound,
  warnings: OutboundResolveWarning[]
): number {
  let total = 0
  let usedDefault = false
  for (const it of items) {
    const qty = Number(it.qty) || 0
    let w = Number(it.weight_per_unit)
    if (!Number.isFinite(w) || w <= 0) {
      w = DEFAULT_ITEM_WEIGHT_KG
      usedDefault = true
    }
    total += qty * w
  }
  if (usedDefault) {
    warnings.push({
      orderId: order.id,
      orderNumber: order.order_number,
      message: `weight_per_unit kosong di sebagian item — pakai default ${DEFAULT_ITEM_WEIGHT_KG} kg/unit`,
    })
  }
  return total
}

/**
 * "1x Baju Wanita Hitam M, 2x Kaos Pria Putih L"
 * Format dari brief Phase 3C — qty di depan, variation appended dengan space.
 */
export function formatProductSummary(items: OrderItem[]): string {
  return items
    .map((it) => {
      const name = it.product_name_raw ?? '(unknown)'
      const variation = it.variation ? ` ${it.variation}` : ''
      return `${it.qty}x ${name}${variation}`
    })
    .join(', ')
}

export function concatFullAddress(order: OrderForOutbound): string {
  const parts = [
    order.customer_address_detail,
    order.customer_village,
    order.customer_subdistrict,
    order.customer_city,
    order.customer_province,
  ]
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter((p) => p.length > 0)
  const zip = order.customer_zip != null ? String(order.customer_zip).trim() : ''
  let result = parts.join(', ')
  if (zip) result += ` ${zip}`
  return result
}
