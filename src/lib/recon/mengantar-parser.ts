// =============================================================
// Mengantar (JNE via Mengantar) — IMPORT order baru ke GrandBook.
// =============================================================
// Order Mengantar/JNE BELUM PERNAH ada di GrandBook (cuma channel SPX). File ini
// di-IMPORT jadi order baru (rekap, udah delivered → gak parsing alamat/wilayah).
// Match by Tracking ID → orders.resi (prefix "'" Excel di-strip) buat dedup.
// Status: Last Status → 8-state (MENGANTAR_STATUS_MAP, konservatif).
// Produk: Goods Description dibersihin ("1x", ", Warna:", ukuran, huruf platform).
// Keuangan (NETT_OFF): total=COD, shipping_net=ShipFee−Disc, est_pricing=total
//   biaya kurir, payout(DITERIMA)=COD−est_pricing. platform_hint dari ekor huruf
//   (F/G/S/T) buat bantu tebak atribusi.
// =============================================================
import * as XLSX from 'xlsx'

export const MENGANTAR_STATUS_MAP: Record<string, string> = {
  DELIVERED: 'DITERIMA',
  RTS: 'RETUR',
  'INBOUND STATION': 'DIKIRIM',
  'INBOUND PROCESS': 'DIKIRIM',
  'TRANSIT CITY': 'DIKIRIM',
  'DELIVERY COURIER': 'DIKIRIM',
  'DELIVERY ATTEMPT': 'DIKIRIM',
  UNDELIVERED: 'PROBLEM',
  'COD REJECT': 'PROBLEM',
  'SHIPMENT RETURN': 'PROBLEM',
  'PICKUP FAILED': 'PROBLEM',
  'ADDRESS ISSUE': 'PROBLEM',
  'DELIVERY PROBLEM': 'PROBLEM',
  'UNKNOWN RECEIVER': 'PROBLEM',
}

const PLATFORM_LETTER: Record<string, string> = { F: 'META', G: 'GOOGLE', S: 'SNACK', T: 'TIKTOK' }

export interface ParsedMengantarOrder {
  resi: string
  order_date: string // YYYY-MM-DD dari Create Date
  customer_name: string
  customer_phone: string
  customer_address: string
  customer_province: string
  customer_city: string
  customer_subdistrict: string
  product_raw: string
  product_clean: string
  platform_hint: string | null
  qty: number
  last_status: string
  internal_status: string | null
  cod: number
  shipping_net: number
  est_pricing: number
  payout: number | null
}

function coerceNumeric(v: unknown): number {
  if (v == null || v === '' || v === '-') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  let cleaned = String(v).trim().replace(/[^\d.,\-]/g, '')
  if (cleaned.includes(',') && !cleaned.includes('.')) cleaned = cleaned.replace(',', '.')
  else cleaned = cleaned.replace(/,/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

function coerceString(v: unknown): string {
  if (v == null || v === '' || v === '-') return ''
  return String(v).trim()
}

function stripApostrophe(s: string): string {
  return s.replace(/^'+/, '').trim()
}

// "23-06-2026 13:02" / "2026-06-23" / Excel serial → "YYYY-MM-DD"
function coerceDate(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number') {
    const ms = (v - 25569) * 86400 * 1000
    return new Date(ms).toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/) // DD-MM-YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) // YYYY-MM-DD
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return ''
}

// "1x Sandal Luna 38-39, Warna: Cream F" → { clean:"Sandal Luna", platform:"META" }
function cleanProduct(g: string): { clean: string; platform: string | null } {
  let s = g.replace(/^\s*\d+\s*x\s*/i, '') // strip "1x "
  s = s.replace(/,[\s\S]*$/, '').trim() // strip dari koma pertama (", Warna: ...")
  let platform: string | null = null
  const hm = s.match(/\s([FGSTfgst])$/) // ekor huruf platform
  if (hm) {
    platform = PLATFORM_LETTER[hm[1].toUpperCase()] ?? null
    s = s.replace(/\s[FGSTfgst]$/, '').trim()
  }
  s = s.replace(/\s+\d+([\-/]\d+)?$/, '').trim() // strip ukuran "38-39" / "43"
  return { clean: s, platform }
}

export async function parseMengantarXlsx(file: File): Promise<{
  rows: ParsedMengantarOrder[]
  warnings: string[]
  unknownStatuses: string[]
}> {
  const warnings: string[] = []
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return { rows: [], warnings: ['Sheet pertama kosong'], unknownStatuses: [] }

  const arrs = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
  if (arrs.length < 2) return { rows: [], warnings: ['File terlalu pendek'], unknownStatuses: [] }

  const headers = (arrs[0] || []).map((h) => (h == null ? '' : String(h).trim()))
  const idx = (name: string) => headers.findIndex((h) => h === name)
  const i = {
    resi: idx('Tracking ID'), name: idx('Customer Name'), phone: idx('Customer Phone Number'),
    addr: idx('Customer Address'), prov: idx('Province'), city: idx('City'),
    subdist: idx('Subdistrict'), goods: idx('Goods Description'), qty: idx('Quantity'),
    cod: idx('COD'), ship: idx('Shipping Fee'), disc: idx('Shipping Discount'),
    est: idx('Estimated Pricing'), status: idx('Last Status'), created: idx('Create Date'),
  }
  if (i.resi < 0) warnings.push('Kolom "Tracking ID" tidak ketemu')
  if (i.status < 0) warnings.push('Kolom "Last Status" tidak ketemu')
  if (i.cod < 0) warnings.push('Kolom "COD" tidak ketemu')
  if (i.goods < 0) warnings.push('Kolom "Goods Description" tidak ketemu')

  const get = (arr: unknown[], k: number) => (k >= 0 ? arr[k] : '')
  const rows: ParsedMengantarOrder[] = []
  const unknown = new Set<string>()
  for (const arr of arrs.slice(1)) {
    if (!Array.isArray(arr) || arr.length === 0) continue
    const resi = stripApostrophe(coerceString(get(arr, i.resi)))
    if (!resi) continue
    const lastStatus = coerceString(get(arr, i.status)).toUpperCase()
    const internal = MENGANTAR_STATUS_MAP[lastStatus] ?? null
    if (lastStatus && !internal) unknown.add(lastStatus)

    const goods = coerceString(get(arr, i.goods))
    const { clean, platform } = cleanProduct(goods)
    const cod = coerceNumeric(get(arr, i.cod))
    const shippingNet = coerceNumeric(get(arr, i.ship)) - coerceNumeric(get(arr, i.disc))
    const estPricing = coerceNumeric(get(arr, i.est))

    rows.push({
      resi,
      order_date: coerceDate(get(arr, i.created)),
      customer_name: coerceString(get(arr, i.name)),
      customer_phone: coerceString(get(arr, i.phone)),
      customer_address: coerceString(get(arr, i.addr)),
      customer_province: coerceString(get(arr, i.prov)),
      customer_city: coerceString(get(arr, i.city)),
      customer_subdistrict: coerceString(get(arr, i.subdist)),
      product_raw: goods,
      product_clean: clean,
      platform_hint: platform,
      qty: Math.max(1, Math.round(coerceNumeric(get(arr, i.qty))) || 1),
      last_status: lastStatus,
      internal_status: internal,
      cod,
      shipping_net: shippingNet,
      est_pricing: estPricing,
      payout: internal === 'DITERIMA' ? Math.max(cod - estPricing, 0) : null,
    })
  }
  return { rows, warnings, unknownStatuses: [...unknown] }
}
