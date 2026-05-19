/**
 * Phase 8E — Definisi kolom available di /orders/list.
 *
 * Setiap kolom punya:
 * - id: kunci unik (sama dengan field di OrderEnriched)
 * - label: display name di header + customizer
 * - category: untuk grouping di Sheet customizer
 * - default_visible: tampil di-system-default (sebelum user/team override)
 * - default_width: lebar default (px)
 * - editable_field: kalau cell inline-editable, isi field name (whitelist)
 *
 * Default visible sesuai brief section 6.7:
 *   order_date, order_number, resi, status, priority, customer_name,
 *   customer_city, total, supplier_name, cs_name, campaign_name,
 *   days_in_status, actions
 */

import type { EditableField } from '@/lib/schemas/order-update'

export type ColumnCategory =
  | 'identity'
  | 'customer'
  | 'product'
  | 'pricing'
  | 'profit'
  | 'status_flow'
  | 'people'
  | 'marketing'
  | 'supplier'
  | 'tags_notes'
  | 'timestamps'
  | 'actions'

export const CATEGORY_LABEL: Record<ColumnCategory, string> = {
  identity:    'Identitas',
  customer:    'Customer',
  product:     'Produk',
  pricing:     'Harga',
  profit:      'Profit (Computed)',
  status_flow: 'Status & Flow',
  people:      'People',
  marketing:   'Marketing',
  supplier:    'Supplier',
  tags_notes:  'Tags & Notes',
  timestamps:  'Timestamps',
  actions:     'Aksi',
}

export interface ColumnDef {
  id: string
  label: string
  category: ColumnCategory
  default_visible: boolean
  default_width: number
  /** Kalau ada → cell inline-editable, value = field name di whitelist */
  editable_field?: EditableField
  align?: 'left' | 'right' | 'center'
  /** Numeric / currency formatter di table */
  format?: 'rupiah' | 'number' | 'date' | 'datetime' | 'percent'
}

