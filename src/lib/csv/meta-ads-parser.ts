// =============================================================
// Meta Ads CSV Parser (Phase 5B + 5B-fix)
//
// Parse Meta Ads Manager export → daily ad_spend rows.
// Mapping fleksibel: lookup multiple possible column names dengan
// case-insensitive contains match, handle parentheses (e.g.
// "Jumlah yang dibelanjakan (IDR)" match ke "Jumlah yang dibelanjakan").
//
// 5B-fix:
//   - Indonesian locale variants (Awal pelaporan, Nama kampanye, etc)
//   - Add report_start_date + report_end_date di parsed row
//   - detectExportMode() — SNAPSHOT_SINGLE_DAY / SNAPSHOT_DATE_RANGE_AGGREGATE / DAILY_BREAKDOWN
// =============================================================
import Papa from 'papaparse'
import { getErrorMessage } from '@/lib/errors'

export type ExportMode =
  | 'SNAPSHOT_SINGLE_DAY'
  | 'SNAPSHOT_DATE_RANGE_AGGREGATE'
  | 'DAILY_BREAKDOWN'

export interface MetaAdsRow {
  spend_date: string                  // = report_start_date (untuk insert)
  report_start_date: string
  report_end_date: string | null      // null kalau column "Akhir pelaporan" tidak ada
  campaign_name: string
  campaign_code: string | null
  spend: number
  impressions: number | null
  reach: number | null
  clicks: number | null
  conversions: number | null
  revenue_reported: number | null
  currency: string | null
  raw: Record<string, string>
}

export interface ParseResult {
  rows: MetaAdsRow[]
  warnings: string[]
  errors: Array<{ rowIndex: number; message: string }>
  totalRowsDetected: number
  detectedColumns: string[]
  currencyDetected: string | null
  mode: ExportMode | null
  modeDetails: {
    /** Distinct (start_date, end_date) pairs di file */
    distinctDateRanges: Array<{ start: string; end: string | null; rowCount: number }>
    /** True kalau ada campaign yang muncul >1 dengan start_date beda */
    hasMultiDayPerCampaign: boolean
    /** True kalau ada row dengan start != end */
    hasRangeRows: boolean
  }
}

/**
 * Possible column name variations.
 * Lowercase tokens. Matcher = case-insensitive `contains`, parens stripped.
 * Order matters: higher priority first.
 */
const COLUMN_VARIANTS: Record<string, string[]> = {
  // Tanggal awal periode (utama untuk spend_date)
  date_start: [
    'awal pelaporan',                   // ID
    'reporting starts',                 // EN
    'reporting start',
    'day',                              // EN — daily breakdown header
    'date',
  ],
  // Tanggal akhir periode (untuk detect mode)
  date_end: [
    'akhir pelaporan',                  // ID
    'reporting ends',                   // EN
    'reporting end',
  ],
  campaign_name: [
    'nama kampanye',                    // ID
    'campaign name',                    // EN
    'campaign',
  ],
  campaign_code: [
    'campaign id',                      // EN — TIDAK ada di export ID standard
    'campaign_id',
    'id kampanye',                      // ID (jarang, optional)
  ],
  spend: [
    'jumlah yang dibelanjakan',         // ID — match "Jumlah yang dibelanjakan (IDR)"
    'amount spent',                     // EN — match "Amount spent (IDR)"
    'amount_spent',
    'biaya',                            // ID fallback
    'spend',
    'cost',
    'amount',
  ],
  impressions: [
    'impresi',                          // ID
    'impressions',                      // EN
    'impression',
    'tayangan',                         // ID (sometimes used standalone)
  ],
  reach: [
    'jangkauan',                        // ID
    'reach',                            // EN
  ],
  // PRIO: link clicks (ID/EN), fallback: clicks (semua)/clicks (all)
  clicks: [
    'klik tautan',                      // ID prio (= link clicks)
    'link clicks',                      // EN prio
    'klik (semua)',                     // ID fallback
    'clicks (all)',                     // EN fallback
    'all clicks',
    'clicks',
  ],
  conversions: [
    'hasil',                            // ID — "Hasil" = Results (purchases kalau objective SALES)
    'purchases',                        // EN
    'website purchases',
    'results',                          // EN
    'conversions',
    'pembelian',                        // ID alternative
  ],
  revenue: [
    'nilai konversi pembelian',         // ID — "Nilai Konversi Pembelian"
    'purchases conversion value',       // EN
    'website purchases conversion value',
    'purchase conversion value',
    'nilai konversi',                   // ID generic
    'conversion value',
    'revenue',
  ],
}

