// =============================================================
// Export Rekonsiliasi — dump transaksi (order-grain) buat double-check di
// spreadsheet. Ambil dari RPC export_reconciliation_rows (mig 135), lalu
// bentuk tabel header bhs Indonesia + kolom eksternal KOSONG (diisi manual
// dari bank/SPX/Meta). Serialisasi pakai converter/serializer (CSV/XLSX).
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ReconExportRow {
  order_number: string | null
  resi: string | null
  order_date: string | null
  delivered_at: string | null
  status: string | null
  payment_method: string | null
  kode_atribusi: string | null
  campaign_name: string | null
  platform: string | null
  advertiser_name: string | null
  cs_name: string | null
  channel_name: string | null
  product_summary: string | null
  harga_barang: number | null
  ongkir: number | null
  penjualan: number | null
  cod_amount: number | null
  payout_amount: number | null
  shipping_diff: number | null
  est_hpp: number | null
  komisi: number | null
  estimated_profit: number | null
  actual_profit: number | null
  dicairkan: number | null
  cod_settled_at: string | null
}

export async function fetchReconExportRows(
  supabase: SupabaseClient,
  args: { from: string; to: string; statuses?: string[] | null }
): Promise<ReconExportRow[]> {
  const params = {
    p_from: args.from,
    p_to: args.to,
    p_status: args.statuses && args.statuses.length ? args.statuses : null,
  }
  // PostgREST motong per-request (default 1000 baris). Paginasi via .range()
  // biar export gak kepotong diam-diam pas order > 1000 sebulan.
  const PAGE = 1000
  const all: ReconExportRow[] = []
  for (let offset = 0; offset < 200_000; offset += PAGE) {
    const { data, error } = await supabase
      .rpc('export_reconciliation_rows', params)
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as ReconExportRow[]
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

// Kolom export: header bhs Indonesia + getter. Numeric → number (XLSX nyimpen
// sebagai angka, bukan teks). Kolom eksternal pakai getter konstan '' = kosong.
type Col = { header: string; get: (r: ReconExportRow) => unknown }

const dateOnly = (v: string | null): string => (v ? String(v).slice(0, 10) : '')
const num = (v: number | null): number | string => (v == null ? '' : Number(v))

export const RECON_EXPORT_COLUMNS: Col[] = [
  { header: 'No Order', get: (r) => r.order_number ?? '' },
  { header: 'Resi', get: (r) => r.resi ?? '' },
  { header: 'Tanggal Order', get: (r) => dateOnly(r.order_date) },
  { header: 'Tanggal Diterima', get: (r) => dateOnly(r.delivered_at) },
  { header: 'Status', get: (r) => r.status ?? '' },
  { header: 'Pembayaran', get: (r) => r.payment_method ?? '' },
  { header: 'Kode Atribusi', get: (r) => r.kode_atribusi ?? '' },
  { header: 'Campaign', get: (r) => r.campaign_name ?? '' },
  { header: 'Platform', get: (r) => r.platform ?? '' },
  { header: 'Advertiser', get: (r) => r.advertiser_name ?? '' },
  { header: 'CS', get: (r) => r.cs_name ?? '' },
  { header: 'Channel', get: (r) => r.channel_name ?? '' },
  { header: 'Produk', get: (r) => r.product_summary ?? '' },
  { header: 'Harga Barang', get: (r) => num(r.harga_barang) },
  { header: 'Ongkir', get: (r) => num(r.ongkir) },
  { header: 'Penjualan (COD)', get: (r) => num(r.penjualan) },
  { header: 'COD Amount', get: (r) => num(r.cod_amount) },
  { header: 'Payout (GrandBook)', get: (r) => num(r.payout_amount) },
  { header: 'Selisih Ongkir', get: (r) => num(r.shipping_diff) },
  { header: 'HPP', get: (r) => num(r.est_hpp) },
  { header: 'Komisi', get: (r) => num(r.komisi) },
  { header: 'Profit Estimasi', get: (r) => num(r.estimated_profit) },
  { header: 'Profit Aktual', get: (r) => num(r.actual_profit) },
  { header: 'Dicairkan (GrandBook)', get: (r) => num(r.dicairkan) },
  { header: 'Tgl Cair', get: (r) => dateOnly(r.cod_settled_at) },
  // —— kolom eksternal: DIKOSONGIN, diisi manual dari bank/SPX/Meta ——
  { header: 'Payout Aktual (Bank/SPX)', get: () => '' },
  { header: 'Selisih vs GrandBook', get: () => '' },
  { header: 'Status Cek', get: () => '' },
]

export function buildReconExportTable(rows: ReconExportRow[]): {
  headers: string[]
  data: Array<Record<string, unknown>>
} {
  const headers = RECON_EXPORT_COLUMNS.map((c) => c.header)
  const data = rows.map((r) =>
    Object.fromEntries(RECON_EXPORT_COLUMNS.map((c) => [c.header, c.get(r)]))
  )
  return { headers, data }
}