export const COLUMNS: ColumnDef[] = [
  // === Identity ===
  { id: 'order_date',        label: 'Tanggal',     category: 'identity',    default_visible: true,  default_width: 100, format: 'date' },
  { id: 'order_number',      label: 'Order #',     category: 'identity',    default_visible: true,  default_width: 150 },
  { id: 'external_order_id', label: 'External ID', category: 'identity',    default_visible: false, default_width: 150 },
  // Phase 8I-Followup hotfix: SPX resi format "SPXID" + 12 digit = 17 char.
  // 180px = ~17 char × ~7px (font-mono text-xs) + edit icon + padding.
  { id: 'resi',              label: 'Resi',        category: 'identity',    default_visible: true,  default_width: 180, editable_field: 'resi' },
  { id: 'payment_method',    label: 'Pembayaran',  category: 'identity',    default_visible: false, default_width: 100 },

  // === Customer ===
  { id: 'customer_name',     label: 'Customer',    category: 'customer',    default_visible: true,  default_width: 180 },
  { id: 'customer_phone',    label: 'No HP',       category: 'customer',    default_visible: false, default_width: 140, editable_field: 'customer_phone' },

  // === Product (Phase 8I-Followup Part 2) — posisi reading order setelah customer ===
  { id: 'product_summary',   label: 'Produk',      category: 'product',     default_visible: true,  default_width: 200 },
  { id: 'product_count',     label: 'Item Lines',  category: 'product',     default_visible: false, default_width: 80,  align: 'right', format: 'number' },
  { id: 'total_qty',         label: 'Total Qty',   category: 'product',     default_visible: false, default_width: 80,  align: 'right', format: 'number' },

  // Phase 8I-Followup hotfix: max kota di Indonesia "KAB. PENAJAM PASER UTARA" (24 char).
  // Truncate dengan tooltip kalau lebih panjang dari ~180px (sekitar 23-24 char text-xs).
  { id: 'customer_city',     label: 'Kota',        category: 'customer',    default_visible: true,  default_width: 180, editable_field: 'customer_city' },
  { id: 'customer_province', label: 'Provinsi',    category: 'customer',    default_visible: false, default_width: 130, editable_field: 'customer_province' },
  { id: 'is_repeat_customer', label: 'Repeat?',    category: 'customer',    default_visible: false, default_width: 80 },

  // === Pricing ===
  { id: 'subtotal',          label: 'Subtotal',    category: 'pricing',     default_visible: false, default_width: 120, align: 'right', format: 'rupiah', editable_field: 'subtotal' },
  { id: 'discount',          label: 'Diskon',      category: 'pricing',     default_visible: false, default_width: 100, align: 'right', format: 'rupiah', editable_field: 'discount' },
  { id: 'shipping_cost',     label: 'Ongkir',      category: 'pricing',     default_visible: false, default_width: 100, align: 'right', format: 'rupiah', editable_field: 'shipping_cost' },
  // Phase 8I-Followup hotfix: 130px untuk gap dari city + breathing room rupiah ("Rp 196.350").
  { id: 'total',             label: 'Total',       category: 'pricing',     default_visible: true,  default_width: 130, align: 'right', format: 'rupiah', editable_field: 'total' },
  { id: 'shipping_cost_actual', label: 'Ongkir Aktual', category: 'pricing', default_visible: false, default_width: 120, align: 'right', format: 'rupiah' },
  { id: 'payout_amount',     label: 'Payout',      category: 'pricing',     default_visible: false, default_width: 120, align: 'right', format: 'rupiah' },

  // === Profit (Computed) ===
  { id: 'estimated_profit',  label: 'Est. Profit', category: 'profit',      default_visible: false, default_width: 110, align: 'right', format: 'rupiah' },
  { id: 'actual_profit',     label: 'Profit Aktual', category: 'profit',    default_visible: false, default_width: 110, align: 'right', format: 'rupiah' },
  { id: 'profit_margin_pct', label: 'Margin %',    category: 'profit',      default_visible: false, default_width: 90,  align: 'right', format: 'percent' },
  { id: 'shipping_diff',     label: 'Selisih Ongkir', category: 'profit',   default_visible: false, default_width: 110, align: 'right', format: 'rupiah' },

  // === Status & Flow ===
  // Phase 8I-Followup hotfix (2nd iter): 150px — 130px masih bikin "Siap Kirim" terpotong jadi "Siap K"
  // karena SelectTrigger chevron + padding makan ~32px, badge "Siap Kirim" butuh ~80px = total 130px tight.
  { id: 'status',            label: 'Status',      category: 'status_flow', default_visible: true,  default_width: 150, editable_field: 'status' },
  { id: 'priority',          label: 'Prioritas',   category: 'status_flow', default_visible: true,  default_width: 90,  editable_field: 'priority' },
  { id: 'days_in_status',    label: 'Hari Status', category: 'status_flow', default_visible: true,  default_width: 90,  align: 'right' },

  // === People ===
  { id: 'cs_name',           label: 'CS',          category: 'people',      default_visible: true,  default_width: 130 },
  { id: 'advertiser_name',   label: 'Advertiser',  category: 'people',      default_visible: false, default_width: 130 },
  { id: 'cs_attempts',       label: 'CS Attempt',  category: 'people',      default_visible: false, default_width: 80,  align: 'right', format: 'number', editable_field: 'cs_attempts' },

  // === Marketing ===
  { id: 'campaign_name',     label: 'Campaign',    category: 'marketing',   default_visible: true,  default_width: 150 },
  { id: 'channel_name',      label: 'Channel',     category: 'marketing',   default_visible: false, default_width: 130 },

  // === Supplier ===
  { id: 'supplier_name',     label: 'Supplier',    category: 'supplier',    default_visible: true,  default_width: 130 },
  { id: 'is_multi_origin',   label: 'Multi-Origin', category: 'supplier',   default_visible: false, default_width: 100 },

  // === Tags & Notes ===
  { id: 'tags',              label: 'Tags',        category: 'tags_notes',  default_visible: false, default_width: 150, editable_field: 'tags' },
  { id: 'internal_note',     label: 'Catatan Internal', category: 'tags_notes', default_visible: false, default_width: 200, editable_field: 'internal_note' },
  { id: 'customer_note',     label: 'Catatan Customer', category: 'tags_notes', default_visible: false, default_width: 200, editable_field: 'customer_note' },
  { id: 'reject_reason',     label: 'Alasan Reject', category: 'tags_notes', default_visible: false, default_width: 180 },

  // === Timestamps ===
  { id: 'resi_printed_at',   label: 'Resi Dicetak', category: 'timestamps', default_visible: false, default_width: 140, format: 'datetime' },
  { id: 'picked_up_at',      label: 'Di-pickup',    category: 'timestamps', default_visible: false, default_width: 140, format: 'datetime' },
  { id: 'delivered_at',      label: 'Diterima At',  category: 'timestamps', default_visible: false, default_width: 140, format: 'datetime' },
  { id: 'returned_at',       label: 'Retur At',     category: 'timestamps', default_visible: false, default_width: 140, format: 'datetime' },
  { id: 'last_contact_at',   label: 'Kontak Terakhir', category: 'timestamps', default_visible: false, default_width: 140, format: 'datetime', editable_field: 'last_contact_at' },
  { id: 'status_changed_at', label: 'Status Berubah', category: 'timestamps', default_visible: false, default_width: 140, format: 'datetime' },
  { id: 'created_at',        label: 'Dibuat',       category: 'timestamps', default_visible: false, default_width: 140, format: 'datetime' },
  { id: 'updated_at',        label: 'Diupdate',     category: 'timestamps', default_visible: false, default_width: 140, format: 'datetime' },

  // === Actions (always at the end) ===
  { id: 'actions',           label: 'Aksi',         category: 'actions',    default_visible: true,  default_width: 60, align: 'center' },
]