/**
 * Strip parentheses, currency symbols, extra whitespace.
 * Used for matching header against variant token.
 * "Jumlah yang dibelanjakan (IDR)" → "jumlah yang dibelanjakan"
 * "CPC (biaya per klik tautan) (IDR)" → "cpc biaya per klik tautan"
 */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')   // strip (...) groups
    .replace(/[^a-z0-9\s_]/g, ' ') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detect column dengan case-insensitive contains.
 * Strategy:
 *   1. Exact match (after normalize)
 *   2. variant ⊆ normalized header (header contains variant)
 *   3. normalized header ⊆ variant (variant contains header — rare)
 * Skip headers yang sudah pernah di-claim untuk field lain (avoid conflicts
 * like "CPC (semua) (IDR)" matching "klik (semua)").
 */
function detectColumn(
  headers: string[],
  variants: string[],
  exclude: Set<string>
): string | null {
  const normalized = headers.map(normalizeHeader)
  const usable = (h: string) => !exclude.has(h)

  // 1. Exact match
  for (const v of variants) {
    const vn = normalizeHeader(v)
    const idx = normalized.findIndex(
      (h, i) => h === vn && usable(headers[i])
    )
    if (idx >= 0) return headers[idx]
  }
  // 2. Variant token contained in header (header has variant as substring)
  //    Use word boundary feel via space-padding to avoid 'clicks' matching 'cost per click'-type collisions.
  for (const v of variants) {
    const vn = normalizeHeader(v)
    const idx = normalized.findIndex(
      (h, i) => h.startsWith(vn + ' ') || h.endsWith(' ' + vn) || h.includes(' ' + vn + ' ') || h === vn
        ? usable(headers[i])
        : false
    )
    if (idx >= 0) return headers[idx]
  }
  // 3. Fuzzy substring fallback
  for (const v of variants) {
    const vn = normalizeHeader(v)
    const idx = normalized.findIndex(
      (h, i) => h.includes(vn) && usable(headers[i])
    )
    if (idx >= 0) return headers[idx]
  }
  return null
}

function detectCurrency(spendHeader: string | null): string | null {
  if (!spendHeader) return null
  const m = spendHeader.match(/\(([A-Za-z]{3})\)/)
  return m ? m[1].toUpperCase() : null
}

/**
 * Parse date dengan berbagai format:
 * - ISO YYYY-MM-DD
 * - YYYY/MM/DD
 * - DD/MM/YYYY or DD-MM-YYYY (Indonesia)
 * - MM/DD/YYYY (US fallback via Date)
 */
