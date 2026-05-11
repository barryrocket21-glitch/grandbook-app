import { z } from 'zod'
import type {
  OrderStatus,
  CommissionV2Status,
  BillingModel,
  CodFeeBase,
  CodFeeRounding,
  PpnAppliedTo,
  OperationalExpenseCategory,
  RecurrencePeriod,
} from '@/lib/types'

// =============================================================
// Couriers
// =============================================================
export const courierSchema = z.object({
  code: z.string().min(2).max(20).regex(/^[A-Z0-9_]+$/, 'Code harus uppercase + alphanumeric/underscore'),
  name: z.string().min(1, 'Nama wajib diisi'),
  active: z.boolean().default(true),
})
export type CourierFormData = z.infer<typeof courierSchema>

// =============================================================
// Courier Channels
// =============================================================
export const channelSchema = z.object({
  courier_id: z.number().int().positive('Pilih courier'),
  code: z.string().min(3).max(40).regex(/^[A-Z0-9_]+$/, 'Code harus uppercase + alphanumeric/underscore'),
  name: z.string().min(1, 'Nama wajib diisi'),
  aggregator: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  active: z.boolean().default(true),
})
export type ChannelFormData = z.infer<typeof channelSchema>

// =============================================================
// Courier Channel Rates
// =============================================================
export const RATE_KEY_PRESETS = [
  'fee_cod_percent',
  'cashback_ongkir_percent',
  'fee_rts_amount',
  'cashback_rts_percent',
  'insurance_fee_percent',
  'fee_pickup_amount',
] as const

export const rateSchema = z.object({
  channel_id: z.number().int().positive('Pilih channel'),
  rate_key: z.string().min(1, 'Rate key wajib diisi').regex(/^[a-z0-9_]+$/, 'Gunakan lowercase + underscore'),
  rate_value: z.number().min(0, 'Nilai harus >= 0'),
  effective_from: z.string().min(1, 'Tanggal mulai wajib diisi'),
  effective_to: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})
export type RateFormData = z.infer<typeof rateSchema>

// =============================================================
// Status Mapping
// =============================================================
export const INTERNAL_STATUSES: OrderStatus[] = [
  'BARU', 'SIAP_KIRIM', 'DIKIRIM', 'DITERIMA', 'PROBLEM', 'RETUR', 'CANCEL', 'FAKE',
]

export const statusMappingSchema = z.object({
  channel_id: z.number().int().positive('Pilih channel'),
  raw_status: z.string().min(1, 'Raw status wajib diisi'),
  internal_status: z.enum(['BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE']),
  notes: z.string().nullable().optional(),
})
export type StatusMappingFormData = z.infer<typeof statusMappingSchema>

// =============================================================
// UI helpers
// =============================================================
export const STATUS_BADGE_COLOR: Record<OrderStatus, string> = {
  BARU: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  SIAP_KIRIM: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  DIKIRIM: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  DITERIMA: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  PROBLEM: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  RETUR: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  CANCEL: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30',
  FAKE: 'bg-red-500/10 text-red-600 border-red-500/30',
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  BARU: 'Baru',
  SIAP_KIRIM: 'Siap Kirim',
  DIKIRIM: 'Dikirim',
  DITERIMA: 'Diterima',
  PROBLEM: 'Problem',
  RETUR: 'Retur',
  CANCEL: 'Cancel',
  FAKE: 'Fake',
}

export function formatRateValue(key: string, value: number): string {
  if (key.includes('percent')) return `${value}%`
  if (key.includes('amount')) return `Rp ${value.toLocaleString('id-ID')}`
  return String(value)
}

// =============================================================
// Converter Profiles (Phase 2B)
// =============================================================
export const CONVERTER_DIRECTIONS = [
  'INBOUND_ORDER',
  'INBOUND_REKONSIL',
  'OUTBOUND_TO_COURIER',
  'WA_PASTE',
] as const
export type ConverterDirectionEnum = (typeof CONVERTER_DIRECTIONS)[number]

