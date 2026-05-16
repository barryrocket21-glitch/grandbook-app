// =============================================================
// Production-grade Inbound Engine (Phase 3A)
// Handles INBOUND_ORDER + WA_PASTE direction.
// REKONSIL → Phase 3B. OUTBOUND → Phase 3C.
// =============================================================
import { applyTransform } from './transforms'
import { indexValueMappings, parseSource } from './parser'
import {
  createProductMatcher,
  logUnmatchedProductAsync,
  type ProductMatcher,
} from './product-matcher'
import { parseAddress, type WilayahCandidate } from './address-parser'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
  OrderStatus,
} from '@/lib/types'

interface AddressParseFailureForInbox {
  raw_address: string
  parsing_attempt: {
    extracted_keywords: string[]
    candidates: WilayahCandidate[]
    reason_failed: 'no_match' | 'ambiguous' | 'too_short' | 'empty_input'
  }
}

export type IngestStatus = 'BARU' | 'SIAP_KIRIM'

export interface IngestRowError {
  rowIndex: number
  reason: string
  raw: Record<string, unknown>
}

export interface IngestRowWarning {
  rowIndex: number
  message: string
}

export interface IngestResult {
  inserted: number
  skipped_duplicates: number
  errors: IngestRowError[]
  warnings: IngestRowWarning[]
  inserted_order_ids: number[]
  totalRowsDetected: number
}

export interface IngestOptions {
  profile: ConverterProfile
  fieldMappings: ConverterFieldMapping[]
  valueMappings: ConverterValueMapping[]
  fileOrText: File | string
  initialStatus: IngestStatus
  organizationId: number
  createdBy: string
  channelIdOverride?: number | null
  supabase: SupabaseClient
  /** Optional callback after each row processed (for progress UI). */
  onProgress?: (processed: number, total: number) => void
}

const ALLOWED_DIRECTIONS = new Set(['INBOUND_ORDER', 'WA_PASTE'])
const ORDER_FIELD_WHITELIST = new Set([
  'external_order_id',
  'order_number',
  'order_date',
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
  'cs_name',
  'notes',
  'campaign_id',
  // Phase 8E enrichment
  'customer_note',
  'tags',
  'priority',
])
const ITEM_FIELD_WHITELIST = new Set([
  'product_name_raw',
  'product_code_raw',
  'variation',
  'qty',
  'price',
  'weight_per_unit',
  'notes',
  // Phase 8F: hpp_snapshot dari cogs Orderonline (trigger snapshot_hpp_on_order_items
  // tetap jalan kalau product_id resolved; explicit hpp_snapshot di sini override)
  'hpp_snapshot',
])