export function parseDateFlexible(raw: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // YYYY/MM/DD
  let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/)
  if (m) {
    const mo = m[2].padStart(2, '0')
    const d = m[3].padStart(2, '0')
    return `${m[1]}-${mo}-${d}`
  }
  // DD/MM/YYYY or DD-MM-YYYY (Indonesia format, 4-digit year at end)
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (m) {
    const d = m[1].padStart(2, '0')
    const mo = m[2].padStart(2, '0')
    return `${m[3]}-${mo}-${d}`
  }
  // MM/DD/YYYY (US, via Date). Only accept kalau Date.parse return finite.
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return null
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9.,\-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  let normalized = cleaned
  if (cleaned.includes('.') && cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    if (/,\d{1,2}$/.test(cleaned)) {
      normalized = cleaned.replace(',', '.')
    } else {
      normalized = cleaned.replace(/,/g, '')
    }
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

/**
 * Detect export mode dari parsed rows.
 * Logic:
 *  - SNAPSHOT_DATE_RANGE_AGGREGATE: SEMUA row punya start != end (multi-day aggregate)
 *  - DAILY_BREAKDOWN: ada >=1 campaign yang muncul di >=2 unique start_date
 *  - SNAPSHOT_SINGLE_DAY: else (1 row per campaign, start == end or end absent)
 */
export function detectExportMode(rows: MetaAdsRow[]): {
  mode: ExportMode
  distinctDateRanges: Array<{ start: string; end: string | null; rowCount: number }>
  hasMultiDayPerCampaign: boolean
  hasRangeRows: boolean
} {
  if (rows.length === 0) {
    return {
      mode: 'SNAPSHOT_SINGLE_DAY',
      distinctDateRanges: [],
      hasMultiDayPerCampaign: false,
      hasRangeRows: false,
    }
  }

  // Group by (start, end) tuple → count rows
  const rangeMap = new Map<string, { start: string; end: string | null; rowCount: number }>()
  for (const r of rows) {
    const key = `${r.report_start_date}|${r.report_end_date ?? ''}`
    const cur = rangeMap.get(key)
    if (cur) cur.rowCount++
    else rangeMap.set(key, { start: r.report_start_date, end: r.report_end_date, rowCount: 1 })
  }
  const distinctDateRanges = Array.from(rangeMap.values())

  // Has any row with start != end (and end present)?
  const hasRangeRows = rows.some(r =>
    r.report_end_date && r.report_start_date !== r.report_end_date
  )

  // Has multi-day per campaign? Group by campaign_name → count unique start dates
  const perCampaign = new Map<string, Set<string>>()
  for (const r of rows) {
    const key = r.campaign_name.toLowerCase().trim()
    if (!perCampaign.has(key)) perCampaign.set(key, new Set())
    perCampaign.get(key)!.add(r.report_start_date)
  }
  const hasMultiDayPerCampaign = Array.from(perCampaign.values()).some(s => s.size > 1)

  // Decide mode
  let mode: ExportMode
  // SNAPSHOT_DATE_RANGE_AGGREGATE: SEMUA row start != end
  const allRange = rows.length > 0 && rows.every(r =>
    r.report_end_date && r.report_start_date !== r.report_end_date
  )
  if (allRange) {
    mode = 'SNAPSHOT_DATE_RANGE_AGGREGATE'
  } else if (hasMultiDayPerCampaign) {
    mode = 'DAILY_BREAKDOWN'
  } else {
    mode = 'SNAPSHOT_SINGLE_DAY'
  }

  return { mode, distinctDateRanges, hasMultiDayPerCampaign, hasRangeRows }
}

export async function parseMetaAdsCsv(file: File | string): Promise<ParseResult> {
  const result: ParseResult = {
    rows: [],
    warnings: [],
    errors: [],
    totalRowsDetected: 0,
    detectedColumns: [],
    currencyDetected: null,
    mode: null,
    modeDetails: {
      distinctDateRanges: [],
      hasMultiDayPerCampaign: false,
      hasRangeRows: false,
    },
  }

  const text = typeof file === 'string' ? file : await file.text()

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  })

  if (parsed.errors.length > 0) {
    for (const e of parsed.errors.slice(0, 5)) {
      result.warnings.push(`Parse warning (row ${e.row ?? '?'}): ${e.message}`)
    }
  }

  const headers = parsed.meta.fields || []
  result.totalRowsDetected = parsed.data.length

  // Detect columns. Exclude set prevents header dipakai 2x untuk field beda.
  const claimed = new Set<string>()
  const detect = (variants: string[]) => {
    const found = detectColumn(headers, variants, claimed)
    if (found) claimed.add(found)
    return found
  }

  const colDateStart = detect(COLUMN_VARIANTS.date_start)
  const colDateEnd = detect(COLUMN_VARIANTS.date_end)
  const colCampaignName = detect(COLUMN_VARIANTS.campaign_name)
  const colCampaignCode = detect(COLUMN_VARIANTS.campaign_code)
  const colSpend = detect(COLUMN_VARIANTS.spend)
  const colImpr = detect(COLUMN_VARIANTS.impressions)
  const colReach = detect(COLUMN_VARIANTS.reach)
  const colClicks = detect(COLUMN_VARIANTS.clicks)
  const colConv = detect(COLUMN_VARIANTS.conversions)
  const colRevenue = detect(COLUMN_VARIANTS.revenue)

  result.detectedColumns = [
    colDateStart ? `start=${colDateStart}` : 'start=MISSING',
    colDateEnd ? `end=${colDateEnd}` : 'end=(none)',
    colCampaignName ? `campaign=${colCampaignName}` : 'campaign=MISSING',
    colCampaignCode ? `code=${colCampaignCode}` : 'code=(none)',
    colSpend ? `spend=${colSpend}` : 'spend=MISSING',
    colImpr ? `impr=${colImpr}` : 'impr=(none)',
    colReach ? `reach=${colReach}` : 'reach=(none)',
    colClicks ? `clicks=${colClicks}` : 'clicks=(none)',
    colConv ? `conv=${colConv}` : 'conv=(none)',
    colRevenue ? `revenue=${colRevenue}` : 'revenue=(none)',
  ]

  if (!colDateStart) result.errors.push({ rowIndex: -1, message: 'Kolom tanggal awal ("Awal pelaporan" / "Day" / "Reporting starts") tidak ditemukan' })
  if (!colCampaignName) result.errors.push({ rowIndex: -1, message: 'Kolom campaign ("Nama kampanye" / "Campaign name") tidak ditemukan' })
  if (!colSpend) result.errors.push({ rowIndex: -1, message: 'Kolom spend ("Jumlah yang dibelanjakan" / "Amount spent") tidak ditemukan' })

  if (result.errors.length > 0) return result

  const currency = detectCurrency(colSpend)
  result.currencyDetected = currency
  if (currency && currency !== 'IDR') {
    result.warnings.push(`⚠️ Currency terdeteksi: ${currency} (bukan IDR). Pastikan angka sudah dikonversi manual sebelum import.`)
  }

  parsed.data.forEach((row, idx) => {
    try {
      const startRaw = row[colDateStart!]
      const startDate = parseDateFlexible(startRaw)
      if (!startDate) {
        result.errors.push({ rowIndex: idx, message: `Tanggal awal "${startRaw}" tidak dikenali` })
        return
      }
      let endDate: string | null = null
      if (colDateEnd) {
        const endRaw = row[colDateEnd]
        if (endRaw && endRaw.trim()) {
          endDate = parseDateFlexible(endRaw)
          if (!endDate) {
            result.warnings.push(`Row ${idx + 1}: tanggal akhir "${endRaw}" tidak dikenali, treat sebagai snapshot single day`)
          }
        }
      }

      const campaign_name = (row[colCampaignName!] || '').trim()
      if (!campaign_name) {
        result.errors.push({ rowIndex: idx, message: 'Campaign name kosong' })
        return
      }
      const spend = parseNumber(row[colSpend!])
      if (spend === null || spend < 0) {
        result.errors.push({ rowIndex: idx, message: `Spend "${row[colSpend!]}" tidak valid` })
        return
      }

      const campaign_code = colCampaignCode ? (row[colCampaignCode] || '').trim() || null : null
      const impressions = colImpr ? parseNumber(row[colImpr]) : null
      const reach = colReach ? parseNumber(row[colReach]) : null
      const clicks = colClicks ? parseNumber(row[colClicks]) : null
      const conversions = colConv ? parseNumber(row[colConv]) : null
      const revenue_reported = colRevenue ? parseNumber(row[colRevenue]) : null

      result.rows.push({
        spend_date: startDate,
        report_start_date: startDate,
        report_end_date: endDate,
        campaign_name,
        campaign_code,
        spend,
        impressions: impressions !== null ? Math.round(impressions) : null,
        reach: reach !== null ? Math.round(reach) : null,
        clicks: clicks !== null ? Math.round(clicks) : null,
        conversions: conversions !== null ? Math.round(conversions) : null,
        revenue_reported,
        currency,
        raw: row,
      })
    } catch (err) {
      result.errors.push({
        rowIndex: idx,
        message: getErrorMessage(err),
      })
    }
  })

  // Detect export mode dari parsed rows
  if (result.rows.length > 0) {
    const det = detectExportMode(result.rows)
    result.mode = det.mode
    result.modeDetails = {
      distinctDateRanges: det.distinctDateRanges,
      hasMultiDayPerCampaign: det.hasMultiDayPerCampaign,
      hasRangeRows: det.hasRangeRows,
    }
  }

  if (result.rows.length === 0 && result.errors.length === 0) {
    result.warnings.push('CSV ke-parse tapi 0 row valid. Cek format kolom + header.')
  }

  return result
}

