// =============================================================
// Outbound Engine (Phase 3C)
// Reverse of inbound: take selected orders → apply field mappings
// (target_table='file_column') → produce CSV/XLSX rows ready to
// hand off to ekspedisi/agregator.
// =============================================================
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyTransform, type TransformContext } from './transforms'
import { indexValueMappings } from './parser'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
  Order,
  OrderItem,
  CourierChannel,
} from '@/lib/types'

export interface OutboundRowError {
  orderId: number
  orderNumber: string | null
  reason: string
}

export interface OutboundRowWarning {
  orderId: number
  orderNumber: string | null
  message: string
}

export interface OutboundResult {
  rows: Array<Record<string, unknown>>
  headers: string[]
  ordersProcessed: number
  ordersSkipped: number
  errors: OutboundRowError[]
  warnings: OutboundRowWarning[]
}

export interface OutboundOptions {
  profile: ConverterProfile
  fieldMappings: ConverterFieldMapping[]
  valueMappings: ConverterValueMapping[]
  orderIds: number[]
  organizationId: number
  supabase: SupabaseClient
  /** Optional callback after each order processed (progress UI). */
  onProgress?: (processed: number, total: number) => void
}

interface OrderWithExtras extends Order {
  items?: OrderItem[]
  channel?: CourierChannel
}

const ORDER_COLUMNS = [
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
  'shipping_cost_actual',
  'discount',
  'total',
  'cod_amount',
  'payout_amount',
  'payment_method',
  'status',
  'cs_name',
  'notes',
  'meta',
  'order_date',
  'created_at',
].join(', ')

