// =============================================================
// Phase 8I — SPX Financial Reconciliation: XLSX parser util
// =============================================================
// Parses SPX Financial Report .xlsx file (header_row_index=2) dan extract
// 4 kolom yang relevan untuk reconciliation:
//   - Tracking Number       → resi
//   - COD Amount (IDR)      → cod_amount
//   - Escrow amount (IDR)   → payout_amount
//   - Actual Shipping Fee (IDR) → shipping_cost_actual
//
// Output shape match dengan RPC preview_spx_recon expectations:
//   Array<{ resi, cod_amount, payout_amount, shipping_cost_actual, raw? }>
// =============================================================
import * as XLSX from 'xlsx'

export interface ParsedSpxRow {
  resi: string
  cod_amount: number
  payout_amount: number
  shipping_cost_actual: number
  /** Passthrough untuk audit/debug — full raw row */
  raw?: Record<string, unknown>
}

/** Coerce SPX numeric cell:
 *  - empty / '-' / null → 0
 *  - number → as-is
 *  - "1.234,56" / "1,234.56" → parse
 */
function coerceNumeric(v: unknown): number {
  if (v == null || v === '' || v === '-') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v).trim()
  if (s === '' || s === '-') return 0
  // Strip non-digit/dot/minus, treat comma as decimal separator if dot absent
  let cleaned = s.replace(/[^\d.,\-]/g, '')
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.')
  } else {
    cleaned = cleaned.replace(/,/g, '')
  }
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

/**
 * Parse SPX Financial Report XLSX file. Header di row 2 (row 1 = section
 * label "Order detail").
 *
 * Returns parsed rows + warnings array.
 */
export async function parseSpxFinancialXlsx(file: File): Promise<{
  rows: ParsedSpxRow[]
  warnings: string[]
}> {
  const warnings: string[] = []
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) {
    return { rows: [], warnings: ['Sheet pertama kosong di workbook'] }
  }

  // header_row_index = 2 untuk format SPX (row 1 = title section, row 2 = headers)
  const allArrays = (XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
  }))
  if (allArrays.length < 3) {
    return { rows: [], warnings: ['File terlalu pendek (perlu header row 2 + data row 3+)'] }
  }

  const headers = (allArrays[1] || []).map((h) => (h == null ? '' : String(h).trim()))
  const dataRows = allArrays.slice(2)

  // Resolve column index untuk 4 field yang dipakai
  const idxResi = headers.findIndex((h) => h === 'Tracking Number')
  const idxCod = headers.findIndex((h) => h === 'COD Amount (IDR)')
  const idxPayout = headers.findIndex((h) => h === 'Escrow amount (IDR)')
  const idxShipping = headers.findIndex((h) => h === 'Actual Shipping Fee (IDR)')

  if (idxResi < 0) warnings.push('Kolom "Tracking Number" tidak ditemukan di header row 2')
  if (idxPayout < 0) warnings.push('Kolom "Escrow amount (IDR)" tidak ditemukan')
  if (idxShipping < 0) warnings.push('Kolom "Actual Shipping Fee (IDR)" tidak ditemukan')
  if (idxCod < 0) warnings.push('Kolom "COD Amount (IDR)" tidak ditemukan')

  const rows: ParsedSpxRow[] = []
  for (const arr of dataRows) {
    if (!Array.isArray(arr) || arr.length === 0) continue
    const resiCell = idxResi >= 0 ? arr[idxResi] : ''
    const resi = resiCell == null ? '' : String(resiCell).trim()
    // Skip empty rows / footer / "Subtotal" / "Grand Total" rows
    if (!resi || /^(subtotal|grand total|total)$/i.test(resi)) continue

    const raw: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      if (h) raw[h] = arr[i] ?? ''
    })

    rows.push({
      resi,
      cod_amount: idxCod >= 0 ? coerceNumeric(arr[idxCod]) : 0,
      payout_amount: idxPayout >= 0 ? coerceNumeric(arr[idxPayout]) : 0,
      shipping_cost_actual: idxShipping >= 0 ? coerceNumeric(arr[idxShipping]) : 0,
      raw,
    })
  }

  return { rows, warnings }
}