/**
 * Match parsed Meta CSV rows to existing campaigns DB.
 * Priority: campaign_code (kalau ada di CSV + DB) → campaign_name (case-insensitive).
 * Note: Indonesian export TIDAK ada Campaign ID column, jadi praktis selalu by name.
 */
export interface MatchResult {
  matched: number
  unmatched_campaign_names: string[]
  matched_rows: Array<{ row: MetaAdsRow; campaign_id: number; match_by: 'code' | 'name' }>
  unmatched_rows: MetaAdsRow[]
}

export function matchToCampaigns(
  parsedRows: MetaAdsRow[],
  campaigns: Array<{ id: number; campaign_name: string; campaign_code?: string | null }>
): MatchResult {
  const byCode = new Map<string, number>()
  const byName = new Map<string, number>()
  for (const c of campaigns) {
    if (c.campaign_code) byCode.set(c.campaign_code, c.id)
    byName.set(c.campaign_name.toLowerCase().trim(), c.id)
  }

  const matched_rows: MatchResult['matched_rows'] = []
  const unmatched_rows: MetaAdsRow[] = []
  const unmatched_names = new Set<string>()

  for (const r of parsedRows) {
    let id: number | undefined
    let mode: 'code' | 'name' | null = null
    if (r.campaign_code && byCode.has(r.campaign_code)) {
      id = byCode.get(r.campaign_code)
      mode = 'code'
    } else if (byName.has(r.campaign_name.toLowerCase().trim())) {
      id = byName.get(r.campaign_name.toLowerCase().trim())
      mode = 'name'
    }
    if (id !== undefined && mode) {
      matched_rows.push({ row: r, campaign_id: id, match_by: mode })
    } else {
      unmatched_rows.push(r)
      unmatched_names.add(r.campaign_name)
    }
  }

  return {
    matched: matched_rows.length,
    unmatched_campaign_names: Array.from(unmatched_names).sort(),
    matched_rows,
    unmatched_rows,
  }
}
