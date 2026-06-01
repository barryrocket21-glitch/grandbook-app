// =============================================================
// WA Paste Parser v3 — ported dari konorder (lib/parsers/whatsapp.ts)
// =============================================================
// Pure function: text → ParsedWaOrder[] + warnings. No DB calls.
// Strategi 3-tier split block: (1) WA chat-export timestamp,
// (2) Nama-label boundary, (3) Double-blank fallback.
// 30+ LABELS variants + line continuation + numeric overwrite.
// Smart parsing: kg/gram detection, qty extraction, transfer hint.
// GrandBook-specific extensions: CS, KODE ADV, kode produk.
// =============================================================

export interface ParsedWaOrder {
  // Recipient
  nama: string
  hp: string  // Indonesia format e.g. "081234567890" — normalize ke 0-prefixed
  alamat: string
  kelurahan: string | null
  kecamatan: string | null
  kota: string | null
  provinsi: string | null
  kodePos: string | null
  // Item
  produk: string
  produkKode: string | null  // kode produk kalau ada
  variation: string | null   // "Ukuran 6 X 3", "38-39 Cream", dst.
  qty: number
  beratGram: number
  // Money
  hargaProduk: number | null  // dari "Harga:" (harga produk, exclude ongkir)
  hargaTotal: number | null   // dari "Total:" (yang ditagih ke customer, incl ongkir)
  ongkir: number | null
  metodeBayar: 'COD' | 'TRANSFER'
  // Meta
  csName: string | null
  advKode: string | null
  catatan: string | null
}

export interface WaParseResult {
  orders: ParsedWaOrder[]
  warnings: string[]
}

// ----- LABELS dictionary -----
type WaField =
  | 'nama' | 'hp' | 'alamat'
  | 'kelurahan' | 'kecamatan' | 'kota' | 'provinsi' | 'kodePos'
  | 'produk' | 'produkKode' | 'variation' | 'qty' | 'beratGram'
  | 'hargaProduk' | 'hargaTotal' | 'ongkir' | 'metodeBayar'
  | 'csName' | 'advKode' | 'catatan'

const LABELS: Record<string, WaField> = {
  // Nama
  'nama penerima': 'nama', 'nama': 'nama', 'atas nama': 'nama',
  'pemesan': 'nama', 'penerima': 'nama',
  // Phone
  'no hp': 'hp', 'no. hp': 'hp', 'nomor hp': 'hp', 'hp': 'hp',
  'wa': 'hp', 'no wa': 'hp', 'telp': 'hp', 'no telp': 'hp', 'telepon': 'hp',
  // Address
  'alamat lengkap': 'alamat', 'alamat': 'alamat',
  'kelurahan': 'kelurahan', 'kel': 'kelurahan', 'desa': 'kelurahan',
  'kecamatan': 'kecamatan', 'kec': 'kecamatan',
  'kota/kab': 'kota', 'kota/kabupaten': 'kota', 'kota': 'kota', 'kabupaten': 'kota', 'kab': 'kota',
  'kode pos': 'kodePos', 'kodepos': 'kodePos',
  'provinsi': 'provinsi', 'prov': 'provinsi',
  // Item
  'produk': 'produk', 'pesanan': 'produk', 'order': 'produk', 'orderan': 'produk',
  'kode produk': 'produkKode', 'sku': 'produkKode',
  'ukuran': 'variation', 'varian': 'variation', 'variant': 'variation', 'warna': 'variation',
  'jumlah': 'qty', 'jml': 'qty', 'qty': 'qty',
  'berat': 'beratGram', 'berat paket': 'beratGram', 'weight': 'beratGram',
  // Money
  'ongkir': 'ongkir', 'ongkos kirim': 'ongkir', 'pengiriman': 'ongkir',
  'total bayar': 'hargaTotal', 'total harga': 'hargaTotal', 'total': 'hargaTotal',
  'harga': 'hargaProduk', 'harga produk': 'hargaProduk', 'harga satuan': 'hargaProduk', 'subtotal': 'hargaProduk',
  'pembayaran': 'metodeBayar', 'metode bayar': 'metodeBayar', 'metode pembayaran': 'metodeBayar',
  // GrandBook extensions
  'cs': 'csName', 'cs name': 'csName', 'handled by': 'csName',
  'kode adv': 'advKode', 'adv': 'advKode', 'advertiser': 'advKode',
  'keterangan': 'catatan', 'catatan': 'catatan', 'note': 'catatan', 'notes': 'catatan',
}

