// =============================================================
// Outbound Engine (Phase 3C)
// Reverse of inbound: take selected orders → apply field mappings
// (target_table='file_column') → produce CSV/XLSX file ready to
// hand off to ekspedisi/agregator.
//
// `generateOutbound()` returns rows + a downloadable Blob in one call.
// `buildOutboundRows()` (lower-level) is shared with previewOutbound().
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyTransform, type TransformContext } from './transforms'
import { indexValueMappings } from './parser'
import {
  resolveSourceValue,
  resolveSpxLookupAsync,
  isAsyncSpxLookup,
  type SpxLookupCache,
  type OutboundResolveWarning,
  type OrderForOutbound,
} from './outbound-resolvers'
import { serializeForProfile, suggestOutboundFilename } from './serializer'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
} from '@/lib/types'

export interface OutboundRowError {
  orderId: number
  orderNumber: string | null
  reason: string
}

export type OutboundRowWarning = OutboundResolveWarning

/** Lower-level result used by previews — no file Blob produced. */
export interface OutboundRowsResult {
  rows: Array<Record<string, unknown>>
  headers: string[]
  ordersIncluded: number
  ordersSkipped: number
  warnings: OutboundRowWarning[]
  errors: OutboundRowError[]
}

/** Full result returned by generateOutbound — includes the file Blob. */
export interface OutboundResult extends OutboundRowsResult {
  rowsGenerated: number
  fileBlob: Blob
  fileName: string
}

export interface OutboundOptions {
  profile: ConverterProfile
  fieldMappings: ConverterFieldMapping[]
  valueMappings: ConverterValueMapping[]
  orderIds: number[]
  organizationId: number
  performedBy: string
  supabase: SupabaseClient
  onProgress?: (done: number, total: number) => void
  /**
   * Source table for the orders being exported.
   * - 'orders' (default): the archive table — orders with resi already.
   * - 'orders_draft' (Phase 8H): pre-resi staging — orders dari WA paste /
   *   manual input / bulk-upload yang belum dapet resi. Items diambil dari
   *   `order_items_draft` (bukan `order_items`).
   */
  sourceTable?: 'orders' | 'orders_draft'
}

/** Same as OutboundOptions but performedBy is optional (preview is read-only). */
export type OutboundRowsOptions = Omit<OutboundOptions, 'performedBy'> & { performedBy?: string }

const ORDER_COLUMNS_BASE = [
  'id',
  'organization_id',
  'order_number',
  'external_order_id',
  'resi',
  'channel_id',
  'customer_name',
  'customer_phone',
  'customer_province',
  'customer_city',
  'customer_subdistrict',
  'customer_village',
  'customer_zip',
  'customer_address_detail',
  'customer_address',
  'subtotal',
  'shipping_cost',
  'discount',
  'total',
  'cod_amount',
  'payment_method',
  'status',
  'cs_name',
  'notes',
  'meta',
  'order_date',
  'created_at',
]
// Phase 8H — orders_draft skips actuals/settlement cols (shipping_cost_actual,
// payout_amount, picked_up_at, delivered_at, returned_at, cod_settled_at).
// Only add these when reading from `orders`.
const ORDER_COLUMNS_ARCHIVE_EXTRA = ['shipping_cost_actual', 'payout_amount']
const ORDER_COLUMNS = ORDER_COLUMNS_BASE.concat(ORDER_COLUMNS_ARCHIVE_EXTRA).join(', ')
const ORDER_COLUMNS_DRAFT = ORDER_COLUMNS_BASE.join(', ')

// =============================================================
// Public: build rows only (no Blob). Used by preview + full generate.
// =============================================================
export async function buildOutboundRows(opts: OutboundRowsOptions): Promise<OutboundRowsResult> {
  if (opts.profile.direction !== 'OUTBOUND_TO_COURIER') {
    throw new Error(
      `Profile bukan untuk outbound (direction=${opts.profile.direction}). Gunakan profile dengan direction=OUTBOUND_TO_COURIER.`
    )
  }

  const sortedFields = [...opts.fieldMappings]
    .filter((fm) => fm.target_table === 'file_column')
    .sort((a, b) => a.display_order - b.display_order)
  const headers = sortedFields.map((fm) => fm.target_field)

  const result: OutboundRowsResult = {
    rows: [],
    headers,
    ordersIncluded: 0,
    ordersSkipped: 0,
    warnings: [],
    errors: [],
  }

  if (opts.orderIds.length === 0) return result
  if (sortedFields.length === 0) {
    result.warnings.push({
      orderId: 0,
      orderNumber: null,
      message: 'Profile tidak punya field mapping target_table=file_column.',
    })
    return result
  }

  const valueMapIndex = indexValueMappings(opts.valueMappings)
  const orders = await loadOrders(opts.supabase, opts.organizationId, opts.orderIds, opts.sourceTable ?? 'orders')
  const orderMap = new Map(orders.map((o) => [o.id, o]))

  // Phase 8G: cache SPX wilayah lookup per-order (4 fields share 1 RPC).
  // Empty kalau profile tidak punya spx_*_lookup mapping.
  const spxCache: SpxLookupCache = new Map()
  const profileNeedsSpxLookup = sortedFields.some(fm => isAsyncSpxLookup(fm.source_field))

  for (let idx = 0; idx < opts.orderIds.length; idx++) {
    const id = opts.orderIds[idx]
    const order = orderMap.get(id)
    if (!order) {
      result.errors.push({
        orderId: id,
        orderNumber: null,
        reason: 'Order tidak ditemukan atau di luar organisasi.',
      })
      result.ordersSkipped++
      opts.onProgress?.(idx + 1, opts.orderIds.length)
      continue
    }
    try {
      const row = await buildRow(
        order, sortedFields, valueMapIndex, result.warnings,
        opts.supabase, spxCache, profileNeedsSpxLookup,
      )
      result.rows.push(row)
      result.ordersIncluded++
    } catch (err) {
      result.errors.push({
        orderId: id,
        orderNumber: order.order_number,
        reason: err instanceof Error ? err.message : String(err),
      })
      result.ordersSkipped++
    }
    opts.onProgress?.(idx + 1, opts.orderIds.length)
  }

  return result
}