export const CONVERTER_FILE_FORMATS = ['CSV', 'XLSX', 'TEXT'] as const
export type ConverterFileFormatEnum = (typeof CONVERTER_FILE_FORMATS)[number]

export const CONVERTER_PRIMARY_KEY_TARGETS = ['external_order_id', 'resi', 'order_number'] as const
export const CONVERTER_TARGET_TABLES = ['orders', 'order_items', 'meta', 'file_column'] as const
export type ConverterTargetTableEnum = (typeof CONVERTER_TARGET_TABLES)[number]

export const DIRECTION_BADGE_COLOR: Record<ConverterDirectionEnum, string> = {
  INBOUND_ORDER: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  INBOUND_REKONSIL: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  OUTBOUND_TO_COURIER: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  WA_PASTE: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
}

export const DIRECTION_LABEL: Record<ConverterDirectionEnum, string> = {
  INBOUND_ORDER: 'Inbound Order',
  INBOUND_REKONSIL: 'Inbound Rekonsil',
  OUTBOUND_TO_COURIER: 'Outbound to Courier',
  WA_PASTE: 'WA Paste',
}

export const TARGET_TABLE_BADGE_COLOR: Record<ConverterTargetTableEnum, string> = {
  orders: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  order_items: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  meta: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30',
  file_column: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
}

export const converterProfileSchema = z
  .object({
    code: z
      .string()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9_]+$/, 'Code harus lowercase + alphanumeric/underscore'),
    name: z.string().min(1, 'Nama wajib diisi'),
    direction: z.enum(CONVERTER_DIRECTIONS),
    source_or_target: z.string().min(1, 'Source/target wajib diisi'),
    channel_id: z.number().int().positive().nullable().optional(),
    file_format: z.enum(CONVERTER_FILE_FORMATS),
    file_delimiter: z.string().nullable().optional(),
    file_encoding: z.string().default('utf-8'),
    has_header_row: z.boolean().default(true),
    header_row_index: z.number().int().min(1).max(10).default(1),
    primary_key_field: z.string().nullable().optional(),
    primary_key_target: z.enum(CONVERTER_PRIMARY_KEY_TARGETS).nullable().optional(),
    regex_pattern: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    active: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.direction === 'WA_PASTE') {
      if (!data.regex_pattern || data.regex_pattern.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['regex_pattern'],
          message: 'Regex pattern wajib diisi untuk WA_PASTE',
        })
      }
      if (data.file_format !== 'TEXT') {
        ctx.addIssue({
          code: 'custom',
          path: ['file_format'],
          message: 'WA_PASTE harus pakai file_format = TEXT',
        })
      }
    }
    if (
      (data.direction === 'INBOUND_REKONSIL' || data.direction === 'OUTBOUND_TO_COURIER') &&
      !data.channel_id
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['channel_id'],
        message: 'Channel wajib dipilih untuk Rekonsil / Outbound',
      })
    }
  })
export type ConverterProfileFormData = z.infer<typeof converterProfileSchema>

// =============================================================
// Field Mappings (per profile)
// =============================================================
export const fieldMappingSchema = z.object({
  source_field: z.string().min(1, 'Source field wajib diisi'),
  target_field: z.string().min(1, 'Target field wajib diisi'),
  target_table: z.enum(CONVERTER_TARGET_TABLES),
  transform: z.string().nullable().optional(),
  required: z.boolean().default(false),
  display_order: z.number().int().min(0).default(0),
  notes: z.string().nullable().optional(),
})
export type FieldMappingFormData = z.infer<typeof fieldMappingSchema>

// =============================================================
// Value Mappings (per profile)
// =============================================================
export const valueMappingSchema = z.object({
  source_field: z.string().min(1, 'Source field wajib diisi'),
  raw_value: z.string().min(1, 'Raw value wajib diisi'),
  mapped_value: z.string().min(1, 'Mapped value wajib diisi'),
  notes: z.string().nullable().optional(),
})
export type ValueMappingFormData = z.infer<typeof valueMappingSchema>