const CONTINUABLE = new Set<WaField>([
  'nama', 'alamat', 'kelurahan', 'kecamatan', 'kota', 'provinsi', 'produk', 'catatan',
])
const NUMERIC = new Set<WaField>(['hargaProduk', 'hargaTotal', 'ongkir', 'qty', 'beratGram'])

const TRANSFER_HINT = /\b(transfer|tf|lunas|sudah\s*bayar|sdh\s*bayar|paid)\b/i
const TS_LINE = /^\[\d{1,2}[.:]\d{2}[^\]]*\]/
const TS_PREFIX = /^\[\d{1,2}[.:]\d{2}[^\]]*\][^:]*:\s*/
const NAME_LINE = /^\s*(nama\s+penerima|nama|atas\s+nama|pemesan|penerima)\s*:/i
/**
 * Header dropship Indonesia: "SALE AIS (20)" / "SALE LISA (22)" / "SALE SITI (13)"
 * — tiap line yg match jadi start of new block. Priority paling tinggi karena
 * pattern ini explicit (vs name-label boundary yg muncul DI TENGAH block kalau
 * order pakai format "Produk dulu, Nama di akhir"). Group 1 = CS name.
 */
const SALE_LINE = /^\s*SALE\s+([A-Z][A-Z0-9]*(?:\s+[A-Z0-9]+)?)\s*\((\d+)\)\s*$/i

// ----- Indonesian provinces (lowercased, longest-first) -----
const PROVINCES = [
  'aceh', 'sumatera utara', 'sumatera barat', 'kepulauan riau', 'riau', 'jambi',
  'sumatera selatan', 'bangka belitung', 'bengkulu', 'lampung', 'dki jakarta', 'jakarta',
  'jawa barat', 'banten', 'jawa tengah', 'di yogyakarta', 'yogyakarta', 'jawa timur',
  'bali', 'nusa tenggara barat', 'nusa tenggara timur', 'kalimantan barat',
  'kalimantan tengah', 'kalimantan selatan', 'kalimantan timur', 'kalimantan utara',
  'sulawesi utara', 'gorontalo', 'sulawesi tengah', 'sulawesi barat', 'sulawesi selatan',
  'sulawesi tenggara', 'maluku utara', 'maluku', 'papua barat', 'papua',
]
const INLINE_MARKER = /\b(kelurahan|kecamatan|kabupaten|provinsi|prov|desa|kel|kec|kab|kota)\b\s*[:.]\s*/gi
const SEGMENT_MARKER = /^(kelurahan|kecamatan|kabupaten|provinsi|desa|kel|kec|kab|kota)\.?\s+/i
const FIELD_BY_MARKER: Record<string, 'kelurahan' | 'kecamatan' | 'kota' | 'provinsi'> = {
  kelurahan: 'kelurahan', kel: 'kelurahan', desa: 'kelurahan',
  kecamatan: 'kecamatan', kec: 'kecamatan',
  kabupaten: 'kota', kab: 'kota', kota: 'kota',
  provinsi: 'provinsi', prov: 'provinsi',
}

// ----- Helpers -----
function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Normalize phone ke format Indonesia 0-prefixed (e.g. "081234567890").
 * Brief #8: tahan double-prefix "+62085..." → strip "62" lalu semua leading "0",
 * baru kasih satu "0". "+62085367271433" → "085367271433" (BUKAN "0085...").
 */
function normalizePhoneId(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('62')) d = d.slice(2)   // country code
  d = d.replace(/^0+/, '')                  // semua trunk-zero di depan
  if (!d) return ''
  return d.startsWith('8') ? '0' + d : d
}

/** "Rp 15.000" / "15000" / "Rp140.000,-" → number. Null kalau gak ada digit. */
function parseRupiah(raw: string): number | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits ? Number(digits) : null
}

