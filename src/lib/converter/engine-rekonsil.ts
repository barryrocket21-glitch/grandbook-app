// =============================================================
// Rekonsil Engine (Phase 3B)
// Match orders by resi/order_number, update status + biaya aktual,
// route mismatches to inbox tables (UI dibangun Phase 2B).
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { getErrorMessage } from '@/lib/errors'
import { applyTransform } from './transforms'
import { indexValueMappings, parseSource } from './parser'
import { inferStatusForProfile } from './status-inference'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
  CourierChannelStatus,
  OrderStatus,
} from '@/lib/types'

export interface RekonsilRowError {
  rowIndex: number
  reason: string
  raw: Record<string, unknown>
}

export interface RekonsilRowWarning {
  rowIndex: number
  message: string
}

export interface RekonsilResult {
  matched: number
  status_updated: number
  cost_updated: number
  inbox_unmatched: number
  inbox_unmapped_status: number
  errors: RekonsilRowError[]
  warnings: RekonsilRowWarning[]
  totalRowsDetected: number
}

export interface RekonsilOptions {
  profile: ConverterProfile
  fieldMappings: ConverterFieldMapping[]
  valueMappings: ConverterValueMapping[]
  statusMappings: CourierChannelStatus[]
  fileOrText: File | string
  organizationId: number
  performedBy: string
  supabase: SupabaseClient
  onProgress?: (done: number, total: number) => void
}

const ORDER_FIELD_WHITELIST = new Set([
  'shipping_cost_actual',
  'payout_amount',
  'cod_amount',
  'status_changed_at',
])

const COST_FIELDS_FOR_DELTA = new Set([
  'shipping_cost_actual',
  'payout_amount',
  'cod_amount',
])

