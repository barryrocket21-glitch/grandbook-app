import * as XLSX from 'xlsx'

export interface OwnerProfitSummaryRow {
  platform: string
  total_orders: number
  delivered: number
  retur: number
  delivered_rate: number
  return_rate: number
  omset: number
  gross_profit_before_ads: number
  ads_allocated: number
  profit_after_ads: number
  shipping_diff: number
}

export interface OwnerProfitProductPlatformRow {
  product_id: number | null
  product_name: string
  platform: string
  total_orders: number
  qty: number
  delivered: number
  retur: number
  delivered_rate: number
  return_rate: number
  omset: number
  gross_profit_before_ads: number
  ads_allocated: number
  profit_after_ads: number
  shipping_diff: number
}

export interface OwnerProfitExportPayload {
  notes?: string[]
  month: string
  platformFilter: string
  summary: OwnerProfitSummaryRow[]
  productPlatform: OwnerProfitProductPlatformRow[]
}

function pct(v: number) {
  return Number.isFinite(v) ? Number(v.toFixed(2)) : 0
}

export function buildOwnerProfitWorkbook(payload: OwnerProfitExportPayload): Blob {
  const wb = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.json_to_sheet(
    payload.summary.map((row) => ({
      Platform: row.platform,
      'Total Order': row.total_orders,
      Delivered: row.delivered,
      Retur: row.retur,
      'Delivered Rate %': pct(row.delivered_rate),
      'Return Rate %': pct(row.return_rate),
      Omset: row.omset,
      'Gross Profit Before Ads': row.gross_profit_before_ads,
      'Ads Allocated': row.ads_allocated,
      'Profit Setelah Ads': row.profit_after_ads,
      'Selisih Ongkir': row.shipping_diff,
    }))
  )
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Platform Summary')

  const productSheet = XLSX.utils.json_to_sheet(
    payload.productPlatform.map((row) => ({
      Produk: row.product_name,
      Platform: row.platform,
      'Total Order': row.total_orders,
      Qty: row.qty,
      Delivered: row.delivered,
      Retur: row.retur,
      'Delivered Rate %': pct(row.delivered_rate),
      'Return Rate %': pct(row.return_rate),
      Omset: row.omset,
      'Gross Profit Before Ads': row.gross_profit_before_ads,
      'Ads Allocated': row.ads_allocated,
      'Profit Setelah Ads': row.profit_after_ads,
      'Selisih Ongkir': row.shipping_diff,
    }))
  )
  XLSX.utils.book_append_sheet(wb, productSheet, 'Produk Platform')

  const notes = XLSX.utils.aoa_to_sheet([
    ['Owner Profit Cockpit Export'],
    ['Bulan', payload.month],
    ['Filter Platform', payload.platformFilter],
    [],
    ['Catatan'],
    ...(payload.notes ?? []).filter(note => note.startsWith('Biaya pengiriman order Delivered:') || note.startsWith('Biaya SPX terverifikasi')).map(note => [note]),
    ['Laba aktual belum terverifikasi. Laporan mencakup order final; biaya operasional dan biaya historis masih perlu ditinjau. ADS input advertiser sudah termasuk pajak.'],
    ['ADS memakai input GrandBook; ekspor platform terverifikasi menjadi acuan koreksi. Biaya tanpa order tetap dihitung.'],
    ['Alokasi produk memakai pengaturan kampanye saat ini, bukan bukti alokasi historis.'],
    ['Profit Setelah Ads = omset delivered/payout available - HPP - shipping actual/estimated - komisi - ads allocated.'],
    ['Selisih Ongkir = ongkir customer - shipping actual/estimated.'],
    ['Bucket UNKNOWN dipertahankan kalau platform order tidak kebaca dari meta/campaign.'],
  ])
  XLSX.utils.book_append_sheet(wb, notes, 'Notes')

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
