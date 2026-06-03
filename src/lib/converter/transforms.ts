// =============================================================
import { getErrorMessage } from '@/lib/errors'
// Transforms catalog (Phase 2B)
// Light-weight registry for the Test Parser preview. Phase 3 engine
// will reuse the same `key` strings, but may implement additional
// runtime semantics (e.g. concat across columns).
// =============================================================

export type TransformKey =
  | 'normalize_phone_id'
  | 'phone_to_628'
  | 'parse_date_dd-mm-yyyy'
  | 'parse_datetime_yyyy-mm-dd'
  | 'numeric_or_zero'
  | 'numeric_or_null'
  | 'numeric_id_currency'
  | 'uppercase'
  | 'lowercase'
  | 'trim'
  | 'null_if_empty'
  | 'split_csv_to_array'
  | 'kg_format'
  | 'concat_address'
  | 'sum_qty'

export interface TransformDef {
  key: TransformKey
  label: string
  description: string
  sample: { input: string; output: string }
  available: boolean // implemented in preview?
}

export const TRANSFORMS: readonly TransformDef[] = [
  {
    key: 'normalize_phone_id',
    label: 'Normalize Phone (ID, 08xxx)',
    description: 'Convert format 628xxx atau 8xxx ke 08xxx',
    sample: { input: '628123456789', output: '08123456789' },
    available: true,
  },
  {
    key: 'phone_to_628',
    label: 'Phone to 628xxx',
    description: 'Convert format 08xxx atau 8xxx ke 628xxx',
    sample: { input: '08123456789', output: '628123456789' },
    available: true,
  },
  {
    key: 'parse_date_dd-mm-yyyy',
    label: 'Parse Date "DD-MM-YYYY"',
    description: 'Parse format DD-MM-YYYY (atau "DD-MM-YYYY - HH:MM") ke ISO date',
    sample: { input: '06-05-2026 - 23:58', output: '2026-05-06T23:58:00.000Z' },
    available: true,
  },
  {
    key: 'parse_datetime_yyyy-mm-dd',
    label: 'Parse Datetime "YYYY/MM/DD"',
    description: 'Parse format YYYY/MM/DD HH:MM:SS ke ISO datetime',
    sample: { input: '2026/04/27 12:48:12', output: '2026-04-27T12:48:12.000Z' },
    available: true,
  },
  {
    key: 'numeric_or_zero',
    label: 'Numeric or Zero',
    description: 'Parse ke number, fallback 0 kalau invalid',
    sample: { input: '157,350', output: '157350' },
    available: true,
  },
  {
    key: 'numeric_or_null',
    label: 'Numeric or Null',
    description: 'Parse ke number, return null kalau empty atau invalid (Phase 8F)',
    sample: { input: '157,350', output: '157350' },
    available: true,
  },
  {
    key: 'numeric_id_currency',
    label: 'Numeric (ID Currency)',
    description: 'Parse format mata uang Indonesia. "." = thousand sep, "," = decimal sep (Phase 8K)',
    sample: { input: 'Rp 140.000', output: '140000' },
    available: true,
  },
  {
    key: 'uppercase',
    label: 'UPPERCASE',
    description: 'UPPERCASE string',
    sample: { input: 'cod', output: 'COD' },
    available: true,
  },
  {
    key: 'lowercase',
    label: 'lowercase',
    description: 'Lowercase string',
    sample: { input: 'COD', output: 'cod' },
    available: true,
  },
  {
    key: 'trim',
    label: 'Trim Whitespace',
    description: 'Strip leading/trailing whitespace',
    sample: { input: '  abc  ', output: 'abc' },
    available: true,
  },
  {
    key: 'null_if_empty',
    label: 'Null if Empty (Phase 8F)',
    description: 'Trim string. Kalau empty → null. Cegah kolom nullable jadi empty string',
    sample: { input: '   ', output: 'null' },
    available: true,
  },
  {
    key: 'split_csv_to_array',
    label: 'Split CSV → Array (Phase 8F)',
    description: 'Split string by comma, trim tiap element, skip empty. Untuk kolom tags[]',
    sample: { input: 'tag1, tag2, tag3', output: '[tag1, tag2, tag3]' },
    available: true,
  },
  {
    key: 'kg_format',
    label: 'Format KG (X.X)',
    description: 'Number ke string "X.X" kg (1 desimal)',
    sample: { input: '1.5', output: '1.5' },
    available: true,
  },
  {
    key: 'concat_address',
    label: 'Concat Full Address',
    description: 'Gabung field alamat struktural (detail + village + subdistrict + city + province + zip) jadi 1 string',
    sample: { input: '(struktural)', output: 'Jl Raya 12, Pagesangan, Mataram, NTB 83115' },
    available: true,
  },
  {
    key: 'sum_qty',
    label: 'Sum Qty (order_items)',
    description: 'Sum total qty dari order_items rows (dipakai context outbound)',
    sample: { input: '(items[])', output: '5' },
    available: true,
  },
] as const

