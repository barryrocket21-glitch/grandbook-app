// =============================================================
// Phase 8I-v2 — SPX Account Transaction (Daily Cashflow) XLSX parser
// =============================================================
// Source: Shopee Seller Center → Saldo → Riwayat Transaksi → Export
// Format: .xlsx with header at row 1 (BUKAN row 2 seperti Financial Report).
// 15 kolom extract:
//   ID Transaksi, Tipe Transaksi, Tracking Number, Waktu Pembaruan Status,
//   Nominal Transaksi(IDR), Saldo Sebelum(IDR), Saldo Sesudah(IDR),
//   Biaya Penarikan(IDR), Jumlah Transfer Bank Penarikan(IDR), Status,
//   Akun bank penarikan, Transaction Reference No, Alasan Penolakan Penarikan,
//   Create Time, Complete Time
//
// 2 tipe row: 'COD' (set payout_amount via tracking match) atau 'Penarikan'
// (insert ke bank_withdrawals).
// =============================================================
import * as XLSX from 'xlsx'

export interface ParsedAccountTxRow {
  external_id: string
  tx_type: string                  // 'COD' | 'Penarikan' | other
  tracking: string                 // empty for Penarikan
  update_time: string
  nominal: number                  // positive (COD) atau negative (Penarikan) — disimpan as-is
  balance_before: number
  balance_after: number
  withdrawal_fee: number
  net_received: number
  status: string                   // 'Berhasil' | 'Ditolak' | 'Pending'
  bank_account: string
  reference_no: string
  rejection_reason: string
  create_time: string
  complete_time: string
  raw?: Record<string, unknown>
}

function coerceNumeric(v: unknown): number {
  if (v == null || v === '' || v === '-') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v).trim()
  if (s === '' || s === '-') return 0
  let cleaned = s.replace(/[^\d.,\-]/g, '')
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.')
  } else {
    cleaned = cleaned.replace(/,/g, '')
  }
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

function coerceString(v: unknown): string {
  if (v == null || v === '') return ''
  if (v === '-') return ''
  if (typeof v === 'string') return v.trim()
  return String(v).trim()
}

function coerceDateTime(v: unknown): string {
  if (v == null || v === '' || v === '-') return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number') {
    // Excel serial date → JS Date (1900 epoch). 25569 = days between 1900-01-01 and 1970-01-01
    const ms = (v - 25569) * 86400 * 1000
    return new Date(ms).toISOString()
  }
  // Format YYYY/MM/DD HH:MM:SS or YYYY-MM-DD HH:MM:SS
  const s = String(v).trim()
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{1,2}))?)?$/)
  if (m) {
    const [, y, mo, d, hh = '0', mm = '0', ss = '0'] = m
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss))
    if (!isNaN(date.getTime())) return date.toISOString()
  }
  return s
}

export async function parseAccountTransactionXlsx(file: File): Promise<{
  rows: ParsedAccountTxRow[]
  warnings: string[]
}> {
  const warnings: string[] = []
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) {
    return { rows: [], warnings: ['Sheet pertama kosong di workbook'] }
  }

  // header_row_index = 1 (row 1 is header)
  const allArrays = (XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
  }))
  if (allArrays.length < 2) {
    return { rows: [], warnings: ['File terlalu pendek (perlu header row 1 + data row 2+)'] }
  }

  const headers = (allArrays[0] || []).map((h) => (h == null ? '' : String(h).trim()))
  const dataRows = allArrays.slice(1)

  const idxExtId = headers.findIndex((h) => h === 'ID Transaksi')
  const idxTxType = headers.findIndex((h) => h === 'Tipe Transaksi')
  const idxTracking = headers.findIndex((h) => h === 'Tracking Number')
  const idxUpdateTime = headers.findIndex((h) => h === 'Waktu Pembaruan Status')
  const idxNominal = headers.findIndex((h) => h === 'Nominal Transaksi(IDR)')
  const idxBalBefore = headers.findIndex((h) => h === 'Saldo Sebelum(IDR)')
  const idxBalAfter = headers.findIndex((h) => h === 'Saldo Sesudah(IDR)')
  const idxWithdrawalFee = headers.findIndex((h) => h === 'Biaya Penarikan(IDR)')
  const idxNetReceived = headers.findIndex((h) => h === 'Jumlah Transfer Bank Penarikan(IDR)')
  const idxStatus = headers.findIndex((h) => h === 'Status')
  const idxBankAccount = headers.findIndex((h) => h === 'Akun bank penarikan')
  const idxRefNo = headers.findIndex((h) => h === 'Transaction Reference No')
  const idxRejection = headers.findIndex((h) => h === 'Alasan Penolakan Penarikan')
  const idxCreateTime = headers.findIndex((h) => h === 'Create Time')
  const idxCompleteTime = headers.findIndex((h) => h === 'Complete Time')

  if (idxExtId < 0) warnings.push('Kolom "ID Transaksi" tidak ditemukan di header row 1')
  if (idxTxType < 0) warnings.push('Kolom "Tipe Transaksi" tidak ditemukan')
  if (idxNominal < 0) warnings.push('Kolom "Nominal Transaksi(IDR)" tidak ditemukan')
  if (idxCompleteTime < 0) warnings.push('Kolom "Complete Time" tidak ditemukan')

  const rows: ParsedAccountTxRow[] = []
  for (const arr of dataRows) {
    if (!Array.isArray(arr) || arr.length === 0) continue
    const externalId = idxExtId >= 0 ? coerceString(arr[idxExtId]) : ''
    if (!externalId) continue  // skip empty rows / footers

    const txType = idxTxType >= 0 ? coerceString(arr[idxTxType]) : ''
    const status = idxStatus >= 0 ? coerceString(arr[idxStatus]) : ''

    // Skip rejected/pending withdrawals — only process Berhasil + COD
    // (Brief: "yang status 'Berhasil' aja yang valid")
    if (txType === 'Penarikan' && status !== 'Berhasil') continue

    const raw: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      if (h) raw[h] = arr[i] ?? ''
    })

    rows.push({
      external_id: externalId,
      tx_type: txType,
      tracking: idxTracking >= 0 ? coerceString(arr[idxTracking]) : '',
      update_time: idxUpdateTime >= 0 ? coerceDateTime(arr[idxUpdateTime]) : '',
      nominal: idxNominal >= 0 ? coerceNumeric(arr[idxNominal]) : 0,
      balance_before: idxBalBefore >= 0 ? coerceNumeric(arr[idxBalBefore]) : 0,
      balance_after: idxBalAfter >= 0 ? coerceNumeric(arr[idxBalAfter]) : 0,
      withdrawal_fee: idxWithdrawalFee >= 0 ? coerceNumeric(arr[idxWithdrawalFee]) : 0,
      net_received: idxNetReceived >= 0 ? coerceNumeric(arr[idxNetReceived]) : 0,
      status,
      bank_account: idxBankAccount >= 0 ? coerceString(arr[idxBankAccount]) : '',
      reference_no: idxRefNo >= 0 ? coerceString(arr[idxRefNo]) : '',
      rejection_reason: idxRejection >= 0 ? coerceString(arr[idxRejection]) : '',
      create_time: idxCreateTime >= 0 ? coerceDateTime(arr[idxCreateTime]) : '',
      complete_time: idxCompleteTime >= 0 ? coerceDateTime(arr[idxCompleteTime]) : '',
      raw,
    })
  }

  return { rows, warnings }
}
