// Export Pembukuan → tabel spreadsheet buat double cross-check.
// Ekspor hasil pembacaan lengkap sesuai filter atau identitas pilihan,
// lengkap atribusi (campaign + platform) + angka duit est/aktual +
// beberapa kolom KOSONG buat diisi manual saat cocokin.
//
// Angka = cell NUMBER beneran (bisa =SUM/formula). Baris TOTAL paling bawah:
// XLSX pakai formula =SUM() live (recompute pas diedit); CSV pakai nilai sum
// (CSV gak support formula).
import * as XLSX from 'xlsx'
import { serializeCsv } from '@/lib/converter/serializer'

export interface PembukuanExportRow {
  source: string; order_number: string; order_date: string; status: string; zone: string
  customer_name: string; customer_city: string | null; cs_name: string | null
  attribution_code_raw: string | null
  campaign_name: string | null; campaign_platform: string | null
  channel_name: string | null; product_summary: string | null; qty: number
  payment_method: string | null; penjualan: number; ongkir: number; selisih_ongkir?: number | null
  cod_amount: number | null; tracking_no: string | null; resi: string | null
  est_fee_admin?: number | null; est_omset: number; est_hpp: number; est_fee_cs: number; est_gross_profit: number
  act_omset: number | null; act_hpp: number | null; act_fee_cs: number | null; act_gross_profit: number | null
  dicairkan: number | null; cod_settled_at: string | null
  delivered_at: string | null; returned_at: string | null
}

export interface PembukuanIdentity {
  source: string
  id: number
  zone: string
  total_count: number | string
}

export const pembukuanRowKey = (row: Pick<PembukuanIdentity, 'source' | 'id'>) => `${row.source}:${row.id}`

/** Reads the existing normal-session RPC in bounded pages. Never returns a partial file.
 * Adjacent pages overlap by one row to detect shifted/unstable offset boundaries.
 * This is a verified read, not a transactional database snapshot.
 */
export async function collectPembukuanExport<T extends PembukuanIdentity>(options: {
  fetchPage: (offset: number, limit: number, signal?: AbortSignal) => Promise<T[]>
  zone?: string | null
  selected?: ReadonlySet<string>
  signal?: AbortSignal
  onProgress?: (read: number, total: number) => void
}): Promise<T[]> {
  const { fetchPage, signal, zone, selected, onProgress } = options
  const checkAbort = () => { if (signal?.aborted) throw new DOMException('Ekspor dibatalkan', 'AbortError') }
  const changed = () => new Error('Data berubah atau belum terbaca lengkap. Muat ulang lalu ulangi ekspor; file tidak diunduh.')
  const readPage = async (offset: number, limit: number) => {
    checkAbort()
    const batch = await fetchPage(offset, limit, signal)
    checkAbort()
    if (!Array.isArray(batch) || batch.length > limit) throw changed()
    return batch
  }
  if (selected?.size === 0) throw new Error('Pilih minimal satu order untuk diekspor.')
  const result: T[] = [], seen = new Set<string>(), found = new Set<string>()
  let read = 0, expected: number | undefined, first: T | undefined, last: T | undefined
  while (expected === undefined || read < expected) {
    const batch = await readPage(read === 0 ? 0 : read - 1, 500)
    if (batch.length === 0) {
      if (read !== 0) throw changed()
      expected = 0
      break
    }
    for (const row of batch) {
      const count = Number(row.total_count)
      if (!Number.isSafeInteger(count) || count < 1 ||
          !['draft', 'final'].includes(row.source) || !Number.isSafeInteger(row.id)) throw changed()
      expected ??= count
      if (count !== expected) throw changed()
    }
    if (last && JSON.stringify(batch[0]) !== JSON.stringify(last)) throw changed()
    const next = last ? batch.slice(1) : batch
    if (next.length === 0) throw changed()
    for (const row of next) {
      const key = pembukuanRowKey(row)
      if (seen.has(key)) throw changed()
      seen.add(key)
      first ??= row
      last = row
      read++
      if ((!zone || row.zone === zone) && (!selected || selected.has(key))) {
        result.push(row)
        found.add(key)
      }
    }
    if (read > expected!) throw changed()
    onProgress?.(read, expected!)
  }
  // Detect newly added/deleted rows and a changed leading row before downloading.
  if ((await readPage(expected!, 1)).length !== 0) throw changed()
  const head = await readPage(0, 1)
  if (first ? JSON.stringify(head[0]) !== JSON.stringify(first) : head.length !== 0) throw changed()
  if (selected && found.size !== selected.size) throw new Error('Sebagian order pilihan tidak lagi cocok dengan filter. Muat ulang dan pilih kembali; file tidak diunduh.')
  checkAbort()
  return result
}

const dateOnly = (v: string | null): string => (v ? v.slice(0, 10) : '')
const num = (v: unknown): number => Number(v) || 0
// nullable: kosong kalau belum ada (bedain "belum" vs "0") — penting buat cross-check
const numN = (v: unknown): number | '' => (v === null || v === undefined ? '' : Number(v) || 0)

// numeric: true → kolom angka yang di-SUM di baris TOTAL
type Col = { header: string; numeric?: boolean; requireComplete?: boolean; get: (r: PembukuanExportRow) => unknown }