export async function ingestInbound(opts: IngestOptions): Promise<IngestResult> {
  if (!ALLOWED_DIRECTIONS.has(opts.profile.direction)) {
    throw new Error(
      `Engine hanya support INBOUND_ORDER atau WA_PASTE. Direction "${opts.profile.direction}" akan dihandle di Phase 3B/3C.`
    )
  }

  const result: IngestResult = {
    inserted: 0,
    skipped_duplicates: 0,
    errors: [],
    warnings: [],
    inserted_order_ids: [],
    totalRowsDetected: 0,
  }

  const parseWarnings: string[] = []
  let rawRows: Record<string, unknown>[]
  try {
    rawRows = await parseSource(opts.profile, opts.fileOrText, parseWarnings)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err))
  }
  result.totalRowsDetected = rawRows.length
  parseWarnings.forEach((m) => result.warnings.push({ rowIndex: -1, message: m }))

  if (rawRows.length === 0) return result

  const valueMapIndex = indexValueMappings(opts.valueMappings)

  // Pre-resolve cs_name → cs_id by fetching all profiles once (case-insensitive lookup)
  const csNameToId = await loadCsNameMap(opts.supabase)

  // Phase 8.5: preload product master untuk in-memory exact-match. Yang gak
  // match akan di-log ke inbox_unmatched_products via fire-and-forget RPC.
  // batchId di-share semua row dari satu ingest call supaya admin bisa
  // group unmatched per batch saat review.
  const productMatcher = await createProductMatcher(opts.supabase)
  const batchId = `${opts.profile.code}-${Date.now()}`

  // Phase 8F: address parser cuma trigger untuk profile orderonline_inbound.
  // Profile lain (WA paste, dst) skip — address handling beda format.
  const ENABLE_ADDRESS_PARSER = opts.profile.code === 'orderonline_inbound'

  for (let idx = 0; idx < rawRows.length; idx++) {
    const raw = rawRows[idx]
    const rowIndex = idx + 1
    try {
      const { ordersData, itemData, metaData } = applyMappings(
        raw,
        opts.fieldMappings,
        valueMapIndex,
        result,
        rowIndex
      )

      // Phase 8F: hybrid address parser. Trust structured fields kalau lengkap;
      // kalau hanya address detail (free-text) → call RPC search_wilayah_fuzzy
      // untuk auto-match. Gagal parse → tetap insert order, lalu queue ke inbox.
      let addressParseFailure: AddressParseFailureForInbox | null = null
      if (ENABLE_ADDRESS_PARSER) {
        const detailFromMapping = String(
          ordersData.customer_address_detail ?? ordersData.customer_address ?? ''
        ).trim()
        const parsed = await parseAddress(
          {
            address: detailFromMapping,
            province: ordersData.customer_province as string | null,
            city: ordersData.customer_city as string | null,
            subdistrict: ordersData.customer_subdistrict as string | null,
            zip: ordersData.customer_zip as string | null,
          },
          opts.supabase,
        )
        if (parsed.success) {
          ordersData.customer_province = parsed.province
          ordersData.customer_city = parsed.city
          ordersData.customer_subdistrict = parsed.subdistrict
          if (parsed.village) ordersData.customer_village = parsed.village
          if (parsed.zip) ordersData.customer_zip = parsed.zip
          if (parsed.address_detail) ordersData.customer_address_detail = parsed.address_detail
          metaData.address_parse_confidence = parsed.confidence
        } else {
          // Queue untuk insert ke inbox_unparsed_address SETELAH order ke-create
          addressParseFailure = {
            raw_address: detailFromMapping || String(raw.address || ''),
            parsing_attempt: {
              extracted_keywords: parsed.extracted_keywords,
              candidates: parsed.candidates,
              reason_failed: parsed.reason,
            },
          }
          metaData.address_parse_failed = parsed.reason
        }
      }

      // required check
      if (!ordersData.customer_name || String(ordersData.customer_name).trim() === '') {
        result.errors.push({
          rowIndex,
          reason: 'customer_name kosong (required)',
          raw,
        })
        continue
      }

      // External-id duplicate detection
      const extId =
        ordersData.external_order_id != null && String(ordersData.external_order_id).trim() !== ''
          ? String(ordersData.external_order_id)
          : null
      if (extId) {
        const { data: existing } = await opts.supabase
          .from('orders')
          .select('id')
          .eq('organization_id', opts.organizationId)
          .eq('external_order_id', extId)
          .maybeSingle()
        if (existing?.id) {
          result.skipped_duplicates++
          continue
        }
      }

      // Channel resolve
      const channelId =
        opts.channelIdOverride != null
          ? opts.channelIdOverride
          : opts.profile.channel_id || null

      // CS lookup
      const csName = ordersData.cs_name ? String(ordersData.cs_name).trim() : null
      const csId = csName ? csNameToId.get(csName.toLowerCase()) || null : null

      // Generate order_number via RPC
      const { data: orderNumber, error: numErr } = await opts.supabase.rpc(
        'generate_order_number',
        { org_id: opts.organizationId }
      )
      if (numErr || !orderNumber) {
        result.errors.push({
          rowIndex,
          reason: `Gagal generate order_number: ${numErr?.message || 'unknown'}`,
          raw,
        })
        continue
      }

      // Build the full insert payload
      const insertPayload: Record<string, unknown> = {
        organization_id: opts.organizationId,
        order_number: orderNumber,
        external_order_id: extId,
        source_profile_id: opts.profile.id,
        channel_id: channelId,
        status: opts.initialStatus,
        payment_method: ordersData.payment_method || 'COD',
        customer_name: String(ordersData.customer_name).trim(),
        customer_phone: nullableStr(ordersData.customer_phone),
        customer_province: nullableStr(ordersData.customer_province),
        customer_city: nullableStr(ordersData.customer_city),
        customer_subdistrict: nullableStr(ordersData.customer_subdistrict),
        customer_village: nullableStr(ordersData.customer_village),
        customer_zip: nullableStr(ordersData.customer_zip),
        customer_address_detail: nullableStr(ordersData.customer_address_detail),
        customer_address: nullableStr(ordersData.customer_address),
        subtotal: toNumber(ordersData.subtotal),
        shipping_cost: toNumber(ordersData.shipping_cost),
        discount: toNumber(ordersData.discount),
        total: toNumber(ordersData.total),
        cod_amount: ordersData.cod_amount != null ? toNumber(ordersData.cod_amount) : null,
        cs_name: csName,
        cs_id: csId,
        notes: nullableStr(ordersData.notes),
        // Phase 8E enrichment
        customer_note: nullableStr(ordersData.customer_note),
        tags: Array.isArray(ordersData.tags) ? ordersData.tags : (ordersData.tags ? [String(ordersData.tags)] : []),
        priority: ['LOW', 'NORMAL', 'URGENT'].includes(String(ordersData.priority)) ? ordersData.priority : 'NORMAL',
        meta: Object.keys(metaData).length ? metaData : null,
        raw_data: raw,
        created_by: opts.createdBy,
      }
      if (ordersData.order_date) {
        const od = parseOrderDate(ordersData.order_date)
        if (od) insertPayload.order_date = od
      }

      // total fallback: if total is 0 but subtotal+shipping-discount has value, use that
      if (
        toNumber(insertPayload.total) === 0 &&
        toNumber(insertPayload.subtotal) > 0
      ) {
        insertPayload.total =
          toNumber(insertPayload.subtotal) +
          toNumber(insertPayload.shipping_cost) -
          toNumber(insertPayload.discount)
      }

      // Insert order
      const { data: orderRow, error: insErr } = await opts.supabase
        .from('orders')
        .insert(insertPayload)
        .select('id')
        .single()
      if (insErr || !orderRow) {
        // duplicate via UNIQUE(organization_id, external_order_id) returns 23505
        const code = (insErr as { code?: string } | null)?.code
        if (code === '23505') {
          result.skipped_duplicates++
        } else {
          result.errors.push({
            rowIndex,
            reason: insErr?.message || 'Insert gagal',
            raw,
          })
        }
        continue
      }

      // Phase 8F: kalau address parser fail, queue ke inbox_unparsed_address
      // (fire-and-forget — kalau insert gagal, log warning tapi tetap proceed)
      if (addressParseFailure) {
        const { error: inboxErr } = await opts.supabase
          .from('inbox_unparsed_address')
          .insert({
            organization_id: opts.organizationId,
            order_id: orderRow.id,
            raw_address: addressParseFailure.raw_address,
            parsing_attempt: addressParseFailure.parsing_attempt,
          })
        if (inboxErr) {
          result.warnings.push({
            rowIndex,
            message: `Address parse fail tapi inbox insert error: ${inboxErr.message}. Order id=${orderRow.id} tetap masuk.`,
          })
        } else {
          result.warnings.push({
            rowIndex,
            message: `Order id=${orderRow.id} alamat butuh review manual (reason: ${addressParseFailure.parsing_attempt.reason_failed}). Cek /inbox/address-review.`,
          })
        }
      }

      // Insert order_items (1 item per row in inbound — single line item)
      const itemPayload = buildItemPayload(
        itemData,
        ordersData,
        opts.organizationId,
        orderRow.id,
        productMatcher,
        opts.supabase,
        batchId
      )
      if (itemPayload) {
        const { error: itemErr } = await opts.supabase
          .from('order_items')
          .insert(itemPayload)
        if (itemErr) {
          result.warnings.push({
            rowIndex,
            message: `Order tersimpan (id=${orderRow.id}) tapi item gagal: ${itemErr.message}`,
          })
        }
      } else {
        result.warnings.push({
          rowIndex,
          message: 'Order tersimpan tanpa item (mapping tidak menghasilkan item data)',
        })
      }

      result.inserted++
      result.inserted_order_ids.push(orderRow.id as number)
    } catch (err) {
      result.errors.push({
        rowIndex,
        reason: err instanceof Error ? err.message : String(err),
        raw,
      })
    }
    opts.onProgress?.(idx + 1, rawRows.length)
  }

  return result
}

