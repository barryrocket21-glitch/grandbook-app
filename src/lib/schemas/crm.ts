// =============================================================
// Brief #2 — CRM activity schema
// =============================================================
import { z } from 'zod'

export const crmActivitySchema = z.object({
  orderId: z.number().int().positive(),
  channel: z.enum(['WA', 'TELEPON', 'EKSPEDISI', 'LAIN']),
  result: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  nextAction: z.string().trim().max(200).optional().nullable(),
  nextDueAt: z.string().optional().nullable(),
})

export type CrmActivityInput = z.infer<typeof crmActivitySchema>

export const CRM_ACTIVITY_CHANNELS: { value: 'WA' | 'TELEPON' | 'EKSPEDISI' | 'LAIN'; label: string }[] = [
  { value: 'WA', label: 'WhatsApp' },
  { value: 'TELEPON', label: 'Telepon' },
  { value: 'EKSPEDISI', label: 'Hubungi Ekspedisi' },
  { value: 'LAIN', label: 'Lainnya' },
]