// =============================================================
// Public: build the outbound dataset (rows + headers)
// =============================================================
export async function buildOutbound(opts: OutboundOptions): Promise<OutboundResult> {
  if (opts.profile.direction !== 'OUTBOUND_TO_COURIER') {
    throw new Error(
      `Profile bukan untuk outbound (direction=${opts.profile.direction}). Gunakan profile dengan direction=OUTBOUND_TO_COURIER.`
    )
  }
  if (opts.orderIds.length === 0) {
    return {
      rows: [],
      headers: [],
      ordersProcessed: 0,
      ordersSkipped: 0,
      errors: [],
      warnings: [],
    }
  }

  const sortedFields = [...opts.fieldMappings]
    .filter((fm) => fm.target_table === 'file_column')
    .sort((a, b) => a.display_order - b.display_order)
  const headers = sortedFields.map((fm) => fm.target_field)

  const result: OutboundResult = {
    rows: [],
    headers,
    ordersProcessed: 0,
    ordersSkipped: 0,
    errors: [],
    warnings: [],
  }
  if (sortedFields.length === 0) {
    result.warnings.push({
      orderId: 0,
      orderNumber: null,
      message: 'Profile tidak punya field mapping target_table=file_column.',
    })
    return result
  }

  const valueMapIndex = indexValueMappings(opts.valueMappings)
  const orders = await loadOrders(opts.supabase, opts.organizationId, opts.orderIds)
  const orderMap = new Map(orders.map((o) => [o.id, o]))

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
      const row = buildRow(order, sortedFields, valueMapIndex, result)
      result.rows.push(row)
      result.ordersProcessed++
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
// Mark exported orders as DIKIRIM (or other status) via bulk RPC
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
// Generate file blobs (CSV / XLSX)
// =============================================================
export function generateCsv(
  rows: Array<Record<string, unknown>>,
  headers: string[],
  delimiter = ','
): Blob {
  const csv = Papa.unparse(
    { fields: headers, data: rows.map((r) => headers.map((h) => formatCsvCell(r[h]))) },
    { delimiter }
  )
  // utf-8 BOM helps Excel open csv with non-ascii chars correctly
  return new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
}

export function generateXlsx(
  rows: Array<Record<string, unknown>>,
  headers: string[],
  sheetName = 'Orders'
): Blob {
  const data = rows.map((r) => headers.map((h) => formatXlsxCell(r[h])))
  const aoa = [headers, ...data]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function suggestFilename(profile: ConverterProfile): string {
  const ts = new Date()
  const yyyy = ts.getFullYear()
  const mm = String(ts.getMonth() + 1).padStart(2, '0')
  const dd = String(ts.getDate()).padStart(2, '0')
  const hh = String(ts.getHours()).padStart(2, '0')
  const mi = String(ts.getMinutes()).padStart(2, '0')
  const ext = profile.file_format === 'XLSX' ? 'xlsx' : 'csv'
  return `${profile.code}_${yyyy}${mm}${dd}_${hh}${mi}.${ext}`
}

// =============================================================
// Internals
// =============================================================
async function loadOrders(
  supabase: SupabaseClient,
  organizationId: number,
  orderIds: number[]
): Promise<OrderWithExtras[]> {
  // chunk to avoid PostgREST URL-length limits on huge IN lists
  const chunks: number[][] = []
  const CHUNK = 200
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    chunks.push(orderIds.slice(i, i + CHUNK))
  }

  const all: OrderWithExtras[] = []
  for (const ids of chunks) {
    const { data, error } = await supabase
      .from('orders')
      .select(
        `${ORDER_COLUMNS}, items:order_items(id, product_name_raw, variation, qty, weight_per_unit, price), channel:courier_channels(id, code, name, aggregator)`
      )
      .eq('organization_id', organizationId)
      .in('id', ids)
    if (error) throw new Error(`Gagal load orders: ${error.message}`)
    all.push(...((data || []) as unknown as OrderWithExtras[]))
  }
  return all
}

function buildRow(
  order: OrderWithExtras,
  fields: ConverterFieldMapping[],
  valueMapIndex: Map<string, Map<string, string>>,
  result: OutboundResult
): Record<string, unknown> {
  const items = order.items || []
  const ctx: TransformContext = {
    orders: order as unknown as Record<string, unknown>,
    order_items: items as unknown as Array<Record<string, unknown>>,
  }

  const out: Record<string, unknown> = {}
  for (const fm of fields) {
    let value = resolveSourceField(fm.source_field, order, items, result)

    // Value mapping (raw → mapped)
    const vmList = valueMapIndex.get(fm.source_field)
    if (vmList && value != null) {
      const hit = vmList.get(String(value))
      if (hit !== undefined) value = hit
    }

    // Transform
    if (fm.transform) {
      const r = applyTransform(fm.transform, value, ctx)
      if (r.ok) {
        value = r.value
      } else {
        result.warnings.push({
          orderId: order.id,
          orderNumber: order.order_number,
          message: `transform "${fm.transform}" gagal di "${fm.source_field}" — ${r.reason}`,
        })
      }
    }

    if (fm.required && (value == null || (typeof value === 'string' && value.trim() === ''))) {
      result.warnings.push({
        orderId: order.id,
        orderNumber: order.order_number,
        message: `required field "${fm.target_field}" (source="${fm.source_field}") kosong`,
      })
    }

    out[fm.target_field] = value
  }
  return out
}

/**
 * Resolve a source_field path into a value from the order context.
 * Recognised patterns:
 *   - direct order column: 'customer_name', 'order_number', 'notes', etc.
 *   - 'order_items.total_qty'      → SUM(qty)
 *   - 'order_items.total_weight'   → SUM(qty * weight_per_unit)
 *   - 'order_items.product_summary'→ "Name x{qty} (variation), ..."
 *   - 'channel_courier_code'        → courier_channels.code (then value-mapping)
 *   - 'channel_aggregator'          → courier_channels.aggregator
 *   - 'total_if_cod'                → total when payment_method=COD, else ''
 *   - 'total_if_transfer'           → total when payment_method=TRANSFER, else ''
 *   - 'meta.<key>'                  → orders.meta?.[key]
 */
export function resolveSourceField(
  sourceField: string,
  order: OrderWithExtras,
  items: OrderItem[],
  result?: OutboundResult
): unknown {
  if (sourceField.startsWith('order_items.')) {
    const sub = sourceField.slice('order_items.'.length)
    return resolveItemsAggregate(sub, items, order, result)
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
      return order.payment_method === 'COD' ? order.total : ''
    case 'total_if_transfer':
      return order.payment_method === 'TRANSFER' ? order.total : ''
    case 'cod_amount_or_empty':
      return order.payment_method === 'COD' ? order.cod_amount ?? order.total : ''
    default: {
      // Direct column from orders
      const v = (order as unknown as Record<string, unknown>)[sourceField]
      if (v === undefined && result) {
        result.warnings.push({
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

function resolveItemsAggregate(
  sub: string,
  items: OrderItem[],
  order: OrderWithExtras,
  result?: OutboundResult
): unknown {
  switch (sub) {
    case 'total_qty':
      return items.reduce((acc, it) => acc + (Number(it.qty) || 0), 0)
    case 'total_weight':
      return items.reduce((acc, it) => {
        const qty = Number(it.qty) || 0
        const w = Number(it.weight_per_unit) || 0
        return acc + qty * w
      }, 0)
    case 'total_price':
      return items.reduce((acc, it) => {
        const qty = Number(it.qty) || 0
        const p = Number(it.price) || 0
        return acc + qty * p
      }, 0)
    case 'product_summary':
      return items
        .map((it) => {
          const name = it.product_name_raw || '(unknown)'
          const variation = it.variation ? ` (${it.variation})` : ''
          return `${name}${variation} x${it.qty}`
        })
        .join(', ')
    case 'product_names':
      return items.map((it) => it.product_name_raw).filter(Boolean).join(', ')
    case 'count':
      return items.length
    case 'first_product_name':
      return items[0]?.product_name_raw ?? ''
    case 'first_product_variation':
      return items[0]?.variation ?? ''
    default:
      if (result) {
        result.warnings.push({
          orderId: order.id,
          orderNumber: order.order_number,
          message: `order_items aggregate "${sub}" tidak dikenali — output kosong`,
        })
      }
      return ''
  }
}

function formatCsvCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function formatXlsxCell(v: unknown): unknown {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}
