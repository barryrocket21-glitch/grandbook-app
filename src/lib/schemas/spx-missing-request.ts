import { z } from 'zod'

const text = z.string().max(10000).nullable().optional()
const amount = z.number().finite().min(0).max(1_000_000_000).nullable().optional()
const shipment = z.object({
  ref: z.string().trim().max(200),
  tracking_no: z.string().trim().max(200).nullable().optional(),
  tracking_status: text,
  actual_fee: amount, return_fee: amount, cod_amount: amount,
  delivered_at: text, retur_reason: text,
  create_time: z.string().datetime({ offset: true }).nullable().optional(),
  rescue_priority: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']).default('NONE'),
  recipient_name: text, recipient_phone: z.string().max(100).nullable().optional(),
  recipient_province: text, recipient_city: text, recipient_district: text,
  recipient_detail_address: text, recipient_postal_code: text,
  sender_name: text, item_in_parcel: text, item_list: text,
  item_count: z.number().int().min(1).max(100000).nullable().optional(),
  parcel_value: amount, basic_shipping_fee: amount, cod_service_fee: amount,
})

export const spxMissingRequestSchema = z.object({
  rows: z.array(shipment).min(1).max(200),
  channelId: z.number().int().positive().default(1),
  initialStatus: z.enum(['BARU', 'SIAP_KIRIM']).default('SIAP_KIRIM'),
  sourceProfileId: z.number().int().positive().nullable().default(null),
})
