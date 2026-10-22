import { z } from 'zod'

const optionalText = z.string().max(10000).nullable().optional().default(null)
const amount = z.number().finite().nonnegative().nullable()
const item = z.object({
  product_id: z.number().int().positive().nullable(),
  product_name_raw: z.string().max(1000),
  variation: optionalText,
  qty: z.number().int().positive().max(100000),
  price: z.number().finite().nonnegative(),
  weight_per_unit: z.number().finite().nonnegative(),
})
export const waPasteRequest = z.object({
  requestId: z.string().uuid(),
  confirmDuplicate: z.boolean().default(false),
  orders: z.array(z.object({
    originalIndex: z.number().int().nonnegative(),
    payload: z.object({
      channel_id: z.number().int().positive(),
      status: z.enum(['BARU', 'SIAP_KIRIM']),
      customer_name: z.string().trim().min(1).max(1000),
      customer_phone: optionalText,
      customer_address_detail: optionalText,
      customer_village: optionalText,
      customer_subdistrict: optionalText,
      customer_city: optionalText,
      customer_province: optionalText,
      customer_zip: optionalText,
      payment_method: z.enum(['COD', 'TRANSFER']),
      cod_amount: amount,
      total: z.number().finite().nonnegative(),
      shipping_cost: amount,
      cs_id: z.string().uuid(),
      cs_name: optionalText,
      customer_note: optionalText,
      attribution_code_raw: optionalText,
      attribution_platform: optionalText,
      attribution_account_code: optionalText,
      attribution_campaign_marker: optionalText,
      attribution_status: z.enum(['RESOLVED', 'PENDING', 'UNKNOWN']),
      meta: z.record(z.string(), z.unknown()).nullable(),
      _item: item,
    }),
  })).min(1).max(200),
})