export async function ingestRekonsil(opts: RekonsilOptions): Promise<RekonsilResult> {
  if (opts.profile.direction !== 'INBOUND_REKONSIL') {
    throw new Error(
      `Profile bukan untuk rekonsil (direction=${opts.profile.direction}). Gunakan profile dengan direction=INBOUND_REKONSIL.`
    )
  }
  if (!opts.profile.channel_id) {
    throw new Error('Profile rekonsil wajib punya channel_id (untuk routing inbox unmapped).')
  }
  const lookupTarget = opts.profile.primary_key_target
  if (!lookupTarget) {
    throw new Error('Profile belum set primary_key_target (resi / external_order_id / order_number).')
  }

  const result: RekonsilResult = {
    matched: 0,
    status_updated: 0,
    cost_updated: 0,
    inbox_unmatched: 0,
    inbox_unmapped_status: 0,
    errors: [],
    warnings: [],
    totalRowsDetected: 0,
  }

  const parseWarnings: string[] = []
  let rawRows: Record<string, unknown>[]
  try {
    rawRows = await parseSource(opts.profile, opts.fileOrText, parseWarnings)
  } catch (err) {
    throw new Error(getErrorMessage(err))
  }
  result.totalRowsDetected = rawRows.length
  parseWarnings.forEach((m) => result.warnings.push({ rowIndex: -1, message: m }))
  if (rawRows.length === 0) return result

  const valueMapIndex = indexValueMappings(opts.valueMappings)
  const statusMapByRaw = new Map<string, OrderStatus>()
  for (const m of opts.statusMappings) {
    statusMapByRaw.set(m.raw_status, m.internal_status)
  }

  for (let idx = 0; idx < rawRows.length; idx++) {
    const raw = rawRows[idx]
    const rowIndex = idx + 1
    try {
      const extracted = applyMappings(raw, opts.fieldMappings, valueMapIndex, result, rowIndex)

      // 1. Determine lookup key
      const pkValue = pickLookupValue(raw, extracted, opts.profile)
      if (!pkValue) {
        result.warnings.push({
          rowIndex,
          message: `primary_key kosong (field "${opts.profile.primary_key_field}") — row dilewat`,
        })
        continue
      }

      // 2. Look up order
      const { data: orderRow } = await opts.supabase
        .from('orders')
        .select('id, status, channel_id, organization_id')
        .eq('organization_id', opts.organizationId)
        .eq(lookupTarget, pkValue)
        .maybeSingle()

      if (!orderRow) {
        await recordUnmatched(opts, pkValue, raw, result)
        continue
      }

      // 3. Determine new status
      const statusOutcome = await determineStatus(
        opts,
        raw,
        extracted,
        statusMapByRaw
      )

      // Route raw status that has no mapping → inbox unmapped
      if (statusOutcome.routeToInbox && statusOutcome.rawStatus) {
        const channelId = orderRow.channel_id ?? opts.profile.channel_id
        if (channelId) {
          await recordUnmapped(opts, channelId, statusOutcome.rawStatus, result)
        }
      }

      // 4. Build update payload
      const ordersFields = extracted.orders
      const newStatus = statusOutcome.status
      const shippingActual = ordersFields.shipping_cost_actual
      const payoutAmount = ordersFields.payout_amount
      const codAmount = ordersFields.cod_amount

      const hasStatusChange =
        newStatus !== null && newStatus !== undefined && newStatus !== orderRow.status
      const hasCostChange =
        shippingActual !== undefined ||
        payoutAmount !== undefined ||
        codAmount !== undefined

      if (!hasStatusChange && !hasCostChange && Object.keys(extracted.meta).length === 0) {
        // Nothing to do but order matched — count it as matched only
        result.matched++
        opts.onProgress?.(idx + 1, rawRows.length)
        continue
      }

      // 5. Update via RPC
      const note =
        newStatus && newStatus !== orderRow.status
          ? `Rekonsil ${opts.profile.code}: ${orderRow.status} → ${newStatus}`
          : `Rekonsil ${opts.profile.code}: cost update`

      const statusChangedAt = ordersFields.status_changed_at
        ? toIsoOrNull(ordersFields.status_changed_at)
        : null

      const { error: rpcErr } = await opts.supabase.rpc('update_order_from_rekonsil', {
        p_order_id: orderRow.id,
        p_new_status: hasStatusChange ? newStatus : null,
        p_shipping_cost_actual: shippingActual !== undefined ? toNumber(shippingActual) : null,
        p_payout_amount: payoutAmount !== undefined ? toNumber(payoutAmount) : null,
        p_cod_amount: codAmount !== undefined ? toNumber(codAmount) : null,
        p_meta_merge: Object.keys(extracted.meta).length ? extracted.meta : null,
        p_status_changed_at: hasStatusChange ? statusChangedAt : null,
        p_source_profile_id: opts.profile.id,
        p_raw_status: statusOutcome.rawStatus,
        p_note: note,
      })

      if (rpcErr) {
        result.errors.push({ rowIndex, reason: rpcErr.message, raw })
        continue
      }

      result.matched++
      if (hasStatusChange) result.status_updated++
      if (hasCostChange) result.cost_updated++
    } catch (err) {
      result.errors.push({
        rowIndex,
        reason: getErrorMessage(err),
        raw,
      })
    }
    opts.onProgress?.(idx + 1, rawRows.length)
  }

  return result
}

// ============================================================
// Internals
// ============================================================

interface ExtractedRow {
  orders: Record<string, unknown>
  meta: Record<string, unknown>
}

function applyMappings(
  raw: Record<string, unknown>,
  fieldMappings: ConverterFieldMapping[],
  valueMapIndex: Map<string, Map<string, string>>,
  result: RekonsilResult,
  rowIndex: number
): ExtractedRow {
  const orders: Record<string, unknown> = {}
  const meta: Record<string, unknown> = {}

  for (const fm of fieldMappings) {
    if (fm.target_table === 'file_column') continue

    const rawVal = raw[fm.source_field]
    let postValue: unknown = rawVal

    const vmList = valueMapIndex.get(fm.source_field)
    if (vmList && rawVal != null) {
      const hit = vmList.get(String(rawVal))
      if (hit !== undefined) postValue = hit
    }
    if (fm.transform) {
      const r = applyTransform(fm.transform, postValue, { orders })
      if (r.ok) {
        postValue = r.value
      } else {
        result.warnings.push({
          rowIndex,
          message: `transform "${fm.transform}" gagal di "${fm.source_field}" — ${r.reason}`,
        })
        continue
      }
    }
    if (fm.target_table === 'orders') {
      // Whitelist: only fields rekonsil engine knows how to update
      if (ORDER_FIELD_WHITELIST.has(fm.target_field)) {
        orders[fm.target_field] = postValue
      } else if (fm.target_field === 'resi' || fm.target_field === 'external_order_id' || fm.target_field === 'order_number') {
        // Lookup keys go through `pickLookupValue`; ignore here.
        orders[fm.target_field] = postValue
      } else if (fm.target_field === 'status_raw') {
        orders.status_raw = postValue
      } else {
        // Field maps to orders but isn't whitelisted for rekonsil update — stash in meta
        meta[fm.target_field] = postValue
      }
    } else if (fm.target_table === 'meta') {
      meta[fm.target_field] = postValue
    } else if (fm.target_table === 'order_items') {
      // Rekonsil doesn't update items
      meta[`item_${fm.target_field}`] = postValue
    }
  }
  return { orders, meta }
}

