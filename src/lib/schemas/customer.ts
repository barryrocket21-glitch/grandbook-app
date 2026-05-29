// =============================================================
// Brief #1 — Customer manual-mutation schemas (blacklist / vip / note)
// =============================================================
import { z } from 'zod'

export const customerBlacklistSchema = z.object({
  customerId: z.number().int().positive(),
  isBlacklisted: z.boolean(),
  // Reason wajib saat MENG-aktifkan blacklist; boleh kosong saat melepas.
  reason: z.string().trim().max(500).optional().nullable(),
}).refine(
  (v) => !v.isBlacklisted || (v.reason && v.reason.length >= 3),
  { message: 'Alasan blacklist wajib diisi (min 3 karakter).', path: ['reason'] }
)

export const customerVipSchema = z.object({
  customerId: z.number().int().positive(),
  isVip: z.boolean(),
})

export const customerNoteSchema = z.object({
  customerId: z.number().int().positive(),
  note: z.string().trim().max(1000).optional().nullable(),
})

export type CustomerBlacklistInput = z.infer<typeof customerBlacklistSchema>
export type CustomerVipInput = z.infer<typeof customerVipSchema>
export type CustomerNoteInput = z.infer<typeof customerNoteSchema>