/** Map id → ColumnDef untuk lookup cepat */
export const COLUMNS_BY_ID: Record<string, ColumnDef> = Object.fromEntries(
  COLUMNS.map(c => [c.id, c])
)

/** System default visibility (sebelum override user/team) */
export const SYSTEM_DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  COLUMNS.map(c => [c.id, c.default_visible])
)

/** System default order (sesuai urutan di COLUMNS array) */
export const SYSTEM_DEFAULT_ORDER: string[] = COLUMNS.map(c => c.id)

/** System default widths */
export const SYSTEM_DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map(c => [c.id, c.default_width])
)

/** Group columns by category untuk display di customizer */
export function groupByCategory(): Record<ColumnCategory, ColumnDef[]> {
  const map = {} as Record<ColumnCategory, ColumnDef[]>
  for (const c of COLUMNS) {
    if (!map[c.category]) map[c.category] = []
    map[c.category].push(c)
  }
  return map
}

/**
 * Phase 8I-Followup Fix 2 (4-quick-fixes) — merge new system columns into user's
 * saved column_order at their NATURAL position (bukan append ke akhir).
 *
 * Algorithm: untuk tiap missing column dari userOrder yang ada di systemOrder,
 * cari anchor = kolom terdekat SEBELUMNYA di systemOrder yang juga ada di
 * userOrder. Insert AFTER anchor itu di result. Kalau ga ada anchor (mis. new
 * column ada di posisi 0 systemOrder dan user belum punya), insert di awal.
 *
 * Contoh untuk product_summary (sysIdx 7, antara customer_phone & customer_city):
 *   - Anchor = customer_phone (sysIdx 6) kalau user punya — insert setelahnya
 *   - Fallback ke customer_name (sysIdx 5) — insert setelahnya
 *   - User visibility setting tetap respected — order != visibility
 */
export function mergeNewColumnsByAnchor(userOrder: string[], systemOrder: string[]): string[] {
  const userSet = new Set(userOrder)
  const result = [...userOrder]
  const inserted = new Set<string>()

  for (let sysIdx = 0; sysIdx < systemOrder.length; sysIdx++) {
    const id = systemOrder[sysIdx]
    if (userSet.has(id) || inserted.has(id)) continue

    // Find latest anchor SEBELUM id di systemOrder yang ada di result
    let anchorPosInResult = -1
    for (let i = sysIdx - 1; i >= 0; i--) {
      const anchorId = systemOrder[i]
      const pos = result.indexOf(anchorId)
      if (pos >= 0) {
        anchorPosInResult = pos
        break
      }
    }

    if (anchorPosInResult >= 0) {
      // Insert AFTER anchor
      result.splice(anchorPosInResult + 1, 0, id)
    } else {
      // No anchor (new column di prefix systemOrder) → insert di awal
      result.unshift(id)
    }
    inserted.add(id)
  }
  return result
}