function applyMappings(
  raw: Record<string, unknown>,
  fieldMappings: ConverterFieldMapping[],
  valueMapIndex: Map<string, Map<string, string>>,
  result: IngestResult,
  rowIndex: number
): {
  ordersData: Record<string, unknown>
  itemData: Record<string, unknown>
  metaData: Record<string, unknown>
} {
  const ordersData: Record<string, unknown> = {}
  const itemData: Record<string, unknown> = {}
  const metaData: Record<string, unknown> = {}

  for (const fm of fieldMappings) {
    if (fm.target_table === 'file_column') continue // ignore in inbound (outbound concern)
    const rawVal = raw[fm.source_field]
    let postValue: unknown = rawVal
    const vmList = valueMapIndex.get(fm.source_field)
    if (vmList && rawVal != null) {
      const hit = vmList.get(String(rawVal))
      if (hit !== undefined) postValue = hit
    }
    if (fm.transform) {
      const r = applyTransform(fm.transform, postValue, { orders: ordersData })
      if (r.ok) {
        postValue = r.value
      } else {
        result.warnings.push({
          rowIndex,
          message: `transform "${fm.transform}" gagal di field "${fm.source_field}" — ${r.reason}`,
        })
        continue
      }
    }
    if (
      fm.required &&
      (postValue == null || (typeof postValue === 'string' && postValue.trim() === ''))
    ) {
      result.warnings.push({
        rowIndex,
        message: `required field "${fm.target_field}" kosong`,
      })
    }
    if (fm.target_table === 'orders') {
      if (ORDER_FIELD_WHITELIST.has(fm.target_field)) {
        ordersData[fm.target_field] = postValue
      } else {
        metaData[fm.target_field] = postValue
      }
    } else if (fm.target_table === 'order_items') {
      if (ITEM_FIELD_WHITELIST.has(fm.target_field)) {
        itemData[fm.target_field] = postValue
      } else {
        metaData[`item_${fm.target_field}`] = postValue
      }
    } else if (fm.target_table === 'meta') {
      metaData[fm.target_field] = postValue
    }
  }
  return { ordersData, itemData, metaData }
}

