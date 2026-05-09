// =============================================================
// Light-weight parser preview (Phase 2B + 3B + 3C)
// Shares parser.ts core with engine.ts (Phase 3A) and engine-rekonsil.ts (3B).
// Pure function — no DB writes (rekonsil & outbound previews do read-only
// lookups against orders to enrich the preview, but never mutate).
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyTransform } from './transforms'
import { indexValueMappings, parseSource } from './parser'
import { inferStatusForProfile } from './status-inference'
import { buildOutboundRows, type OutboundRowsResult } from './engine-outbound'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
  CourierChannelStatus,
  OrderStatus,
} from '@/lib/types'

export interface ParsedRow {
  orders: Record<string, unknown>
  order_items: Record<string, unknown>
  meta: Record<string, unknown>
  file_column: Record<string, unknown>
  raw: Record<string, unknown>
}

export interface PreviewResult {
  rows: ParsedRow[]
  totalRowsDetected: number
  warnings: string[]
  errors: string[]
}

const EMPTY: PreviewResult = { rows: [], totalRowsDetected: 0, warnings: [], errors: [] }

export async function previewParse(
  profile: ConverterProfile,
  fieldMappings: ConverterFieldMapping[],
  valueMappings: ConverterValueMapping[],
  fileOrText: File | string,
  maxRows = 3
): Promise<PreviewResult> {
  if (profile.direction === 'OUTBOUND_TO_COURIER') {
    return {
      ...EMPTY,
      errors: ['OUTBOUND parser preview akan tersedia di Phase 3 (Converter Engine).'],
    }
  }

  const warnings: string[] = []
  const errors: string[] = []
  let rawRows: Record<string, unknown>[] = []

  try {
    rawRows = await parseSource(profile, fileOrText, warnings)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    return { ...EMPTY, errors }
  }

  const totalRowsDetected = rawRows.length
  const sliced = rawRows.slice(0, maxRows)
  const valueMapIndex = indexValueMappings(valueMappings)

  const rows: ParsedRow[] = sliced.map((raw, idx) => {
    const out: ParsedRow = {
      orders: {},
      order_items: {},
      meta: {},
      file_column: {},
      raw,
    }
    for (const fm of fieldMappings) {
      const rawVal = raw[fm.source_field]
      let postValue: unknown = rawVal
      const vmList = valueMapIndex.get(fm.source_field)
      if (vmList && rawVal != null) {
        const hit = vmList.get(String(rawVal))
        if (hit !== undefined) postValue = hit
      }
      if (fm.transform) {
        const result = applyTransform(fm.transform, postValue, { orders: out.orders })
        if (result.ok) {
          postValue = result.value
        } else {
          warnings.push(
            `Row ${idx + 1}: transform "${fm.transform}" gagal di field "${fm.source_field}" — ${result.reason}`
          )
        }
      }
      if (
        fm.required &&
        (postValue == null || (typeof postValue === 'string' && postValue.trim() === ''))
      ) {
        warnings.push(`Row ${idx + 1}: required field "${fm.target_field}" (${fm.target_table}) kosong`)
      }
      const bucket = out[fm.target_table as keyof ParsedRow]
      if (bucket && typeof bucket === 'object' && !Array.isArray(bucket)) {
        ;(bucket as Record<string, unknown>)[fm.target_field] = postValue
      }
    }
    return out
  })

  return { rows, totalRowsDetected, warnings, errors }
}

// =============================================================
// Rekonsil-specific preview (Phase 3B)
// Enriches each parsed row with the matching order lookup so the UI
// can show "Found order GB-... → status X → Y" before the user commits.
// =============================================================

export interface RekonsilPreviewRow {
  rowIndex: number
  rawResi: string | null
  match:
    | { found: true; orderId: number; orderNumber: string; customerName: string; currentStatus: OrderStatus }
    | { found: false }
  /** Inferred / mapped new status. null = no change planned. */
  plannedStatus: OrderStatus | null
  /** Audit value that will land in order_status_history.raw_status. */
  rawStatus: string
  /** Will be true if raw_status not in mapping → would route to inbox unmapped. */
  needsInboxUnmapped: boolean
  /** Cost / meta updates planned (for display). */
  costUpdates: {
    shipping_cost_actual?: number
    payout_amount?: number
    cod_amount?: number
  }
  warnings: string[]
}

export interface RekonsilPreviewResult {
  rows: RekonsilPreviewRow[]
  totalRowsDetected: number
  globalWarnings: string[]
  errors: string[]
}

