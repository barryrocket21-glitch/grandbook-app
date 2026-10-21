import { jakartaDateString } from '@/lib/date/jakarta'
import type { FulfillmentCategory } from '@/lib/types'

type CategoryFilter = 'ALL' | FulfillmentCategory

export type DataOrderExportRow = {
  spx_created_at?: string | null
}

export function buildDataOrderExportRpcParams(args: {
  category: CategoryFilter
  search: string
  gbDateFrom: string
  gbDateTo: string
  spxDateFrom: string
  spxDateTo: string
  limit?: number
  offset?: number
}) {
  const hasSpxDate = args.category !== 'GB_NO_RESI' && Boolean(args.spxDateFrom || args.spxDateTo)

  return {
    p_from: null,
    p_to: null,
    p_category: hasSpxDate && args.category === 'ALL' ? 'FIX_ORDER' : args.category === 'ALL' ? null : args.category,
    p_search: args.search.trim() || null,
    p_limit: args.limit ?? 50000,
    p_offset: args.offset ?? 0,
    // Download user patokannya Tanggal Create SPX. Kalau SPX date dipilih,
    // jangan ikut batasi dari Tanggal Terbit GB supaya semua resi SPX di range
    // tersebut ikut ter-download walau GB ref/order_date beda bulan.
    p_date_basis: hasSpxDate ? 'spx_created_at' : 'order_date',
    p_gb_from: hasSpxDate ? null : args.gbDateFrom || null,
    p_gb_to: hasSpxDate ? null : args.gbDateTo || null,
    p_spx_from: hasSpxDate ? args.spxDateFrom || null : null,
    p_spx_to: hasSpxDate ? args.spxDateTo || null : null,
  }
}

export function filterDataOrderRowsForExport<T extends DataOrderExportRow>(rows: T[], args: {
  spxDateFrom: string
  spxDateTo: string
}) {
  const hasSpxDate = Boolean(args.spxDateFrom || args.spxDateTo)
  if (!hasSpxDate) return rows

  return rows.filter((row) => {
    const spxDate = row.spx_created_at ? jakartaDateString(new Date(row.spx_created_at)) : ''
    if (!spxDate) return false
    if (args.spxDateFrom && spxDate < args.spxDateFrom) return false
    if (args.spxDateTo && spxDate > args.spxDateTo) return false
    return true
  })
}