export function getTransform(key: string | null | undefined): TransformDef | undefined {
  if (!key) return undefined
  return TRANSFORMS.find((t) => t.key === key)
}

// =============================================================
// Phase 8G — Defensive phone normalizer
// =============================================================

export type PhoneInvalidReason =
  | 'scientific_notation'
  | 'too_short'
  | 'too_long'
  | 'non_numeric'
  | 'empty'

export interface PhoneNormalizeResult {
  /** Canonical 8xxx digits string (tanpa 0/+62 prefix). Atau raw kalau invalid. */
  phone: string
  isValid: boolean
  reason?: PhoneInvalidReason
}

/**
 * Defensive phone normalizer. Detects Excel scientific notation corruption
 * ("6.28781E+12") plus length/format anomalies.
 *
 * INPUT: unknown — XLSX number, CSV string, atau null.
 * OUTPUT: discriminated union dengan isValid flag.
 *
 * Engine inbound pakai ini setelah applyMappings untuk route invalid phones
 * ke `inbox_invalid_phone` tabel untuk manual review.
 */
export function normalize_phone_id_safe(raw: unknown): PhoneNormalizeResult {
  if (raw == null || raw === '') {
    return { phone: '', isValid: false, reason: 'empty' }
  }

  // CASE 1: XLSX integer (e.g. 6287808123771)
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { phone: String(raw), isValid: false, reason: 'non_numeric' }
    }
    const str = String(Math.trunc(raw))
    if (str.length < 10) return { phone: str, isValid: false, reason: 'too_short' }
    if (str.length > 15) return { phone: str, isValid: false, reason: 'too_long' }
    return { phone: normalizeIndonesianPhone(str), isValid: true }
  }

  // CASE 2: String — bisa scientific notation, plain digits, atau dengan separator
  if (typeof raw === 'string') {
    const trimmed = raw.trim()

    // CRITICAL: detect scientific notation (Excel CSV corruption pattern)
    // Examples: "6.28781E+12", "6.28e+12", "6.2E12", "1.2345E10"
    if (/^\d+(?:\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
      return { phone: trimmed, isValid: false, reason: 'scientific_notation' }
    }

    const digits = trimmed.replace(/\D/g, '')
    if (digits.length === 0) {
      return { phone: trimmed, isValid: false, reason: 'non_numeric' }
    }
    if (digits.length < 10) return { phone: digits, isValid: false, reason: 'too_short' }
    if (digits.length > 15) return { phone: digits, isValid: false, reason: 'too_long' }
    return { phone: normalizeIndonesianPhone(digits), isValid: true }
  }

  return { phone: String(raw), isValid: false, reason: 'non_numeric' }
}

/**
 * Canonicalize digit-only string ke 8xxxxxxxxx (strip 62 / 0 prefix).
 * "08123456789" → "8123456789"
 * "628123456789" → "8123456789"
 * Brief #8: strip iteratif — double-prefix "62085..." → "85..." (bukan "085...").
 */
function normalizeIndonesianPhone(digits: string): string {
  let d = digits
  if (d.startsWith('62')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  return d
}

// =============================================================
// Runtime application (preview only — Phase 3 engine may diverge)
// =============================================================

export type TransformResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string }

/**
 * Optional context passed to context-aware transforms (concat_address, sum_qty).
 * Engine populates this; preview leaves it undefined → those transforms fall back to raw.
 */
export interface TransformContext {
  orders?: Record<string, unknown>
  order_items?: Array<Record<string, unknown>>
}

