import { z } from 'zod'

/**
 * Phase 8A — Zod schema untuk supplier (gudang dropship).
 *
 * Field opsional pakai pattern `.optional().or(z.literal(''))` supaya
 * empty string dari form input lolos validasi. Saat insert ke DB,
 * convert empty string → null.
 */
export const supplierSchema = z.object({
  name: z.string().min(1, 'Nama supplier wajib diisi').max(200),
  code: z
    .string()
    .max(20)
    .regex(/^[A-Z0-9-]+$/i, 'Code hanya huruf, angka, dash')
    .optional()
    .or(z.literal('')),
  address: z.string().max(500).optional().or(z.literal('')),
  city: z.string().max(100).optional().or(z.literal('')),
  province: z.string().max(100).optional().or(z.literal('')),
  pic_name: z.string().max(100).optional().or(z.literal('')),
  pic_phone: z.string().max(20).optional().or(z.literal('')),
  notes: z.string().max(1000).optional().or(z.literal('')),
  active: z.boolean().default(true),
})

export type SupplierFormData = z.infer<typeof supplierSchema>

/**
 * Convert empty string → null untuk field opsional, uppercase code,
 * supaya konsisten saat insert/update ke DB.
 */
export function normalizeSupplierForm(data: SupplierFormData) {
  const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null)
  return {
    name: data.name.trim(),
    code: data.code ? data.code.trim().toUpperCase() : null,
    address: blank(data.address),
    city: blank(data.city),
    province: blank(data.province),
    pic_name: blank(data.pic_name),
    pic_phone: blank(data.pic_phone),
    notes: blank(data.notes),
    active: data.active,
  }
}