function parseQty(raw: string | undefined): number {
  const n = Number((raw ?? '').replace(/\D/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 1
}

function parseWeight(raw: string | undefined): number {
  const text = (raw ?? '').toLowerCase()
  const match = text.match(/\d+(?:[.,]\d+)?/)
  if (!match) return 1000
  const value = Number(match[0].replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return 1000
  // Heuristic: nilai < 10 atau ada 'kg' → kilogram, else gram. Default 1000g.
  const grams = /kg/.test(text) || value < 10 ? value * 1000 : value
  return Math.round(grams)
}

/** Best-effort split alamat lengkap ke 4-tier parts (fallback kalau gak ada label eksplisit). */
function splitAddress(raw: string) {
  const parts = { kelurahan: null as string | null, kecamatan: null as string | null, kota: null as string | null, provinsi: null as string | null }
  const text = (raw ?? '').trim()
  if (!text) return parts

  const fill = (field: keyof typeof parts, value: string | null) => {
    if (value && !parts[field]) parts[field] = value
  }
  const clean = (s: string) => {
    const t = s.replace(/^[\s,.]+/, '').replace(/[\s,.]+$/, '').trim()
    return t && t.length <= 40 ? titleCase(t) : null
  }

  // Inline markers ("Kecamatan: Wenang Kota: Manado ...")
  const markers = [...text.matchAll(INLINE_MARKER)]
  markers.forEach((m, i) => {
    const field = FIELD_BY_MARKER[m[1].toLowerCase()]
    if (!field) return
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < markers.length ? (markers[i + 1].index ?? text.length) : text.length
    fill(field, clean(text.slice(start, end)))
  })

  // Comma segments dengan bare marker ("Kota Tangerang Selatan")
  for (const seg of text.split(',').map(s => s.trim())) {
    const m = seg.match(SEGMENT_MARKER)
    const field = m ? FIELD_BY_MARKER[m[1].toLowerCase()] : undefined
    if (m && field) fill(field, clean(seg.slice(m[0].length)))
  }

  // Province scan fallback — word-boundary biar gak false-positive "bali" → "Balikpapan"
  if (!parts.provinsi) {
    const lower = text.toLowerCase()
    for (const p of PROVINCES) {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\b${escaped}\\b`, 'i')
      if (re.test(lower)) { parts.provinsi = titleCase(p); break }
    }
  }
  return parts
}

// ----- Split paste into blocks per order -----
function splitBlocks(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  // Strategi 0: SALE marker (dropship Indonesia "SALE AIS (20)"). Priority paling
  // tinggi karena explicit per-order header — kalau gak dipake, Strategy 2
  // name-label boundary akan split di TENGAH block (Nama: di posisi tengah),
  // hasilnya data bocor antar order.
  if (lines.some(l => SALE_LINE.test(l))) {
    const blocks: string[] = []
    let current: string[] = []
    for (const line of lines) {
      if (SALE_LINE.test(line) && current.length > 0) {
        blocks.push(current.join('\n'))
        current = []
      }
      current.push(line)
    }
    if (current.length > 0) blocks.push(current.join('\n'))
    return blocks
  }

  // Strategi 1: WA chat-export timestamp
  if (lines.some(l => TS_LINE.test(l))) {
    const blocks: string[] = []
    let current: string[] = []
    for (const line of lines) {
      if (TS_LINE.test(line) && current.length > 0) {
        blocks.push(current.join('\n'))
        current = []
      }
      current.push(line)
    }
    if (current.length > 0) blocks.push(current.join('\n'))
    return blocks
  }

  // Strategi 2: name-label boundaries
  const nameAt: number[] = []
  for (let i = 0; i < lines.length; i++) if (NAME_LINE.test(lines[i])) nameAt.push(i)
  if (nameAt.length >= 2) {
    const blocks: string[] = []
    for (let i = 0; i < nameAt.length; i++) {
      const start = nameAt[i]
      const end = i + 1 < nameAt.length ? nameAt[i + 1] : lines.length
      blocks.push(lines.slice(start, end).join('\n').trim())
    }
    return blocks.filter(Boolean)
  }

  // Strategi 3: explicit `---` separator atau double blank
  return text.split(/\n\s*-{2,}\s*\n|\n\s*\n\s*\n/).map(b => b.trim()).filter(Boolean)
}

// ----- Per-block parse -----
function parseBlock(block: string, idx: number, warnings: string[]): ParsedWaOrder | null {
  const fields: Partial<Record<WaField, string>> = {}
  let lastField: WaField | null = null

  for (const rawLine of block.split('\n')) {
    let line = rawLine
    if (TS_PREFIX.test(line)) line = line.replace(TS_PREFIX, '')
    if (!line.trim()) { lastField = null; continue }

    // SALE header — extract CS name dari "SALE AIS (20)" → csName = AIS
    const saleMatch = line.match(SALE_LINE)
    if (saleMatch) {
      if (!fields.csName) fields.csName = saleMatch[1].trim()
      continue
    }

    const colon = line.indexOf(':')
    const label = colon >= 0 ? line.slice(0, colon).trim().toLowerCase() : ''
    const field = label ? LABELS[label] : undefined

    if (field) {
      const value = line.slice(colon + 1).trim()
      fields[field] = fields[field] && !NUMERIC.has(field)
        ? `${fields[field]} ${value}`.trim()
        : value
      lastField = field
    } else if (lastField && CONTINUABLE.has(lastField)) {
      fields[lastField] = `${fields[lastField] ?? ''} ${line.trim()}`.trim()
    }
  }

  if (!fields.nama && !fields.hp) return null

  const opt = (v: string | undefined): string | null => {
    const t = (v ?? '').trim()
    return t.length > 0 ? t : null
  }

  // Brief #8: buang echo label yang kebawa ke value CS ("Nama: Nama, zainal
  // abidin" → "zainal abidin"; "Alamat: alamat jala ..." → "jala ...").
  if (fields.nama) {
    fields.nama = fields.nama.replace(/^\s*(nama(\s+penerima)?|atas\s+nama|penerima|pemesan)\s*[,:]?\s+/i, '').trim()
  }
  if (fields.alamat) {
    fields.alamat = fields.alamat.replace(/^\s*(alamat(\s+lengkap)?)\s*[,:]?\s+/i, '').trim()
  }

  const hp = normalizePhoneId(fields.hp ?? '')
  if (!hp) warnings.push(`Order #${idx + 1}: nomor HP gak kebaca.`)

  const alamat = (fields.alamat ?? '').trim()
  // Backfill struktural dari alamat lengkap kalau label tidak eksplisit
  const fromAddr = splitAddress(alamat)

  // Pembayaran: explicit label menang, default COD kecuali ada transfer hint
  const metodeRaw = opt(fields.metodeBayar)
  const metodeBayar: 'COD' | 'TRANSFER' = metodeRaw
    ? (TRANSFER_HINT.test(metodeRaw) ? 'TRANSFER' : 'COD')
    : (TRANSFER_HINT.test(block) ? 'TRANSFER' : 'COD')

  return {
    nama: (fields.nama ?? '').trim(),
    hp,
    alamat,
    kelurahan: opt(fields.kelurahan) ?? fromAddr.kelurahan,
    kecamatan: opt(fields.kecamatan) ?? fromAddr.kecamatan,
    kota: opt(fields.kota) ?? fromAddr.kota,
    provinsi: opt(fields.provinsi) ?? fromAddr.provinsi,
    kodePos: opt(fields.kodePos),
    produk: (fields.produk ?? '').trim(),
    produkKode: opt(fields.produkKode),
    variation: opt(fields.variation),
    qty: parseQty(fields.qty),
    beratGram: parseWeight(fields.beratGram),
    hargaProduk: parseRupiah(fields.hargaProduk ?? ''),
    hargaTotal: parseRupiah(fields.hargaTotal ?? ''),
    ongkir: parseRupiah(fields.ongkir ?? ''),
    metodeBayar,
    csName: opt(fields.csName),
    advKode: opt(fields.advKode),
    catatan: opt(fields.catatan),
  }
}

/** Main entry — parse pasted WA text into orders. */
export function parseWaPasteV3(text: string): WaParseResult {
  const warnings: string[] = []
  const orders: ParsedWaOrder[] = []
  splitBlocks(text).forEach((block, i) => {
    const order = parseBlock(block, i, warnings)
    if (order) orders.push(order)
  })
  if (orders.length === 0) warnings.push('Gak ada order yang kebaca dari teks ini.')
  return { orders, warnings }
}
