import { z } from 'zod'
import type { UserRole } from '@/lib/types'

/**
 * Phase 8E — Whitelist field yang boleh di-inline-edit di /orders/list.
 *
 * - operational: status, priority, resi, notes, tags, alamat dasar, kontak
 * - financial: subtotal, shipping_cost, discount, total (admin notif ke owner)
 * - blocked (selalu lewat RPC): shipping_cost_actual, payout_amount, cod_amount
 *
 * Tipe data + Zod schema per-field. Validasi value sebelum kirim ke DB.
 */

export const OPERATIONAL_FIELDS = [
  'status',
  'priority',
  'resi',
  'internal_note',
  'customer_note',
  'tags',
  'cs_attempts',
  'last_contact_at',
  'reject_reason',
  'customer_phone',
  'customer_city',
  'customer_province',
] as const

export const FINANCIAL_FIELDS = [
  'subtotal',
  'shipping_cost',
  'discount',
  'total',
] as const

export type OperationalField = (typeof OPERATIONAL_FIELDS)[number]
export type FinancialField = (typeof FINANCIAL_FIELDS)[number]
export type EditableField = OperationalField | FinancialField

const ORDER_STATUSES = ['BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE'] as const
const PRIORITIES = ['LOW','NORMAL','URGENT'] as const

/**
 * Per-field Zod schema. Pakai parse() untuk validate. Default lax string-trim.
 */
export const FIELD_SCHEMAS = {
  status:           z.enum(ORDER_STATUSES),
  priority:         z.enum(PRIORITIES),
  resi:             z.string().max(80).nullable(),
  internal_note:    z.string().max(2000).nullable(),
  customer_note:    z.string().max(2000).nullable(),
  reject_reason:    z.string().max(500).nullable(),
  tags:             z.array(z.string().max(40)).max(20),
  cs_attempts:      z.number().int().min(0).max(99),
  last_contact_at:  z.string().nullable(), // ISO timestamp or null
  customer_phone:   z.string().max(40).nullable(),
  customer_city:    z.string().max(120).nullable(),
  customer_province: z.string().max(120).nullable(),
  subtotal:         z.number().min(0),
  shipping_cost:    z.number().min(0),
  discount:         z.number().min(0),
  total:            z.number().min(0),
} satisfies Record<EditableField, z.ZodTypeAny>

export function isEditableField(field: string): field is EditableField {
  return (OPERATIONAL_FIELDS as readonly string[]).includes(field)
      || (FINANCIAL_FIELDS as readonly string[]).includes(field)
}

export function isFinancialField(field: string): field is FinancialField {
  return (FINANCIAL_FIELDS as readonly string[]).includes(field)
}

/**
 * Apakah role tertentu boleh edit field tertentu.
 * Reference: brief Phase 8E section "Permission Matrix"
 *
 * - owner: edit semua (operational + financial). Bypass.
 * - admin: edit operational + financial (notif ke owner via trigger DB).
 * - cs: HANYA status + internal_note.
 * - advertiser: ❌ tidak boleh inline edit apapun.
 * - akunting: ❌ tidak boleh inline edit apapun di list (financial via /reconciliation).
 *
 * Catatan: `shipping_cost_actual` & `payout_amount` BUKAN field inline-editable
 * (tidak ada di OPERATIONAL_FIELDS / FINANCIAL_FIELDS) — DB trigger block direct UPDATE.
 */
export function canEditField(role: UserRole | null | undefined, field: EditableField): boolean {
  if (!role) return false
  if (role === 'owner') return true
  if (role === 'admin') return true
  if (role === 'cs') {
    return field === 'status' || field === 'internal_note'
  }
  // advertiser, akunting: no inline edit
  return false
}

/**
 * Validate + coerce value untuk field tertentu. Throws kalau invalid.
 */
export function validateFieldValue(field: EditableField, value: unknown): unknown {
  const schema = FIELD_SCHEMAS[field]
  return schema.parse(value)
}