// =============================================================
// Inbox Resolution
// =============================================================
export const inboxResolveSchema = z.object({
  resolution: z.enum(['linked', 'ignored', 'created_new']),
  resolved_to_order_id: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
})
export type InboxResolveFormData = z.infer<typeof inboxResolveSchema>

// =============================================================
// Phase 3A — Manual Order Input
// =============================================================
export const PAYMENT_METHOD_VALUES = ['COD', 'TRANSFER'] as const
export type PaymentMethodEnum = (typeof PAYMENT_METHOD_VALUES)[number]

export const orderItemSchema = z.object({
  product_id: z.number().int().positive().nullable().optional(),
  product_name_raw: z.string().min(1, 'Nama produk wajib diisi'),
  variation: z.string().nullable().optional(),
  qty: z.number().int().min(1, 'Qty minimal 1'),
  price: z.number().min(0, 'Harga harus >= 0'),
  weight_per_unit: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
})
export type OrderItemFormData = z.infer<typeof orderItemSchema>

export const orderInputSchema = z.object({
  customer_name: z.string().min(1, 'Nama customer wajib diisi'),
  customer_phone: z.string().nullable().optional(),
  customer_province: z.string().nullable().optional(),
  customer_city: z.string().nullable().optional(),
  customer_subdistrict: z.string().nullable().optional(),
  customer_village: z.string().nullable().optional(),
  customer_zip: z.string().nullable().optional(),
  customer_address_detail: z.string().nullable().optional(),
  wilayah_id: z.number().int().positive().nullable().optional(),

  channel_id: z.number().int().positive('Channel wajib dipilih'),

  subtotal: z.number().min(0).default(0),
  shipping_cost: z.number().min(0).default(0),
  discount: z.number().min(0).default(0),
  total: z.number().min(0).default(0),
  payment_method: z.enum(PAYMENT_METHOD_VALUES),

  cs_name: z.string().nullable().optional(),
  cs_id: z.string().nullable().optional(),
  advertiser_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),

  items: z.array(orderItemSchema).min(1, 'Minimal 1 item'),
})
export type OrderInputFormData = z.infer<typeof orderInputSchema>

/**
 * Phone normalization to 08xxx (ID format).
 * Used in form input + engine.
 */
export function normalizePhoneId(input: string | null | undefined): string {
  if (!input) return ''
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('62')) return '0' + digits.slice(2)
  if (digits.startsWith('8')) return '0' + digits
  if (digits.startsWith('0')) return digits
  return digits
}

// =============================================================
// Phase 4A — Commission Payment (mark paid dialog)
// =============================================================
export const COMMISSION_PAYMENT_METHODS = ['TRANSFER', 'CASH', 'OTHER'] as const
export type CommissionPaymentMethodEnum = (typeof COMMISSION_PAYMENT_METHODS)[number]

export const COMMISSION_PAYMENT_METHOD_LABEL: Record<CommissionPaymentMethodEnum, string> = {
  TRANSFER: 'Transfer Bank',
  CASH: 'Cash',
  OTHER: 'Lainnya',
}

export const commissionPaymentSchema = z.object({
  payment_method: z.enum(COMMISSION_PAYMENT_METHODS),
  payment_reference: z.string().max(120).nullable().optional(),
  payment_note: z.string().max(500).nullable().optional(),
})
export type CommissionPaymentFormData = z.infer<typeof commissionPaymentSchema>

export const COMMISSION_STATUS_LABEL: Record<CommissionV2Status, string> = {
  ESTIMATED: 'Estimated',
  EARNED: 'Earned',
  CANCELLED: 'Cancelled',
  PAID: 'Paid',
}

export const COMMISSION_STATUS_BADGE_COLOR: Record<CommissionV2Status, string> = {
  ESTIMATED: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  EARNED: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  CANCELLED: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30',
  PAID: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
}

