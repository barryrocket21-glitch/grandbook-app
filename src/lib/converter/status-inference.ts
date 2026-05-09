// =============================================================
// Status inference strategies for rekonsil profiles where the file
// has no explicit status column (e.g. SPX Financial Report — Order
// status field selalu kosong, status diinferred dari Escrow + Return Fee).
//
// Strategy keyed by profile.code. Add a new case here when you onboard a
// new aggregator that needs inferred status.
// =============================================================

import type { ConverterProfile } from '@/lib/types'

export interface InferenceResult {
  /** Internal status enum; null = cannot infer (caller routes to inbox). */
  status: string | null
  /** Audit trail value stored in order_status_history.raw_status. */
  rawStatus: string
}

/**
 * Returns inference result if profile.code has a strategy,
 * otherwise returns null (caller falls back to status_raw + status mapping lookup).
 */
export function inferStatusForProfile(
  profile: ConverterProfile,
  rawRow: Record<string, unknown>
): InferenceResult | null {
  switch (profile.code) {
    case 'spx_financial_rekonsil':
      return inferSpxStatus(rawRow)
    default:
      return null
  }
}

/**
 * SPX Financial Report inference:
 *   Return Fee > 0 → RETUR (kurir balik ke seller)
 *   Escrow > 0    → DITERIMA (paid out)
 *   else          → unknown (route to inbox)
 *
 * Rationale: SPX nggak isi "Order status" column di financial report.
 * Tapi escrow > 0 cuma dikeluarkan setelah delivered & period berakhir,
 * dan return fee > 0 cuma muncul kalau actually returned to sender.
 */
export function inferSpxStatus(rawRow: Record<string, unknown>): InferenceResult {
  const escrow = parseAmount(rawRow['Escrow amount (IDR)'])
  const returnFee = parseAmount(rawRow['Return Fee (IDR)'])

  if (returnFee > 0) {
    return { status: 'RETUR', rawStatus: 'INFERRED_RETUR (return_fee>0)' }
  }
  if (escrow > 0) {
    return { status: 'DITERIMA', rawStatus: 'INFERRED_DITERIMA (escrow>0)' }
  }
  return { status: null, rawStatus: 'INFERRED_UNKNOWN (escrow=0, return_fee=0)' }
}

function parseAmount(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v).trim()
  if (s === '' || s === '-') return 0
  const n = Number(s.replace(/[,\s]/g, '').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
