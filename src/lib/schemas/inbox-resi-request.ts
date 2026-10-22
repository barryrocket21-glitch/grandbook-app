import { z } from 'zod'
import { normalize_phone_id_safe } from '@/lib/converter/transforms'

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const amount = z.number().finite().min(0).max(999_999_999)
export const inboxCreateOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(1000),
  phone: z.string().trim().max(100).refine(value => !value || normalize_phone_id_safe(value).isValid, 'Nomor telepon tidak valid'),
  address: z.string().trim().min(1).max(10000),
  externalRef: z.string().trim().max(200),
  attributionCode: z.string().trim().max(1000),
  orderDate: z.string().date(),
  channelId: id,
  csId: z.string().uuid().nullable(),
  paymentMethod: z.enum(['COD', 'TRANSFER']),
  shippingCost: amount,
  items: z.array(z.object({ productId: id, variantId: id.nullable(), qty: z.number().int().min(1).max(100000), price: amount }).strict()).min(1).max(20),
}).strict()
const envelope = { inboxId: id, requestId: z.string().uuid(), updatedAt: z.string().datetime({ offset: true }) }
export const inboxResiRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...envelope, action: z.literal('create'), payload: inboxCreateOrderSchema }).strict(),
  z.object({ ...envelope, action: z.literal('link'), payload: z.object({ source: z.enum(['draft', 'final']), orderId: id, updatedAt: z.string().datetime({ offset: true }) }).strict() }).strict(),
  z.object({ ...envelope, action: z.literal('ignore'), payload: z.object({ reason: z.string().trim().min(1).max(2000) }).strict() }).strict(),
])
export type InboxCreateOrder = z.infer<typeof inboxCreateOrderSchema>