// =============================================================
// Phase 4C — Billing Models + Channel Billing Config
// =============================================================
export const BILLING_MODELS = [
  'MONTHLY_INVOICE',
  'NETT_OFF_PER_ORDER',
  'DIRECT_TRANSFER',
  'NO_RECONCILIATION',
] as const satisfies readonly BillingModel[]

export const BILLING_MODEL_LABEL: Record<BillingModel, string> = {
  MONTHLY_INVOICE: 'Monthly Invoice (SPX style — COD cair full, tagihan bulan depan)',
  NETT_OFF_PER_ORDER: 'Nett-Off Per Order (Mengantar style — cair = COD - cost)',
  DIRECT_TRANSFER: 'Direct Transfer (customer transfer langsung ke merchant)',
  NO_RECONCILIATION: 'No Reconciliation (skip cost compute)',
}

export const BILLING_MODEL_SHORT: Record<BillingModel, string> = {
  MONTHLY_INVOICE: 'Monthly Invoice',
  NETT_OFF_PER_ORDER: 'Nett-Off',
  DIRECT_TRANSFER: 'Direct Transfer',
  NO_RECONCILIATION: 'No Reconciliation',
}

export const COD_FEE_BASE_OPTIONS = [
  'NOMINAL_COD',
  'BARANG_PLUS_ONGKIR_GROSS',
  'BARANG_PLUS_ONGKIR_NET',
] as const satisfies readonly CodFeeBase[]

export const COD_FEE_BASE_LABEL: Record<CodFeeBase, string> = {
  NOMINAL_COD: 'Nominal COD (total order)',
  BARANG_PLUS_ONGKIR_GROSS: 'Barang + Ongkir Gross',
  BARANG_PLUS_ONGKIR_NET: 'Barang + Ongkir Net (setelah cashback)',
}

export const COD_FEE_ROUNDING_OPTIONS = ['FLOOR', 'ROUND', 'CEIL'] as const satisfies readonly CodFeeRounding[]

export const COD_FEE_ROUNDING_LABEL: Record<CodFeeRounding, string> = {
  FLOOR: 'Floor (round down — SPX)',
  ROUND: 'Round (nearest)',
  CEIL: 'Ceil (round up)',
}

export const PPN_APPLIED_OPTIONS = ['COD_FEE_ONLY', 'COD_FEE_PLUS_SHIPPING', 'NONE'] as const satisfies readonly PpnAppliedTo[]

export const PPN_APPLIED_LABEL: Record<PpnAppliedTo, string> = {
  COD_FEE_ONLY: 'PPN over Fee COD only (SPX default)',
  COD_FEE_PLUS_SHIPPING: 'PPN over Fee COD + Shipping Net',
  NONE: 'No PPN',
}

export const channelBillingConfigSchema = z.object({
  channel_id: z.number().int().positive('Channel wajib dipilih'),
  cod_fee_base: z.enum(COD_FEE_BASE_OPTIONS),
  cod_fee_rounding: z.enum(COD_FEE_ROUNDING_OPTIONS),
  ppn_applied_to: z.enum(PPN_APPLIED_OPTIONS),
  effective_from: z.string().min(1, 'Tanggal mulai wajib'),
  notes: z.string().nullable().optional(),
})
export type ChannelBillingConfigFormData = z.infer<typeof channelBillingConfigSchema>

/** Phase 4C numeric rate keys yang dipakai compute engine. */
export const PHASE4C_RATE_KEYS = ['shipping_discount_rate', 'cod_fee_rate', 'ppn_rate'] as const
export type Phase4cRateKey = (typeof PHASE4C_RATE_KEYS)[number]

export const PHASE4C_RATE_LABEL: Record<Phase4cRateKey, string> = {
  shipping_discount_rate: 'Cashback / Diskon Ongkir Rate',
  cod_fee_rate: 'Fee COD Rate',
  ppn_rate: 'PPN Rate',
}