// =============================================================
// Public: full generate — rows + Blob + filename ready to download.
// =============================================================
export async function generateOutbound(opts: OutboundOptions): Promise<OutboundResult> {
  const rowsResult = await buildOutboundRows(opts)
  const fileBlob = serializeForProfile(opts.profile, rowsResult.rows, rowsResult.headers)
  const fileName = suggestOutboundFilename(opts.profile)
  return {
    ...rowsResult,
    rowsGenerated: rowsResult.rows.length,
    fileBlob,
    fileName,
  }
}

// =============================================================
// Bulk RPC: mark orders as DIKIRIM (or other status) after export
// =============================================================
export async function markOrdersExported(
  supabase: SupabaseClient,
  orderIds: number[],
  newStatus: 'DIKIRIM' | 'SIAP_KIRIM',
  sourceProfileId: number,
  note: string
): Promise<{ updated: number; error?: string }> {
  if (orderIds.length === 0) return { updated: 0 }
  const { data, error } = await supabase.rpc('mark_orders_exported', {
    p_order_ids: orderIds,
    p_new_status: newStatus,
    p_source_profile_id: sourceProfileId,
    p_note: note,
  })
  if (error) return { updated: 0, error: error.message }
  return { updated: typeof data === 'number' ? data : 0 }
}

// =============================================================
// Internals
// =============================================================
async function loadOrders(
  supabase: SupabaseClient,
  organizationId: number,
  orderIds: number[],
  sourceTable: 'orders' | 'orders_draft' = 'orders',
): Promise<OrderForOutbound[]> {
  // Chunk to avoid PostgREST URL-length limits on large IN lists.
  const chunks: number[][] = []
  const CHUNK = 200
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    chunks.push(orderIds.slice(i, i + CHUNK))
  }

  const itemsTable = sourceTable === 'orders_draft' ? 'order_items_draft' : 'order_items'
  const cols = sourceTable === 'orders_draft' ? ORDER_COLUMNS_DRAFT : ORDER_COLUMNS

  const all: OrderForOutbound[] = []
  for (const ids of chunks) {
    const { data, error } = await supabase
      .from(sourceTable)
      .select(
        `${cols}, items:${itemsTable}(id, product_name_raw, variation, qty, weight_per_unit, price), channel:courier_channels(id, code, name, aggregator)`
      )
      .eq('organization_id', organizationId)
      .in('id', ids)
    if (error) throw new Error(`Gagal load orders: ${error.message}`)
    all.push(...((data || []) as unknown as OrderForOutbound[]))
  }
  return all
}

async function buildRow(
  order: OrderForOutbound,
  fields: ConverterFieldMapping[],
  valueMapIndex: Map<string, Map<string, string>>,
  warnings: OutboundRowWarning[],
  supabase: SupabaseClient,
  spxCache: SpxLookupCache,
  profileNeedsSpxLookup: boolean,
): Promise<Record<string, unknown>> {
  const ctx: TransformContext = {
    orders: order as unknown as Record<string, unknown>,
    order_items: (order.items ?? []) as unknown as Array<Record<string, unknown>>,
  }

  const out: Record<string, unknown> = {}
  for (const fm of fields) {
    // Phase 8G: dispatch async kalau spx_*_lookup field
    let value: unknown
    if (profileNeedsSpxLookup && isAsyncSpxLookup(fm.source_field)) {
      value = await resolveSpxLookupAsync(fm.source_field, order, supabase, spxCache, warnings)
    } else {
      value = resolveSourceValue(fm.source_field, order, warnings)
    }

    // Value mapping (raw → mapped). E.g. channel_courier_code 'JNE_VIA_MENGANTAR' → 'JNE'.
    const vmList = valueMapIndex.get(fm.source_field)
    if (vmList && value != null && value !== '') {
      const hit = vmList.get(String(value))
      if (hit !== undefined) value = hit
    }

    // Transform (e.g. phone_to_628, kg_format).
    if (fm.transform) {
      // For null/undefined we keep as-is so empty cells stay empty (instead of "0", "NaN", etc).
      if (value == null || value === '') {
        // Skip transform — already empty.
      } else {
        const r = applyTransform(fm.transform, value, ctx)
        if (r.ok) {
          value = r.value
        } else {
          warnings.push({
            orderId: order.id,
            orderNumber: order.order_number,
            message: `transform "${fm.transform}" gagal di "${fm.source_field}" — ${r.reason}`,
          })
        }
      }
    }

    if (fm.required && (value == null || (typeof value === 'string' && value.trim() === ''))) {
      warnings.push({
        orderId: order.id,
        orderNumber: order.order_number,
        message: `required field "${fm.target_field}" (source="${fm.source_field}") kosong`,
      })
    }

    out[fm.target_field] = value
  }
  return out
}

// Re-exports for convenience
export { resolveSourceValue } from './outbound-resolvers'
export {
  serializeCsv,
  serializeXlsx,
  serializeForProfile,
  downloadBlob,
  suggestOutboundFilename,
} from './serializer'