const COLUMNS: Col[] = [
  { header: 'Sumber', get: (r) => (r.source === 'draft' ? 'Antrian' : 'Arsip') },
  { header: 'No Order', get: (r) => r.order_number ?? '' },
  { header: 'Tanggal Order', get: (r) => dateOnly(r.order_date) },
  { header: 'Status', get: (r) => r.status ?? '' },
  { header: 'Zona', get: (r) => r.zone ?? '' },
  { header: 'Customer', get: (r) => r.customer_name ?? '' },
  { header: 'Kota', get: (r) => r.customer_city ?? '' },
  { header: 'CS', get: (r) => r.cs_name ?? '' },
  { header: 'Kode Atribusi', get: (r) => r.attribution_code_raw ?? '' },
  { header: 'Campaign', get: (r) => r.campaign_name ?? '' },
  { header: 'Platform', get: (r) => r.campaign_platform ?? '' },
  { header: 'Channel', get: (r) => r.channel_name ?? '' },
  { header: 'Produk', get: (r) => r.product_summary ?? '' },
  { header: 'Qty', numeric: true, get: (r) => num(r.qty) },
  { header: 'Pembayaran', get: (r) => r.payment_method ?? '' },
  { header: 'Resi', get: (r) => r.tracking_no ?? r.resi ?? '' },
  { header: 'Tagihan pembeli', numeric: true, get: (r) => num(r.penjualan) },
  { header: 'Ongkir', numeric: true, get: (r) => num(r.ongkir) },
  { header: 'Selisih Ongkir', numeric: true, requireComplete: true, get: (r) => numN(r.selisih_ongkir) },
  { header: 'COD Amount', numeric: true, get: (r) => numN(r.cod_amount) },
  { header: 'Fee Admin (Est)', numeric: true, requireComplete: true, get: (r) => numN(r.est_fee_admin) },
  { header: 'Omset (Est)', numeric: true, get: (r) => num(r.est_omset) },
  { header: 'HPP (Est)', numeric: true, get: (r) => num(r.est_hpp) },
  { header: 'Komisi/selisih estimasi (Est)', numeric: true, get: (r) => num(r.est_fee_cs) },
  { header: 'GP Proyeksi', numeric: true, get: (r) => num(r.est_gross_profit) },
  { header: 'Omset (Aktual)', numeric: true, get: (r) => numN(r.act_omset) },
  { header: 'HPP (Aktual)', numeric: true, get: (r) => numN(r.act_hpp) },
  { header: 'Komisi/selisih estimasi (Aktual)', numeric: true, get: (r) => numN(r.act_fee_cs) },
  { header: 'GP Realisasi', numeric: true, get: (r) => numN(r.act_gross_profit) },
  { header: 'Dicairkan (GrandBook)', numeric: true, get: (r) => numN(r.dicairkan) },
  { header: 'Tgl Cair', get: (r) => dateOnly(r.cod_settled_at) },
  { header: 'Tgl Diterima', get: (r) => dateOnly(r.delivered_at) },
  { header: 'Tgl Retur', get: (r) => dateOnly(r.returned_at) },
  // Kolom eksternal KOSONG — diisi manual pas cocokin di spreadsheet
  { header: 'Cek Manual (Bank/SPX)', get: () => '' },
  { header: 'Selisih vs GrandBook', get: () => '' },
  { header: 'Status Cek', get: () => '' },
]

const HEADERS = COLUMNS.map((c) => c.header)
const colSum = (rows: PembukuanExportRow[], c: Col): number =>
  rows.reduce((a, r) => { const v = c.get(r); return a + (typeof v === 'number' ? v : 0) }, 0)

/**
 * XLSX dengan baris TOTAL pakai formula =SUM() live (recompute pas diedit).
 */
export function buildPembukuanXlsxBlob(rows: PembukuanExportRow[]): Blob {
  if (rows.length > 1_048_574) throw new Error('Jumlah baris melebihi kapasitas satu sheet Excel. Persempit periode/filter atau pilih CSV; data tidak dipotong.')
  const aoa: unknown[][] = [
    HEADERS,
    ...rows.map((r) => COLUMNS.map((c) => c.get(r))),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa as XLSX.CellObject[][])
  const dataEnd = 1 + rows.length          // baris data terakhir (1-based Excel)
  const totalRow = dataEnd + 1             // baris TOTAL

  COLUMNS.forEach((c, i) => {
    const L = XLSX.utils.encode_col(i)
    if (i === 0) {
      ws[`${L}${totalRow}`] = { t: 's', v: 'TOTAL' }
    } else if (c.numeric && rows.length > 0) {
      const range = `${L}2:${L}${dataEnd}`
      const complete = !c.requireComplete || rows.every(row => typeof c.get(row) === 'number')
      ws[`${L}${totalRow}`] = {
        t: complete ? 'n' : 's',
        f: c.requireComplete ? `IF(COUNT(${range})=ROWS(${range}),SUM(${range}),"")` : `SUM(${range})`,
        v: complete ? colSum(rows, c) : '',
      }
    }
  })

  const range = XLSX.utils.decode_range(ws['!ref'] as string)
  range.e.r = totalRow - 1                 // extend ref biar baris TOTAL kebaca (0-based)
  ws['!ref'] = XLSX.utils.encode_range(range)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Pembukuan')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/**
 * CSV dengan baris TOTAL berisi nilai sum (CSV gak support formula).
 */
export function buildPembukuanCsvBlob(rows: PembukuanExportRow[]): Blob {
  const data: Record<string, unknown>[] = rows.map((r) =>
    Object.fromEntries(COLUMNS.map((c) => [c.header, c.get(r)])))
  if (rows.length > 0) {
    const total = Object.fromEntries(COLUMNS.map((c, i) =>
      [c.header, i === 0 ? 'TOTAL' : c.numeric && (!c.requireComplete || rows.every(row => typeof c.get(row) === 'number')) ? colSum(rows, c) : '']))
    data.push(total)
  }
  return serializeCsv(data, HEADERS, ',', 'utf-8-sig')
}