// =============================================================
// Phase 5A — Product Categories + Products + Operational Expenses
// =============================================================
export const productCategorySchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(80),
  slug: z.string().min(1, 'Slug wajib diisi').regex(/^[a-z0-9\-]+$/, 'Slug harus lowercase + dash'),
  description: z.string().max(500).nullable().optional(),
  display_order: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
})
export type ProductCategoryFormData = z.infer<typeof productCategorySchema>

export const productSchema = z.object({
  sku: z.string().max(40).nullable().optional(),
  name: z.string().min(1, 'Nama wajib diisi').max(200),
  category_id: z.number().int().positive().nullable().optional(),
  variation: z.string().max(120).nullable().optional(),
  price_default: z.number().min(0, 'Harga harus >= 0'),
  hpp: z.number().min(0, 'HPP harus >= 0'),
  notes: z.string().max(1000).nullable().optional(),
  active: z.boolean().default(true),
})
export type ProductFormData = z.infer<typeof productSchema>

export const EXPENSE_CATEGORIES = [
  'GAJI',
  'SEWA',
  'UTILITY',
  'MARKETING',
  'OPERASIONAL',
  'PERLENGKAPAN',
  'PAJAK',
  'JASA',
  'LAIN_LAIN',
] as const satisfies readonly OperationalExpenseCategory[]

export const EXPENSE_CATEGORY_LABEL: Record<OperationalExpenseCategory, string> = {
  GAJI: 'Gaji Karyawan',
  SEWA: 'Sewa',
  UTILITY: 'Utility (Listrik/Air/Internet)',
  MARKETING: 'Marketing (non-paid ads)',
  OPERASIONAL: 'Operasional Rutin',
  PERLENGKAPAN: 'Perlengkapan / Alat',
  PAJAK: 'Pajak',
  JASA: 'Jasa Pihak Ketiga',
  LAIN_LAIN: 'Lain-Lain',
}

export const EXPENSE_CATEGORY_COLOR: Record<OperationalExpenseCategory, string> = {
  GAJI: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
  SEWA: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  UTILITY: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  MARKETING: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
  OPERASIONAL: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
  PERLENGKAPAN: 'bg-teal-500/10 text-teal-600 border-teal-500/30',
  PAJAK: 'bg-red-500/10 text-red-600 border-red-500/30',
  JASA: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  LAIN_LAIN: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30',
}

export const EXPENSE_PAYMENT_METHODS = ['TRANSFER', 'CASH', 'DEBIT', 'EWALLET', 'OTHER'] as const
export type ExpensePaymentMethodEnum = (typeof EXPENSE_PAYMENT_METHODS)[number]

export const EXPENSE_PAYMENT_METHOD_LABEL: Record<ExpensePaymentMethodEnum, string> = {
  TRANSFER: 'Transfer Bank',
  CASH: 'Cash',
  DEBIT: 'Debit / Kartu',
  EWALLET: 'E-Wallet',
  OTHER: 'Lainnya',
}

export const RECURRENCE_PERIODS = ['MONTHLY', 'WEEKLY', 'YEARLY'] as const satisfies readonly RecurrencePeriod[]

export const RECURRENCE_PERIOD_LABEL: Record<RecurrencePeriod, string> = {
  MONTHLY: 'Bulanan',
  WEEKLY: 'Mingguan',
  YEARLY: 'Tahunan',
}

export const operationalExpenseSchema = z.object({
  expense_date: z.string().min(1, 'Tanggal wajib diisi'),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().min(1, 'Deskripsi wajib diisi').max(500),
  amount: z.number().positive('Jumlah harus > 0'),
  payment_method: z.string().nullable().optional(),
  payment_reference: z.string().max(120).nullable().optional(),
  vendor_name: z.string().max(200).nullable().optional(),
  recurring: z.boolean().default(false),
  recurrence_period: z.enum(RECURRENCE_PERIODS).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
})
export type OperationalExpenseFormData = z.infer<typeof operationalExpenseSchema>

/**
 * Generate slug-friendly version of a name for product_categories.
 * Lowercase, replace whitespace with dash, strip non-alphanumeric.
 */
export function slugifyCategory(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
}