function pickLookupValue(
  raw: Record<string, unknown>,
  extracted: ExtractedRow,
  profile: ConverterProfile
): string | null {
  const target = profile.primary_key_target
  if (!target) return null
  // Prefer the post-transform extracted value, fall back to raw
  const candidate =
    (extracted.orders[target] as unknown) ??
    (profile.primary_key_field ? raw[profile.primary_key_field] : undefined)
  if (candidate == null) return null
  const s = String(candidate).trim()
  return s === '' ? null : s
}

interface StatusOutcome {
  status: string | null
  rawStatus: string
  routeToInbox: boolean
}

async function determineStatus(
  opts: RekonsilOptions,
  raw: Record<string, unknown>,
  extracted: ExtractedRow,
  statusMapByRaw: Map<string, OrderStatus>
): Promise<StatusOutcome> {
  // Strategy 1: profile.code-based inference (e.g. SPX Financial)
  const inferred = inferStatusForProfile(opts.profile, raw)
  if (inferred) {
    return {
      status: inferred.status,
      rawStatus: inferred.rawStatus,
      // Inferred-but-unknown isn't really "raw status missing from mapping",
      // so don't pollute inbox_unmapped_statuses with INFERRED_UNKNOWN.
      routeToInbox: false,
    }
  }

  // Strategy 2: explicit status_raw → look up in courier_channel_statuses
  const rawStatusRaw =
    (extracted.orders.status_raw as unknown) ??
    (extracted.meta.status_raw as unknown)
  const rawStatus = rawStatusRaw == null ? '' : String(rawStatusRaw).trim()
  if (!rawStatus) {
    return { status: null, rawStatus: '', routeToInbox: false }
  }
  const mapped = statusMapByRaw.get(rawStatus)
  if (mapped) {
    return { status: mapped, rawStatus, routeToInbox: false }
  }
  return { status: null, rawStatus, routeToInbox: true }
}

async function recordUnmatched(
  opts: RekonsilOptions,
  rawResi: string,
  raw: Record<string, unknown>,
  result: RekonsilResult
): Promise<void> {
  // Idempotency: skip if same raw_resi already in inbox unresolved (avoid dup on re-upload)
  const { data: existing } = await opts.supabase
    .from('inbox_unmatched_resi')
    .select('id')
    .eq('organization_id', opts.organizationId)
    .eq('source_profile_id', opts.profile.id)
    .eq('raw_resi', rawResi)
    .eq('resolved', false)
    .maybeSingle()
  if (existing?.id) return

  const { error } = await opts.supabase.from('inbox_unmatched_resi').insert({
    organization_id: opts.organizationId,
    source_profile_id: opts.profile.id,
    raw_resi: rawResi,
    raw_data: raw,
  })
  if (!error) result.inbox_unmatched++
}

async function recordUnmapped(
  opts: RekonsilOptions,
  channelId: number,
  rawStatus: string,
  result: RekonsilResult
): Promise<void> {
  // UNIQUE (organization_id, channel_id, raw_status) → upsert with occurrence increment
  const { data: existing } = await opts.supabase
    .from('inbox_unmapped_statuses')
    .select('id, occurrence_count, resolved')
    .eq('organization_id', opts.organizationId)
    .eq('channel_id', channelId)
    .eq('raw_status', rawStatus)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await opts.supabase
      .from('inbox_unmapped_statuses')
      .update({
        occurrence_count: (existing.occurrence_count || 0) + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (!error && !existing.resolved) result.inbox_unmapped_status++
    return
  }
  const { error } = await opts.supabase.from('inbox_unmapped_statuses').insert({
    organization_id: opts.organizationId,
    channel_id: channelId,
    raw_status: rawStatus,
  })
  if (!error) result.inbox_unmapped_status++
}

function toIsoOrNull(v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s
  // Fallback — try to construct a Date
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString()
  return null
}

function toNumber(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const cleaned = String(v).replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}
