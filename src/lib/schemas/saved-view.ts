import { z } from 'zod'

export const savedViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Nama view wajib').max(60),
  column_visibility: z.record(z.string(), z.boolean()),
  column_order: z.array(z.string()),
  column_widths: z.record(z.string(), z.number().int().min(40).max(1200)),
  filters: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string(),
})

export type SavedViewInput = z.infer<typeof savedViewSchema>

export const userPreferencesSchema = z.object({
  orders_list: z.object({
    column_visibility: z.record(z.string(), z.boolean()).optional(),
    column_order: z.array(z.string()).optional(),
    column_widths: z.record(z.string(), z.number().int().min(40).max(1200)).optional(),
    saved_views: z.array(savedViewSchema).max(10).optional(),
    active_view_id: z.string().nullable().optional(),
  }).optional(),
})

export type UserPreferencesInput = z.infer<typeof userPreferencesSchema>

export const organizationSettingsSchema = z.object({
  orders_list_default_view: z.object({
    column_visibility: z.record(z.string(), z.boolean()).optional(),
    column_order: z.array(z.string()).optional(),
    column_widths: z.record(z.string(), z.number().int().min(40).max(1200)).optional(),
  }).optional(),
})

export type OrganizationSettingsInput = z.infer<typeof organizationSettingsSchema>
