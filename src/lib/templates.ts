// Template definitions for bulk order upload
// Each template maps CSV columns → GrandBook order fields

export interface ParsedOrderRow {
  order_date?: string
  customer_name?: string
  customer_phone?: string
  customer_address?: string
  customer_city?: string
  customer_province?: string
  customer_postal_code?: string
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
  utm_campaign?: string
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
  downloadHeaders: string[]
  downloadExample: string[]
}

// ─── TRANSFORMS ──────────────────────────────────────────────────

const toNum = (v: string) => {
  if (!v || v.trim() === '-') return 0
  const n = Number(v.replace(/[^0-9.,]/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

const toDate = (v: string) => {
  if (!v || v.trim() === '-') return ''
  v = v.trim()
  // Handle "05-05-2026 - 12:46" (orderonline format)
  if (v.includes(' - ')) v = v.split(' - ')[0].trim()
  // Handle "05-05-2026 12:46"
  if (v.includes(' ')) v = v.split(' ')[0].trim()
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  // DD-MM-YYYY or DD/MM/YYYY
  const parts = v.split(/[\/\-]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (a.length === 4) return `${a}-${b.padStart(2,'0')}-${c.padStart(2,'0')}`
    return `${c}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`
  }
  return v
}

const toPayment = (v: string) => {
  const u = (v || '').toUpperCase().trim()
  if (u.includes('TRANSFER') || u.includes('TF') || u === 'BANK' || u === 'PREPAID') return 'TRANSFER'
  return 'COD'
}

const toPhone = (v: string) => {
  if (!v) return ''
  // Remove decimal from phone numbers stored as float (e.g. 6285695991929.0)
  return String(v).replace('.0', '').replace(/\s/g, '')
}

// ─── GRANDBOOK STANDARD ──────────────────────────────────────────
const GRANDBOOK_COLUMNS: ColumnMap[] = [
  { csvHeader: 'Tanggal', field: 'order_date', transform: toDate },
  { csvHeader: 'Nama Customer', field: 'customer_name' },
  { csvHeader: 'Telepon', field: 'customer_phone', transform: toPhone },
  { csvHeader: 'Alamat', field: 'customer_address' },
  { csvHeader: 'Kota', field: 'customer_city' },
  { csvHeader: 'Provinsi', field: 'customer_province' },
  { csvHeader: 'Kode Pos', field: 'customer_postal_code' },
  { csvHeader: 'SKU Produk', field: 'product_sku' },
  { csvHeader: 'Nama Produk', field: 'product_name' },
  { csvHeader: 'Qty', field: 'qty', transform: v => Math.round(toNum(v)) || 1 },
  { csvHeader: 'Harga Jual', field: 'price', transform: toNum },
  { csvHeader: 'Ongkos Kirim', field: 'shipping_cost', transform: toNum },
  { csvHeader: 'Diskon', field: 'discount', transform: toNum },
  { csvHeader: 'Metode Bayar', field: 'payment_method', transform: toPayment },
  { csvHeader: 'Ekspedisi', field: 'ekspedisi', transform: v => v.toUpperCase().trim() },
  { csvHeader: 'No Resi', field: 'resi' },
  { csvHeader: 'Catatan', field: 'notes' },
]

// ─── ORDER ONLINE (platform order online mereka) ─────────────────
// Format export dari platform order online (orderonline05mei.xlsx)
const ORDERONLINE_COLUMNS: ColumnMap[] = [
  { csvHeader: 'created_at', field: 'order_date', transform: toDate },
  { csvHeader: 'name', field: 'customer_name' },
  { csvHeader: 'phone', field: 'customer_phone', transform: toPhone },
  { csvHeader: 'address', field: 'customer_address' },
  { csvHeader: 'city', field: 'customer_city' },
  { csvHeader: 'province', field: 'customer_province' },
  { csvHeader: 'zip', field: 'customer_postal_code', transform: v => v ? String(Math.round(toNum(v))) : '' },
  { csvHeader: 'product_code', field: 'product_sku' },
  { csvHeader: 'product', field: 'product_name' },
  { csvHeader: 'quantity', field: 'qty', transform: v => Math.round(toNum(v)) || 1 },
  { csvHeader: 'product_price', field: 'price', transform: toNum },
  { csvHeader: 'shipping_cost', field: 'shipping_cost', transform: toNum },
  { csvHeader: 'discount', field: 'discount', transform: toNum },
  { csvHeader: 'payment_method', field: 'payment_method', transform: toPayment },
  { csvHeader: 'receipt_number', field: 'resi' },
  { csvHeader: 'utm_campaign', field: 'utm_campaign' },
  { csvHeader: 'notes', field: 'notes' },
]

// ─── SPX MASS UPLOAD (template upload ke SPX) ────────────────────
// Format berdasarkan SPX.xlsx sheet "Template Pembuatan Order Massal"
const SPX_COLUMNS: ColumnMap[] = [
  { csvHeader: 'created_at', field: 'order_date', transform: toDate },
  { csvHeader: '*Nama Penerima // *Recipient Name', field: 'customer_name' },
  { csvHeader: '*Nomor Telepon Penerima // *Recipient Phone', field: 'customer_phone', transform: toPhone },
  { csvHeader: '*Alamat Lengkap // *Detail Address', field: 'customer_address' },
  { csvHeader: '*Provinsi // *Province', field: 'customer_province' },
  { csvHeader: '*Kota // *City', field: 'customer_city' },
  { csvHeader: '*Kode Pos // *Postal Code', field: 'customer_postal_code' },
  { csvHeader: '*Nama Barang // *Item Name', field: 'product_name' },
  { csvHeader: 'Jumlah Barang // Item Quantity', field: 'qty', transform: v => Math.round(toNum(v)) || 1 },
  { csvHeader: '*Nominal COD yang harus ditagihkan ke Penerima // * COD Amount', field: 'price', transform: toNum },
  { csvHeader: 'Nomer Referensi Pembeli // Customer Reference Number', field: 'notes' },
]

// ─── MENGANTAR.COM MASS UPLOAD ───────────────────────────────────
// Format berdasarkan Massuploadmengantar.xls
const MENGANTAR_COLUMNS: ColumnMap[] = [
  { csvHeader: 'Nama Penerima', field: 'customer_name' },
  { csvHeader: 'Alamat Penerima', field: 'customer_address' },
  { csvHeader: 'Nomor Telepon', field: 'customer_phone', transform: toPhone },
  { csvHeader: 'Kode Pos', field: 'customer_postal_code' },
  { csvHeader: 'Isi Paketan (Nama Produk)', field: 'product_name' },
  { csvHeader: '**Quantity', field: 'qty', transform: v => Math.round(toNum(v)) || 1 },
  { csvHeader: 'Nilai COD (Jika COD)', field: 'price', transform: toNum },
  { csvHeader: 'Harga Barang (Jika NON-COD)', field: 'shipping_cost', transform: toNum },
  { csvHeader: 'Courier', field: 'ekspedisi', transform: v => v.toUpperCase().trim() },
  { csvHeader: 'Formulir ID', field: 'notes' },
]

// ─── TEMPLATE REGISTRY ───────────────────────────────────────────
export const UPLOAD_TEMPLATES: UploadTemplate[] = [
  {
    id: 'orderonline',
    label: 'Order Online',
    platform: 'Order Online',
    description: 'Export dari platform order online (website toko). Kolom sesuai format export standar.',
    columns: ORDERONLINE_COLUMNS,
    downloadHeaders: ['created_at','name','phone','address','city','province','zip','product_code','product','quantity','product_price','shipping_cost','discount','payment_method','receipt_number','utm_campaign','notes'],
    downloadExample: ['05-05-2026 - 12:00','Budi Santoso','08123456789','Jl. Merdeka No.1','JAKARTA SELATAN','DKI JAKARTA','12345','PROD-001','Produk A','1','150000','0','0','cod','','',''],
  },
  {
    id: 'grandbook',
    label: 'GrandBook Standard',
    platform: 'GrandBook',
    description: 'Template manual. Gunakan untuk input order dari sumber lain.',
    columns: GRANDBOOK_COLUMNS,
    downloadHeaders: GRANDBOOK_COLUMNS.map(c => c.csvHeader),
    downloadExample: ['2026-05-01','Budi Santoso','08123456789','Jl. Merdeka No.1','Jakarta Selatan','DKI Jakarta','12345','PROD-001','Produk A','1','150000','0','0','COD','SPX','',''],
  },
  {
    id: 'spx-upload',
    label: 'SPX Mass Upload',
    platform: 'SPX',
    description: 'Import dari file template mass upload SPX yang sudah terisi.',
    columns: SPX_COLUMNS,
    downloadHeaders: SPX_COLUMNS.map(c => c.csvHeader),
    downloadExample: ['05-05-2026','Budi Santoso','08123456789','Jl. Merdeka No.1','DKI JAKARTA','JAKARTA SELATAN','12345','Produk A','1','150000','REF-001'],
  },
  {
    id: 'mengantar-upload',
    label: 'mengantar.com Upload',
    platform: 'mengantar.com',
    description: 'Import dari file template mass upload mengantar.com yang sudah terisi.',
    columns: MENGANTAR_COLUMNS,
    downloadHeaders: MENGANTAR_COLUMNS.map(c => c.csvHeader),
    downloadExample: ['Budi Santoso','Jl. Merdeka No.1','08123456789','12345','Produk A','1','150000','','SPX',''],
  },
]

// ─── SPX TRACKING STATUS MAPPING ─────────────────────────────────
export const SPX_STATUS_MAP: Record<string, 'AKTIF' | 'DITERIMA' | 'PROBLEM' | 'RETUR'> = {
  'In Transit': 'AKTIF',
  'Delivering': 'AKTIF',
  'Pickup On Hold': 'AKTIF',
  'On Hold': 'PROBLEM',
  'Delivered': 'DITERIMA',
  'Returned': 'RETUR',
  'Returning': 'RETUR',
  'Cancelled': 'PROBLEM',
}

export interface ParsedResiRow {
  resi: string
  tracking_status: string
  resi_status: 'AKTIF' | 'DITERIMA' | 'PROBLEM' | 'RETUR'
  recipient_name: string
  recipient_phone: string
  delivered_time?: string
  hold_reason?: string
  failed_reason?: string
  _row: number
  _valid: boolean
  _error?: string
}

// Parse SPX export file (exportdariSPX.xlsx)
export function parseSPXExport(rows: Record<string, string>[]): ParsedResiRow[] {
  return rows.map((row, idx) => {
    const resi = (row['Tracking No.'] || '').trim()
    const trackingStatus = (row['Tracking Status'] || '').trim()
    const resiStatus = SPX_STATUS_MAP[trackingStatus]

    return {
      resi,
      tracking_status: trackingStatus,
      resi_status: resiStatus,
      recipient_name: (row['Recipient Name'] || '').trim(),
      recipient_phone: (row['Recipient Phone Number'] || '').trim(),
      delivered_time: (row['Delivered Time'] || '').trim(),
      hold_reason: (row['Delivery OnHold Reason'] || '').trim(),
      failed_reason: (row['Delivery failed Reason'] || '').trim(),
      _row: idx + 2,
      _valid: !!(resi && resiStatus),
      _error: !resi ? 'Tracking No. kosong' : !resiStatus ? `Status tidak dikenal: ${trackingStatus}` : undefined,
    }
  }).filter(r => r.resi)
}

// ─── STATUS UPDATE TEMPLATE (manual CSV) ─────────────────────────
export const RESI_UPDATE_HEADERS = [
  'No Order (jangan diubah)',
  'Nama Customer',
  'No Resi',
  'Ekspedisi',
  'Status Resi',
  'Catatan Update',
]

// ─── GENERATE SHIPPING TEMPLATES (GrandBook → ekspedisi) ─────────

export interface ShippingOrder {
  order_number: string
  customer_name: string
  customer_phone: string | null
  customer_address: string | null
  customer_city: string | null
  customer_province: string | null
  customer_postal_code?: string | null
  total: number
  payment_method: string
  notes: string | null
  items?: { product_name: string; qty: number }[]
}

export function generateSPXTemplate(orders: ShippingOrder[]): string {
  const headers = [
    '*Nama Penerima // *Recipient Name',
    '*Nomor Telepon Penerima // *Recipient Phone',
    '*Alamat Lengkap // *Detail Address',
    '*Provinsi // *Province',
    '*Kota // *City',
    '*Kecamatan // *District',
    '*Kode Pos // *Postal Code',
    '*Berat Paket (KG) // *Parcel Weight (KG)',
    '*Harga Barang // *Parcel Value',
    '*COD? (Paket COD/Bukan Paket COD) // *COD? (COD Parcel//Non-COD Parcel)',
    '*Nominal COD yang harus ditagihkan ke Penerima // * COD Amount',
    '*Asuransi (Y/N) / *Insurance (Y/N)',
    '*Nama Barang // *Item Name',
    'Jumlah Barang // Item Quantity',
    'Nomer Referensi Pembeli // Customer Reference Number',
    '*Metode Pembayaran // *Payment Method',
    'Instruksi Pengiriman // Delivery Instruction',
  ]

  const rows = orders.map(o => {
    const isCOD = o.payment_method === 'COD'
    const itemName = o.items?.map(i => `${i.product_name} x${i.qty}`).join(', ') || ''
    const totalQty = o.items?.reduce((s, i) => s + i.qty, 0) || 1
    return [
      o.customer_name,
      o.customer_phone || '',
      o.customer_address || '',
      o.customer_province || '',
      o.customer_city || '',
      '',                               // Kecamatan - user fills
      o.customer_postal_code || '',
      '1',                              // Berat default 1kg
      String(o.total),
      isCOD ? 'Paket COD' : 'Bukan Paket COD',
      isCOD ? String(o.total) : '0',
      'N',
      itemName,
      String(totalQty),
      o.order_number,
      'Sender Pay',
      o.notes || '',
    ]
  })

  return generateCSV(headers, rows)
}

export function generateMengantarTemplate(orders: ShippingOrder[]): string {
  const headers = [
    'Nama Penerima',
    'Alamat Penerima',
    'Nomor Telepon',
    'Kode Pos',
    'Berat',
    'Harga Barang (Jika NON-COD)',
    'Nilai COD (Jika COD)',
    'Isi Paketan (Nama Produk)',
    '*Kelurahan',
    '*Kecamatan',
    '**Quantity',
    'Formulir ID',
    '*Instruksi Pengiriman',
    'Courier',
  ]

  const rows = orders.map(o => {
    const isCOD = o.payment_method === 'COD'
    const itemName = o.items?.map(i => `${i.product_name} x${i.qty}`).join(', ') || ''
    const totalQty = o.items?.reduce((s, i) => s + i.qty, 0) || 1
    return [
      o.customer_name,
      o.customer_address || '',
      o.customer_phone || '',
      o.customer_postal_code || '',
      '1',
      isCOD ? '0' : String(o.total),
      isCOD ? String(o.total) : '0',
      itemName,
      '',                               // Kelurahan - user fills
      o.customer_city || '',
      String(totalQty),
      o.order_number,
      '',
      '',                               // Courier - user fills (SPX/JNE/dll)
    ]
  })

  return generateCSV(headers, rows)
}

// ─── CSV PARSER ──────────────────────────────────────────────────
export function parseCSV(template: UploadTemplate, rows: Record<string, string>[]): ParsedOrderRow[] {
  return rows.map((row, idx) => {
    const parsed: ParsedOrderRow = { _row: idx + 2, _errors: [] }
    for (const col of template.columns) {
      const raw = (row[col.csvHeader] ?? '').trim()
      const val = col.transform ? col.transform(raw) : raw
      if (val !== undefined && val !== '') {
        ;(parsed as any)[col.field] = val
      }
    }
    if (!parsed.customer_name) parsed._errors!.push('Nama Customer wajib diisi')
    if (!parsed.order_date) parsed._errors!.push('Tanggal wajib diisi')
    if (!parsed.product_sku && !parsed.product_name) parsed._errors!.push('SKU atau Nama Produk wajib diisi')
    if (!parsed.qty || parsed.qty <= 0) parsed._errors!.push('Qty tidak valid')
    if (!parsed.price || parsed.price <= 0) parsed._errors!.push('Harga wajib diisi')
    return parsed
  }).filter(r => r.customer_name || r._errors!.length > 0)
}

// ─── CSV HELPERS ─────────────────────────────────────────────────
export function generateCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) =>
    v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"` : v
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
