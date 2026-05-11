// =============================================================
// Meta Ads CSV Parser (Phase 5B)
//
// Parse Meta Ads Manager export → daily ad_spend rows.
// Mapping fleksibel: lookup multiple possible column names (Meta sering
// rename across regions: "Amount spent" / "Amount Spent (IDR)" / etc).
// =============================================================
import Papa from 'papaparse'

export interface MetaAdsRow {
  spend_date: string
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
}

/**
 * Possible column name variations. Lowercase keys.
 * First match wins (priority by order).
 */
const COLUMN_VARIANTS: Record<string, string[]> = {
  date: [
    'day',
    'date',
    'reporting starts',
    'reporting start',
  ],
  campaign_name: [
    'campaign name',
    'campaign',
  ],
  campaign_code: [
    'campaign id',
    'campaign_id',
  ],
  spend: [
    'amount spent (idr)',
    'amount spent',
    'amount_spent',
    'spend',
    'cost',
    'amount',
  ],
  impressions: [
    'impressions',
    'impression',
  ],
  reach: [
    'reach',
  ],
  clicks: [
    'link clicks',
    'clicks (all)',
    'clicks',
  ],
  conversions: [
    'purchases',
    'website purchases',
    'results',
    'conversions',
  ],
  revenue: [
    'purchases conversion value',
    'website purchases conversion value',
    'purchase conversion value',
    'conversion value',
    'revenue',
  ],
}

function detectColumn(headers: string[], variants: string[]): string | null {
  const lower = headers.map(h => h.toLowerCase().trim())
  for (const v of variants) {
    const idx = lower.indexOf(v)
    if (idx >= 0) return headers[idx]
  }
  // Fuzzy fallback: contains match
  for (const v of variants) {
    const idx = lower.findIndex(h => h.includes(v))
    if (idx >= 0) return headers[idx]
  }
  return null
}

function detectCurrency(spendHeader: string | null): string | null {
  if (!spendHeader) return null
  const m = spendHeader.toLowerCase().match(/\(([a-z]{3})\)/i)
  return m ? m[1].toUpperCase() : null
}

function parseDateFlexible(raw: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // DD/MM/YYYY or DD-MM-YYYY (Indonesia format)
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (m) {
    const d = m[1].padStart(2, '0')
    const mo = m[2].padStart(2, '0')
    return `${m[3]}-${mo}-${d}`
  }
  // MM/DD/YYYY (US, but Meta usually exports in account locale)
  // Try parse as Date as last resort
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return null
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null
  // Remove currency symbols, commas (thousands separator), spaces
  const cleaned = raw.replace(/[^0-9.,\-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  // If dot+comma both present, comma is decimal separator (European)
  let normalized = cleaned
  if (cleaned.includes('.') && cleaned.includes(',')) {
    // Comma is decimal, dot is thousands
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    // If comma followed by 2 digits at end → decimal; else thousands
    if (/,\d{1,2}$/.test(cleaned)) {
      normalized = cleaned.replace(',', '.')
    } else {
      normalized = cleaned.replace(/,/g, '')
    }
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export async function parseMetaAdsCsv(file: File | string): Promise<ParseResult> {
  const result: ParseResult = {
    rows: [],
    warnings: [],
    errors: [],
    totalRowsDetected: 0,
    detectedColumns: [],
    currencyDetected: null,
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

  const colDate = detectColumn(headers, COLUMN_VARIANTS.date)
  const colCampaignName = detectColumn(headers, COLUMN_VARIANTS.campaign_name)
  const colCampaignCode = detectColumn(headers, COLUMN_VARIANTS.campaign_code)
  const colSpend = detectColumn(headers, COLUMN_VARIANTS.spend)
  const colImpr = detectColumn(headers, COLUMN_VARIANTS.impressions)
  const colReach = detectColumn(headers, COLUMN_VARIANTS.reach)
  const colClicks = detectColumn(headers, COLUMN_VARIANTS.clicks)
  const colConv = detectColumn(headers, COLUMN_VARIANTS.conversions)
  const colRevenue = detectColumn(headers, COLUMN_VARIANTS.revenue)

  result.detectedColumns = [
    colDate ? `date=${colDate}` : 'date=MISSING',
    colCampaignName ? `campaign=${colCampaignName}` : 'campaign=MISSING',
    colCampaignCode ? `code=${colCampaignCode}` : 'code=(none)',
    colSpend ? `spend=${colSpend}` : 'spend=MISSING',
  ]

  if (!colDate) result.errors.push({ rowIndex: -1, message: 'Kolom "Day/Date" tidak ditemukan' })
  if (!colCampaignName) result.errors.push({ rowIndex: -1, message: 'Kolom "Campaign name" tidak ditemukan' })
  if (!colSpend) result.errors.push({ rowIndex: -1, message: 'Kolom "Amount spent / Spend" tidak ditemukan' })

  if (result.errors.length > 0) return result

  const currency = detectCurrency(colSpend)
  result.currencyDetected = currency
  if (currency && currency !== 'IDR') {
    result.warnings.push(`⚠️ Currency terdeteksi: ${currency} (bukan IDR). Pastikan angka sudah dikonversi manual sebelum import.`)
  }

  parsed.data.forEach((row, idx) => {
    try {
      const dateRaw = row[colDate!]
      const date = parseDateFlexible(dateRaw)
      if (!date) {
        result.errors.push({ rowIndex: idx, message: `Tanggal "${dateRaw}" tidak dikenali` })
        return
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
        spend_date: date,
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
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  if (result.rows.length === 0 && result.errors.length === 0) {
    result.warnings.push('CSV ke-parse tapi 0 row valid. Cek format kolom + header.')
  }

  return result
}

/**
 * Match parsed Meta CSV rows to existing campaigns DB.
 * Priority: campaign_code (Meta Campaign ID) → campaign_name (case-insensitive).
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
