// Export Pembukuan → tabel spreadsheet buat double cross-check.
// Dump PERSIS apa yang tampil di /orders/pembukuan (draft + arsip, ikut filter
// aktif), lengkap atribusi (campaign + platform) + angka duit est/aktual +
// beberapa kolom KOSONG buat diisi manual saat cocokin.

export interface PembukuanExportRow {
  source: string; order_number: string; order_date: string; status: string; zone: string
  customer_name: string; customer_city: string | null; cs_name: string | null
  campaign_name: string | null; campaign_platform: string | null
  channel_name: string | null; product_summary: string | null; qty: number
  payment_method: string | null; penjualan: number; ongkir: number; selisih_ongkir: number
  cod_amount: number | null; tracking_no: string | null; resi: string | null
  est_fee_admin: number; est_omset: number; est_hpp: number; est_fee_cs: number; est_gross_profit: number
  act_omset: number | null; act_hpp: number | null; act_fee_cs: number | null; act_gross_profit: number | null
  dicairkan: number | null; cod_settled_at: string | null
  delivered_at: string | null; returned_at: string | null
}

const dateOnly = (v: string | null): string => (v ? v.slice(0, 10) : '')
const num = (v: unknown): number => Number(v) || 0
// nullable: kosong kalau belum ada (bedain "belum" vs "0") — penting buat cross-check
const numN = (v: unknown): number | '' => (v === null || v === undefined ? '' : Number(v) || 0)

type Col = { header: string; get: (r: PembukuanExportRow) => unknown }

const COLUMNS: Col[] = [
  { header: 'Sumber', get: (r) => (r.source === 'draft' ? 'Antrian' : 'Arsip') },
  { header: 'No Order', get: (r) => r.order_number ?? '' },
  { header: 'Tanggal Order', get: (r) => dateOnly(r.order_date) },
  { header: 'Status', get: (r) => r.status ?? '' },
  { header: 'Zona', get: (r) => r.zone ?? '' },
  { header: 'Customer', get: (r) => r.customer_name ?? '' },
  { header: 'Kota', get: (r) => r.customer_city ?? '' },
  { header: 'CS', get: (r) => r.cs_name ?? '' },
  { header: 'Campaign', get: (r) => r.campaign_name ?? '' },
  { header: 'Platform', get: (r) => r.campaign_platform ?? '' },
  { header: 'Channel', get: (r) => r.channel_name ?? '' },
  { header: 'Produk', get: (r) => r.product_summary ?? '' },
  { header: 'Qty', get: (r) => num(r.qty) },
  { header: 'Pembayaran', get: (r) => r.payment_method ?? '' },
  { header: 'Resi', get: (r) => r.tracking_no ?? r.resi ?? '' },
  { header: 'Penjualan', get: (r) => num(r.penjualan) },
  { header: 'Ongkir', get: (r) => num(r.ongkir) },
  { header: 'Selisih Ongkir', get: (r) => num(r.selisih_ongkir) },
  { header: 'COD Amount', get: (r) => numN(r.cod_amount) },
  { header: 'Fee Admin (Est)', get: (r) => num(r.est_fee_admin) },
  { header: 'Omset (Est)', get: (r) => num(r.est_omset) },
  { header: 'HPP (Est)', get: (r) => num(r.est_hpp) },
  { header: 'Fee CS (Est)', get: (r) => num(r.est_fee_cs) },
  { header: 'GP Proyeksi', get: (r) => num(r.est_gross_profit) },
  { header: 'Omset (Aktual)', get: (r) => numN(r.act_omset) },
  { header: 'HPP (Aktual)', get: (r) => numN(r.act_hpp) },
  { header: 'Fee CS (Aktual)', get: (r) => numN(r.act_fee_cs) },
  { header: 'GP Realisasi', get: (r) => numN(r.act_gross_profit) },
  { header: 'Dicairkan (GrandBook)', get: (r) => numN(r.dicairkan) },
  { header: 'Tgl Cair', get: (r) => dateOnly(r.cod_settled_at) },
  { header: 'Tgl Diterima', get: (r) => dateOnly(r.delivered_at) },
  { header: 'Tgl Retur', get: (r) => dateOnly(r.returned_at) },
  // Kolom eksternal KOSONG — diisi manual pas cocokin di spreadsheet
  { header: 'Cek Manual (Bank/SPX)', get: () => '' },
  { header: 'Selisih vs GrandBook', get: () => '' },
  { header: 'Status Cek', get: () => '' },
]

export function buildPembukuanExportTable(rows: PembukuanExportRow[]): {
  headers: string[]
  data: Record<string, unknown>[]
} {
  const headers = COLUMNS.map((c) => c.header)
  const data = rows.map((r) => Object.fromEntries(COLUMNS.map((c) => [c.header, c.get(r)])))
  return { headers, data }
}
