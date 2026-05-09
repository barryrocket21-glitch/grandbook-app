import { z } from 'zod'
import type { OrderStatus } from '@/lib/types'

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
