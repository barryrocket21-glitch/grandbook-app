export type ExportItem = { product_id: number | null; product_name_raw: string | null; product?: { name: string } | null }
export function exportProductGroup(items: ExportItem[]): { key: string; label: string } {
  if (!items.length) return { key: 'UNMAPPED', label: 'Produk belum dipetakan' }
  const ids = new Set(items.map(item => item.product_id))
  if (ids.size > 1) return { key: 'MIXED', label: 'Campuran beberapa produk' }
  const first = items[0]
  if (first.product_id == null) return { key: 'UNMAPPED', label: 'Produk belum dipetakan' }
  return { key: String(first.product_id), label: first.product?.name || first.product_name_raw || 'Produk tanpa nama' }
}