export function applyTransform(
  key: string | null | undefined,
  raw: unknown,
  ctx?: TransformContext
): TransformResult {
  if (!key || key.trim() === '') return { ok: true, value: raw }
  const def = getTransform(key)
  if (!def) return { ok: false, reason: `Unknown transform "${key}"` }
  if (!def.available) return { ok: false, reason: `Transform "${key}" belum diimplementasi di preview (Phase 3)` }

  const s = raw == null ? '' : String(raw)
  try {
    switch (key as TransformKey) {
      case 'trim':
        return { ok: true, value: s.trim() }
      case 'uppercase':
        return { ok: true, value: s.toUpperCase() }
      case 'lowercase':
        return { ok: true, value: s.toLowerCase() }
      case 'normalize_phone_id': {
        // Phase 8G — defensive: detect scientific notation corruption dari Excel CSV export.
        // Pattern: "6.28781E+12" / "6.28e+12" → tetap return raw value supaya engine
        // bisa detect invalid via normalize_phone_id_safe & route ke inbox_invalid_phone.
        const safe = normalize_phone_id_safe(raw)
        if (!safe.isValid) {
          // Return raw string untuk preserve evidence di customer_phone.
          // Engine layer akan call normalize_phone_id_safe lagi & route ke inbox.
          return { ok: true, value: safe.phone }
        }
        // Canonical 08xxx format untuk display di GrandBook (mirror behavior lama)
        const noPrefix = safe.phone  // already 8xxxxx after normalizeIndonesianPhone
        return { ok: true, value: '0' + noPrefix }
      }
      case 'phone_to_628': {
        const digits = s.replace(/\D/g, '')
        if (!digits) return { ok: true, value: '' }
        if (digits.startsWith('62')) return { ok: true, value: digits }
        if (digits.startsWith('0')) return { ok: true, value: '62' + digits.slice(1) }
        if (digits.startsWith('8')) return { ok: true, value: '62' + digits }
        return { ok: true, value: digits }
      }
      case 'numeric_or_zero': {
        if (s === '' || s === '-') return { ok: true, value: 0 }
        const cleaned = s.replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '')
        const n = Number(cleaned)
        return { ok: true, value: Number.isFinite(n) ? n : 0 }
      }
      case 'numeric_or_null': {
        if (s === '' || s === '-') return { ok: true, value: null }
        const cleaned = s.replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '')
        const n = Number(cleaned)
        return { ok: true, value: Number.isFinite(n) ? n : null }
      }
      case 'numeric_id_currency': {
        // Indonesian currency format: "Rp 140.000" → 140000 (. = thousand sep, , = decimal sep)
        // Generic numeric_or_zero salah karena treat "." sebagai JS decimal point.
        if (s === '' || s === '-') return { ok: true, value: 0 }
        // Strip non-digit/separator chars (Rp, spaces, etc)
        let cleaned = s.replace(/[^\d.,\-]/g, '')
        // Strip thousand seps (.), convert decimal sep (,) → JS decimal (.)
        cleaned = cleaned.replace(/\./g, '').replace(',', '.')
        const n = Number(cleaned)
        return { ok: true, value: Number.isFinite(n) ? n : 0 }
      }
      case 'null_if_empty': {
        const trimmed = s.trim()
        return { ok: true, value: trimmed.length === 0 ? null : trimmed }
      }
      case 'split_csv_to_array': {
        if (!s || s.trim() === '') return { ok: true, value: [] }
        const arr = s.split(',').map(p => p.trim()).filter(p => p.length > 0)
        return { ok: true, value: arr }
      }
      case 'kg_format': {
        const n = Number(s.replace(/,/g, '.'))
        if (!Number.isFinite(n)) return { ok: false, reason: `Tidak bisa parse "${s}" sebagai angka` }
        return { ok: true, value: n.toFixed(1) }
      }
      case 'parse_date_dd-mm-yyyy': {
        // accepts "DD-MM-YYYY" or "DD-MM-YYYY - HH:MM" or "DD/MM/YYYY"
        const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s*-\s*(\d{1,2}):(\d{2})(?::(\d{1,2}))?)?$/)
        if (!m) return { ok: false, reason: `Format tidak cocok DD-MM-YYYY: "${s}"` }
        const [, d, mo, y, hh = '0', mm = '0', ss = '0'] = m
        const date = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss))
        if (isNaN(date.getTime())) return { ok: false, reason: `Invalid date "${s}"` }
        return { ok: true, value: date.toISOString() }
      }
      case 'parse_datetime_yyyy-mm-dd': {
        // accepts "YYYY/MM/DD HH:MM:SS" or "YYYY-MM-DD HH:MM:SS"
        const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{1,2}))?)?$/)
        if (!m) return { ok: false, reason: `Format tidak cocok YYYY-MM-DD: "${s}"` }
        const [, y, mo, d, hh = '0', mm = '0', ss = '0'] = m
        const date = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss))
        if (isNaN(date.getTime())) return { ok: false, reason: `Invalid datetime "${s}"` }
        return { ok: true, value: date.toISOString() }
      }
      case 'concat_address': {
        const o = ctx?.orders || {}
        const parts = [
          o.customer_address_detail,
          o.customer_village,
          o.customer_subdistrict,
          o.customer_city,
          o.customer_province,
        ]
          .map((p) => (p == null ? '' : String(p).trim()))
          .filter((p) => p.length > 0)
        const zip = o.customer_zip != null ? String(o.customer_zip).trim() : ''
        let result = parts.join(', ')
        if (zip) result += ` ${zip}`
        return { ok: true, value: result }
      }
      case 'sum_qty': {
        const items = ctx?.order_items || []
        const total = items.reduce((acc, it) => {
          const q = Number(it?.qty ?? 0)
          return acc + (Number.isFinite(q) ? q : 0)
        }, 0)
        return { ok: true, value: total }
      }
      default:
        return { ok: false, reason: `Transform "${key}" belum diimplementasi di preview (Phase 3)` }
    }
  } catch (err) {
    return { ok: false, reason: getErrorMessage(err) }
  }
}
