// =============================================================
// Outbound resolvers (Phase 3C)
// Pure functions that map a `source_field` mapping path into a
// concrete value pulled from an order (orders + order_items + channel).
// Used by engine-outbound.ts for both preview and final generation.
// =============================================================
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
    // SPX outbound derived fields (Phase 8E hotfix — seeded for spx_outbound profile)
    case 'payment_method_cod_label_id':
      return order.payment_method === 'COD' ? 'Paket COD' : 'Bukan Paket COD'
    case 'payment_method_label_id':
      return order.payment_method === 'COD' ? 'COD' : 'Bank Transfer'
    case 'insurance_default_n':
      return 'N'
    case 'concat_address':
      // Computed full address — handy for profiles where the courier wants a single string.
      // Mengantar pisah jadi field-field individual, tapi profile lain bisa pakai ini.
      return concatFullAddress(order)
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