function buildItemPayload(
  itemData: Record<string, unknown>,
  ordersData: Record<string, unknown>,
  organizationId: number,
  orderId: number,
  matcher: ProductMatcher,
  supabase: SupabaseClient,
  batchId: string | null
): Record<string, unknown> | null {
  const productNameRaw = itemData.product_name_raw ?? ordersData.product_name_raw
  if (!productNameRaw || String(productNameRaw).trim() === '') {
    return null
  }
  const trimmedName = String(productNameRaw).trim()
  // Phase 8.5: resolve product_id via exact-match (case-insensitive + trimmed).
  // Yang gak match → product_id stays NULL + log fire-and-forget. Trigger
  // snapshot_hpp_on_order_items akan populate hpp_snapshot otomatis kalau
  // product_id resolved.
  const matchedProductId = matcher.match(trimmedName)
  if (matchedProductId === null) {
    logUnmatchedProductAsync(supabase, trimmedName, {
      sampleOrderId: orderId,
      sampleBatchId: batchId,
    })
  }
  return {
    organization_id: organizationId,
    order_id: orderId,
    product_id: matchedProductId,
    product_name_raw: trimmedName,
    variation: nullableStr(itemData.variation),
    product_code_raw: nullableStr(itemData.product_code_raw),
    qty: toInt(itemData.qty, 1),
    price: toNumber(itemData.price ?? ordersData.subtotal),
    weight_per_unit:
      itemData.weight_per_unit != null ? toNumber(itemData.weight_per_unit) : null,
    // Phase 8F: hpp_snapshot dari cogs Orderonline. Kalau di-set explicit dari
    // CSV → pakai itu. Kalau NULL → trigger snapshot_hpp_on_order_items akan
    // auto-populate dari products.hpp saat product_id resolved.
    hpp_snapshot:
      itemData.hpp_snapshot != null ? toNumber(itemData.hpp_snapshot) : null,
    notes: nullableStr(itemData.notes),
  }
}

async function loadCsNameMap(supabase: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('active', true)
  for (const p of data || []) {
    if (p.full_name) map.set(String(p.full_name).toLowerCase().trim(), p.id as string)
  }
  return map
}

function nullableStr(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function toNumber(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const cleaned = String(v).replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function toInt(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : fallback
  const n = parseInt(String(v).replace(/[^\d\-]/g, ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function parseOrderDate(v: unknown): string | null {
  if (!v) return null
  const s = String(v)
  // Already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // Try common formats
  try {
    const d = new Date(s)
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear()
      const month = String(d.getUTCMonth() + 1).padStart(2, '0')
      const day = String(d.getUTCDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
  } catch {}
  return null
}

// Re-export OrderStatus shape for caller convenience
export type { OrderStatus }
