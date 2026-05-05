// Template definitions for bulk order upload
// Each template maps CSV columns → GrandBook order fields

export interface ParsedOrderRow {
  order_date?: string
  customer_name?: string
  customer_phone?: string
  customer_address?: string
  customer_city?: string
  customer_province?: string
  product_sku?: string
  product_name?: string
  qty?: number
  price?: number
  shipping_cost?: number
  discount?: number
  payment_method?: string
  ekspedisi?: string
  resi?: string
  notes?: string
  // raw row ref for error reporting
  _row?: number
  _errors?: string[]
}

export interface ColumnMap {
  csvHeader: string
  field: keyof ParsedOrderRow
  transform?: (v: string) => string | number | undefined
}

export interface UploadTemplate {
  id: string
  label: string
  platform: string
  description: string
  columns: ColumnMap[]
  // CSV header row for template download
  downloadHeaders: string[]
  downloadExample: string[]
}

const toNum = (v: string) => {
  const n = Number(v.replace(/[^0-9.,]/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

const toDate = (v: string) => {
  if (!v) return ''
  // Handle DD/MM/YYYY and YYYY-MM-DD and DD-MM-YYYY
  v = v.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const parts = v.split(/[\/\-]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (a.length === 4) return `${a}-${b.padStart(2,'0')}-${c.padStart(2,'0')}` // YYYY-MM-DD
    return `${c}-${b.padStart(2,'0')}-${a.padStart(2,'0')}` // DD/MM/YYYY → YYYY-MM-DD
  }
  return v
}

const toPayment = (v: string) => {
  const u = v.toUpperCase().trim()
  if (u.includes('TRANSFER') || u.includes('TF') || u === 'BANK') return 'TRANSFER'
  return 'COD'
}

// ─── GRANDBOOK STANDARD ───────────────────────────────────────────
const GRANDBOOK_COLUMNS: ColumnMap[] = [
  { csvHeader: 'Tanggal', field: 'order_date', transform: toDate },
  { csvHeader: 'Nama Customer', field: 'customer_name' },
  { csvHeader: 'Telepon', field: 'customer_phone' },
  { csvHeader: 'Alamat', field: 'customer_address' },
  { csvHeader: 'Kota', field: 'customer_city' },
  { csvHeader: 'Provinsi', field: 'customer_province' },
  { csvHeader: 'SKU Produk', field: 'product_sku' },
  { csvHeader: 'Nama Produk', field: 'product_name' },
  { csvHeader: 'Qty', field: 'qty', transform: v => Math.round(toNum(v)) },
  { csvHeader: 'Harga Jual', field: 'price', transform: toNum },
  { csvHeader: 'Ongkos Kirim', field: 'shipping_cost', transform: toNum },
  { csvHeader: 'Diskon', field: 'discount', transform: toNum },
  { csvHeader: 'Metode Bayar', field: 'payment_method', transform: toPayment },
  { csvHeader: 'Ekspedisi', field: 'ekspedisi', transform: v => v.toUpperCase().trim() },
  { csvHeader: 'No Resi', field: 'resi' },
  { csvHeader: 'Catatan', field: 'notes' },
]

// ─── SPX (SHOPEE EXPRESS) ─────────────────────────────────────────
// Format export dari platform yang menggunakan SPX sebagai kurir
const SPX_COLUMNS: ColumnMap[] = [
  { csvHeader: 'Tanggal Order', field: 'order_date', transform: toDate },
  { csvHeader: 'Nama Penerima', field: 'customer_name' },
  { csvHeader: 'No HP Penerima', field: 'customer_phone' },
  { csvHeader: 'Alamat Pengiriman', field: 'customer_address' },
  { csvHeader: 'Kota/Kabupaten', field: 'customer_city' },
  { csvHeader: 'Provinsi', field: 'customer_province' },
  { csvHeader: 'SKU', field: 'product_sku' },
  { csvHeader: 'Nama Produk', field: 'product_name' },
  { csvHeader: 'Jumlah', field: 'qty', transform: v => Math.round(toNum(v)) },
  { csvHeader: 'Harga COD', field: 'price', transform: toNum },
  { csvHeader: 'Ongkir', field: 'shipping_cost', transform: toNum },
  { csvHeader: 'Diskon', field: 'discount', transform: toNum },
  { csvHeader: 'Metode Bayar', field: 'payment_method', transform: toPayment },
  { csvHeader: 'No Resi SPX', field: 'resi' },
  { csvHeader: 'Catatan', field: 'notes' },
]

// ─── JNE ────────────────────────────────────────────────────────────
const JNE_COLUMNS: ColumnMap[] = [
  { csvHeader: 'Tanggal', field: 'order_date', transform: toDate },
  { csvHeader: 'Penerima', field: 'customer_name' },
  { csvHeader: 'Telepon Penerima', field: 'customer_phone' },
  { csvHeader: 'Alamat Tujuan', field: 'customer_address' },
  { csvHeader: 'Kota Tujuan', field: 'customer_city' },
  { csvHeader: 'Provinsi Tujuan', field: 'customer_province' },
  { csvHeader: 'Keterangan Barang / SKU', field: 'product_sku' },
  { csvHeader: 'Nama Barang', field: 'product_name' },
  { csvHeader: 'Qty', field: 'qty', transform: v => Math.round(toNum(v)) },
  { csvHeader: 'Nilai COD', field: 'price', transform: toNum },
  { csvHeader: 'Ongkir', field: 'shipping_cost', transform: toNum },
  { csvHeader: 'Diskon', field: 'discount', transform: toNum },
  { csvHeader: 'Jenis Pembayaran', field: 'payment_method', transform: toPayment },
  { csvHeader: 'No Resi JNE', field: 'resi' },
  { csvHeader: 'Catatan', field: 'notes' },
]

// ─── MENGANTAR.COM ────────────────────────────────────────────────
const MENGANTAR_COLUMNS: ColumnMap[] = [
  { csvHeader: 'Tanggal Pesanan', field: 'order_date', transform: toDate },
  { csvHeader: 'Nama Penerima', field: 'customer_name' },
  { csvHeader: 'No. HP', field: 'customer_phone' },
  { csvHeader: 'Alamat', field: 'customer_address' },
  { csvHeader: 'Kota', field: 'customer_city' },
  { csvHeader: 'Provinsi', field: 'customer_province' },
  { csvHeader: 'Kode Produk', field: 'product_sku' },
  { csvHeader: 'Nama Produk', field: 'product_name' },
  { csvHeader: 'Qty', field: 'qty', transform: v => Math.round(toNum(v)) },
  { csvHeader: 'Harga Jual', field: 'price', transform: toNum },
  { csvHeader: 'Ongkos Kirim', field: 'shipping_cost', transform: toNum },
  { csvHeader: 'Diskon', field: 'discount', transform: toNum },
  { csvHeader: 'Pembayaran', field: 'payment_method', transform: toPayment },
  { csvHeader: 'Kurir', field: 'ekspedisi', transform: v => v.toUpperCase().trim() },
  { csvHeader: 'No. Resi', field: 'resi' },
  { csvHeader: 'Keterangan', field: 'notes' },
]

// ─── LINCAH.ID ────────────────────────────────────────────────────
const LINCAH_COLUMNS: ColumnMap[] = [
  { csvHeader: 'Tgl Pesanan', field: 'order_date', transform: toDate },
  { csvHeader: 'Nama Customer', field: 'customer_name' },
  { csvHeader: 'No Telepon', field: 'customer_phone' },
  { csvHeader: 'Alamat Kirim', field: 'customer_address' },
  { csvHeader: 'Kota/Kab', field: 'customer_city' },
  { csvHeader: 'Provinsi', field: 'customer_province' },
  { csvHeader: 'ID Produk', field: 'product_sku' },
  { csvHeader: 'Produk', field: 'product_name' },
  { csvHeader: 'Jumlah', field: 'qty', transform: v => Math.round(toNum(v)) },
  { csvHeader: 'Harga', field: 'price', transform: toNum },
  { csvHeader: 'Ongkir', field: 'shipping_cost', transform: toNum },
  { csvHeader: 'Diskon', field: 'discount', transform: toNum },
  { csvHeader: 'Tipe Bayar', field: 'payment_method', transform: toPayment },
  { csvHeader: 'Ekspedisi', field: 'ekspedisi', transform: v => v.toUpperCase().trim() },
  { csvHeader: 'Resi', field: 'resi' },
  { csvHeader: 'Catatan', field: 'notes' },
]

// ─── TEMPLATE REGISTRY ─────────────────────────────────────────────
export const UPLOAD_TEMPLATES: UploadTemplate[] = [
  {
    id: 'grandbook',
    label: 'GrandBook Standard',
    platform: 'GrandBook',
    description: 'Template bawaan GrandBook. Gunakan ini jika input manual atau konversi dari sistem lain.',
    columns: GRANDBOOK_COLUMNS,
    downloadHeaders: GRANDBOOK_COLUMNS.map(c => c.csvHeader),
    downloadExample: [
      '2026-05-01', 'Budi Santoso', '08123456789', 'Jl. Merdeka No.1', 'Jakarta Selatan', 'DKI Jakarta',
      'PROD-001', 'Produk A', '1', '150000', '0', '0', 'COD', 'SPX', '', '',
    ],
  },
  {
    id: 'spx',
    label: 'SPX (Shopee Express)',
    platform: 'SPX',
    description: 'Format untuk order yang dikirim via Shopee Express / SPX COD.',
    columns: SPX_COLUMNS,
    downloadHeaders: SPX_COLUMNS.map(c => c.csvHeader),
    downloadExample: [
      '2026-05-01', 'Budi Santoso', '08123456789', 'Jl. Merdeka No.1', 'Jakarta Selatan', 'DKI Jakarta',
      'PROD-001', 'Produk A', '1', '150000', '0', '0', 'COD', 'SPXID123456789', '',
    ],
  },
  {
    id: 'jne',
    label: 'JNE',
    platform: 'JNE',
    description: 'Format upload order untuk ekspedisi JNE.',
    columns: JNE_COLUMNS,
    downloadHeaders: JNE_COLUMNS.map(c => c.csvHeader),
    downloadExample: [
      '2026-05-01', 'Budi Santoso', '08123456789', 'Jl. Merdeka No.1', 'Jakarta Selatan', 'DKI Jakarta',
      'PROD-001', 'Produk A', '1', '150000', '0', '0', 'COD', 'CGKJKT123456', '',
    ],
  },
  {
    id: 'mengantar',
    label: 'mengantar.com',
    platform: 'mengantar.com',
    description: 'Export dari platform mengantar.com.',
    columns: MENGANTAR_COLUMNS,
    downloadHeaders: MENGANTAR_COLUMNS.map(c => c.csvHeader),
    downloadExample: [
      '2026-05-01', 'Budi Santoso', '08123456789', 'Jl. Merdeka No.1', 'Jakarta Selatan', 'DKI Jakarta',
      'PROD-001', 'Produk A', '1', '150000', '0', '0', 'COD', 'SPX', '', '',
    ],
  },
  {
    id: 'lincah',
    label: 'lincah.id',
    platform: 'lincah.id',
    description: 'Export dari platform lincah.id.',
    columns: LINCAH_COLUMNS,
    downloadHeaders: LINCAH_COLUMNS.map(c => c.csvHeader),
    downloadExample: [
      '2026-05-01', 'Budi Santoso', '08123456789', 'Jl. Merdeka No.1', 'Jakarta Selatan', 'DKI Jakarta',
      'PROD-001', 'Produk A', '1', '150000', '0', '0', 'COD', 'SPX', '', '',
    ],
  },
]

// ─── STATUS UPDATE TEMPLATE ────────────────────────────────────────
export const RESI_UPDATE_HEADERS = [
  'No Order (jangan diubah)',
  'Nama Customer',
  'No Resi',
  'Ekspedisi',
  'Status Resi',    // AKTIF | DITERIMA | PROBLEM | RETUR
  'Catatan Update',
]

// ─── CSV PARSER ────────────────────────────────────────────────────
export function parseCSV(template: UploadTemplate, rows: Record<string, string>[]): ParsedOrderRow[] {
  return rows.map((row, idx) => {
    const parsed: ParsedOrderRow = { _row: idx + 2, _errors: [] }
    for (const col of template.columns) {
      const raw = row[col.csvHeader]?.trim() ?? ''
      const val = col.transform ? col.transform(raw) : raw
      if (val !== undefined && val !== '') {
        ;(parsed as any)[col.field] = val
      }
    }
    // Validation
    if (!parsed.customer_name) parsed._errors!.push('Nama Customer wajib diisi')
    if (!parsed.order_date) parsed._errors!.push('Tanggal wajib diisi')
    if (!parsed.product_sku && !parsed.product_name) parsed._errors!.push('SKU atau Nama Produk wajib diisi')
    if (!parsed.qty || parsed.qty <= 0) parsed._errors!.push('Qty tidak valid')
    if (!parsed.price || parsed.price <= 0) parsed._errors!.push('Harga wajib diisi')
    return parsed
  }).filter(r => r.customer_name || r._errors!.length > 0)
}

// ─── CSV GENERATOR ────────────────────────────────────────────────
export function generateCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) => v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"`
    : v
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  return lines.join('\n')
}

export function downloadCSV(filename: string, content: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
