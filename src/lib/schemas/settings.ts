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