export async function previewRekonsil(
  supabase: SupabaseClient,
  organizationId: number,
  profile: ConverterProfile,
  fieldMappings: ConverterFieldMapping[],
  valueMappings: ConverterValueMapping[],
  statusMappings: CourierChannelStatus[],
  fileOrText: File | string,
  maxRows = 5
): Promise<RekonsilPreviewResult> {
  if (profile.direction !== 'INBOUND_REKONSIL') {
    return {
      rows: [],
      totalRowsDetected: 0,
      globalWarnings: [],
      errors: [`Profile "${profile.code}" bukan untuk rekonsil (direction=${profile.direction}).`],
    }
  }

  const globalWarnings: string[] = []
  let rawRows: Record<string, unknown>[]
  try {
    rawRows = await parseSource(profile, fileOrText, globalWarnings)
  } catch (err) {
    return {
      rows: [],
      totalRowsDetected: 0,
      globalWarnings,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  const totalRowsDetected = rawRows.length
  const sliced = rawRows.slice(0, maxRows)
  const valueMapIndex = indexValueMappings(valueMappings)
  const statusMapByRaw = new Map<string, OrderStatus>()
  for (const m of statusMappings) statusMapByRaw.set(m.raw_status, m.internal_status)

  const out: RekonsilPreviewRow[] = []
  for (let idx = 0; idx < sliced.length; idx++) {
    const raw = sliced[idx]
    const rowIndex = idx + 1
    const warnings: string[] = []

    const ordersFields: Record<string, unknown> = {}
    const meta: Record<string, unknown> = {}

    for (const fm of fieldMappings) {
      if (fm.target_table === 'file_column') continue
      const rv = raw[fm.source_field]
      let v: unknown = rv
      const vmList = valueMapIndex.get(fm.source_field)
      if (vmList && rv != null) {
        const hit = vmList.get(String(rv))
        if (hit !== undefined) v = hit
      }
      if (fm.transform) {
        const r = applyTransform(fm.transform, v, { orders: ordersFields })
        if (r.ok) v = r.value
        else {
          warnings.push(`transform "${fm.transform}" gagal di "${fm.source_field}" — ${r.reason}`)
          continue
        }
      }
      if (fm.target_table === 'orders') ordersFields[fm.target_field] = v
      else if (fm.target_table === 'meta') meta[fm.target_field] = v
    }

    // Lookup key
    const target = profile.primary_key_target
    let pkValue: string | null = null
    if (target) {
      const candidate =
        (ordersFields[target] as unknown) ??
        (profile.primary_key_field ? raw[profile.primary_key_field] : undefined)
      if (candidate != null) {
        const s = String(candidate).trim()
        pkValue = s === '' ? null : s
      }
    }

    let match: RekonsilPreviewRow['match'] = { found: false }
    if (pkValue && target) {
      const { data } = await supabase
        .from('orders')
        .select('id, order_number, customer_name, status')
        .eq('organization_id', organizationId)
        .eq(target, pkValue)
        .maybeSingle()
      if (data) {
        match = {
          found: true,
          orderId: data.id as number,
          orderNumber: data.order_number as string,
          customerName: data.customer_name as string,
          currentStatus: data.status as OrderStatus,
        }
      }
    }

    // Determine planned status
    const inferred = inferStatusForProfile(profile, raw)
    let plannedStatus: OrderStatus | null = null
    let rawStatus = ''
    let needsInboxUnmapped = false
    if (inferred) {
      plannedStatus = (inferred.status as OrderStatus | null) ?? null
      rawStatus = inferred.rawStatus
      needsInboxUnmapped = false
    } else {
      const rs = (ordersFields.status_raw as unknown) ?? (meta.status_raw as unknown)
      const rsStr = rs == null ? '' : String(rs).trim()
      rawStatus = rsStr
      if (rsStr) {
        const mapped = statusMapByRaw.get(rsStr)
        if (mapped) plannedStatus = mapped
        else needsInboxUnmapped = true
      }
    }

    const costUpdates: RekonsilPreviewRow['costUpdates'] = {}
    if (ordersFields.shipping_cost_actual !== undefined) {
      costUpdates.shipping_cost_actual = toNum(ordersFields.shipping_cost_actual)
    }
    if (ordersFields.payout_amount !== undefined) {
      costUpdates.payout_amount = toNum(ordersFields.payout_amount)
    }
    if (ordersFields.cod_amount !== undefined) {
      costUpdates.cod_amount = toNum(ordersFields.cod_amount)
    }

    out.push({
      rowIndex,
      rawResi: pkValue,
      match,
      plannedStatus,
      rawStatus,
      needsInboxUnmapped,
      costUpdates,
      warnings,
    })
  }

  return { rows: out, totalRowsDetected, globalWarnings, errors: [] }
}

function toNum(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const cleaned = String(v).replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

// =============================================================
// Outbound preview (Phase 3C)
// Thin wrapper around buildOutboundRows that limits to maxOrders so
// the UI can render a sample of rows before producing the full file.
// Read-only — does not mutate orders.
// =============================================================

export type OutboundPreviewResult = OutboundRowsResult & { totalOrdersRequested: number }

export async function previewOutbound(
  supabase: SupabaseClient,
  organizationId: number,
  profile: ConverterProfile,
  fieldMappings: ConverterFieldMapping[],
  valueMappings: ConverterValueMapping[],
  orderIds: number[],
  maxOrders = 5
): Promise<OutboundPreviewResult> {
  const slice = orderIds.slice(0, maxOrders)
  const r = await buildOutboundRows({
    profile,
    fieldMappings,
    valueMappings,
    orderIds: slice,
    organizationId,
    supabase,
  })
  return { ...r, totalOrdersRequested: orderIds.length }
}
