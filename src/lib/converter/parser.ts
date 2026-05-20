// =============================================================
// Shared parsing utilities (used by preview.ts AND engine.ts)
// Pure functions — no DB writes.
// =============================================================
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ConverterProfile, ConverterValueMapping } from '@/lib/types'

export function indexValueMappings(
  list: ConverterValueMapping[]
): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>()
  for (const v of list) {
    let inner = map.get(v.source_field)
    if (!inner) {
      inner = new Map()
      map.set(v.source_field, inner)
    }
    inner.set(v.raw_value, v.mapped_value)
  }
  return map
}

export async function parseCsv(
  file: File,
  profile: ConverterProfile
): Promise<Record<string, unknown>[]> {
  const text = await readFileAsText(file, profile.file_encoding || 'utf-8')
  let textToParse = text
  if (profile.has_header_row && profile.header_row_index > 1) {
    const lines = text.split(/\r?\n/)
    textToParse = lines.slice(profile.header_row_index - 1).join('\n')
  }
  if (!profile.has_header_row) {
    const arrResult = Papa.parse<unknown[]>(textToParse, {
      header: false,
      delimiter: profile.file_delimiter || undefined,
      skipEmptyLines: true,
    })
    return (arrResult.data || []).map((arr) => {
      const obj: Record<string, unknown> = {}
      arr.forEach((v, i) => {
        obj[`col${i + 1}`] = v
      })
      return obj
    })
  }
  const result = Papa.parse<Record<string, unknown>>(textToParse, {
    header: true,
    delimiter: profile.file_delimiter || undefined,
    skipEmptyLines: true,
  })
  return result.data || []
}

/**
 * Phase 8I-Phone — preserve raw cell value to avoid Excel's scientific notation
 * corruption pada integer 13 digit (phone numbers). SheetJS dengan raw:false
 * pakai cell.w (formatted display); untuk cell type 'n' format General, Excel
 * render integer panjang sebagai "6.28528E+12" → string presisi hilang.
 *
 * Fix: raw:true di sheet_to_json + cellDates:true di XLSX.read, lalu coerce
 * setiap cell ke representation aman:
 *   - number → toFixed(0) untuk integer (preserves "6285281479899"), else String()
 *     Note: plain String() di JS sudah aman, toFixed(0) eksplisit untuk clarity.
 *   - Date object (dari cellDates) → ISO string. Downstream transform parse_date_*
 *     mungkin perlu update kalau profile pakai date-typed cells (saat ini
 *     orderonline + SPX rekonsil store dates as STRING cells, jadi no regression).
 *   - null/undefined → ''
 *   - else → pass-through
 */
function coerceXlsxCell(v: unknown): unknown {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toFixed(0) : String(v)
  }
  if (v instanceof Date) {
    return v.toISOString()
  }
  return v
}

export async function parseXlsx(
  file: File,
  profile: ConverterProfile
): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const headerRowIdx = profile.has_header_row ? profile.header_row_index : 1
  const allArrays = (XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
  })).map(row => row.map(coerceXlsxCell))
  if (allArrays.length === 0) return []
  if (!profile.has_header_row) {
    return allArrays.map((arr) => {
      const obj: Record<string, unknown> = {}
      arr.forEach((v, i) => {
        obj[`col${i + 1}`] = v
      })
      return obj
    })
  }
  const headers = (allArrays[headerRowIdx - 1] || []).map((h) => (h == null ? '' : String(h)))
  const dataRows = allArrays.slice(headerRowIdx)
  return dataRows.map((arr) => {
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      if (h) obj[h] = arr[i] ?? ''
    })
    return obj
  })
}

/**
 * WhatsApp Web copy format header pattern.
 * Matches `[HH.MM, dd/mm/yyyy] Sender Name: ` at start of line (Indonesian locale).
 * Only consumes the timestamp + sender prefix — order content on same line preserved.
 *
 * Example match: `[21.12, 20/5/2026] Bojo Pertama: ` (leaves `(10) CS : Fiaro\n...` intact)
 *
 * Used to split multi-order paste into per-order blocks (Phase 8K).
 */
const WA_TIMESTAMP_LINE = /^\[\d{1,2}[.:]\d{1,2}[,\s]+\d{1,2}\/\d{1,2}\/\d{2,4}\]\s*[^:\n]+?:\s*/gm

/**
 * Split text into per-order blocks based on WA timestamp lines.
 * If no timestamps found → return [text] (single block, backward compat).
 */
function splitByWaTimestamp(text: string): string[] {
  // String.split with regex preserves segments between matches.
  // First element is text BEFORE first timestamp (usually empty).
  const parts = text.split(WA_TIMESTAMP_LINE).map(p => p.trim()).filter(p => p.length > 0)
  return parts.length > 0 ? parts : [text]
}

export function parseRegex(
  text: string,
  pattern: string,
  warnings: string[]
): Record<string, unknown>[] {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'gm')
  } catch (err) {
    throw new Error(`Regex tidak valid: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Phase 8K — pre-split multi-order WA paste by timestamp line, then apply
  // pattern per block. Profile regex stays simple (single-block extraction).
  const blocks = splitByWaTimestamp(text)

  const rows: Record<string, unknown>[] = []
  let warnedNoGroups = false

  for (const block of blocks) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    let safety = 0
    // Within each block, run pattern as before (loop in case pattern matches
    // multiple times within 1 block — rare but possible for non-WA formats).
    while ((m = re.exec(block)) !== null && safety < 5000) {
      safety++
      const groups = m.groups || {}
      if (Object.keys(groups).length === 0) {
        if (!warnedNoGroups) {
          warnings.push('Regex pattern tidak punya named groups (?<name>...). Hasil tidak bisa di-mapping.')
          warnedNoGroups = true
        }
        break
      }
      rows.push({ ...groups })
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return rows
}

export function readFileAsText(file: File, encoding: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error || new Error('Gagal baca file'))
    try {
      reader.readAsText(file, encoding)
    } catch {
      reader.readAsText(file)
    }
  })
}

/**
 * Parse the source (file or text) into raw rows according to profile.
 * Throws on hard parse errors. Returns empty for unsupported direction.
 */
export async function parseSource(
  profile: ConverterProfile,
  fileOrText: File | string,
  warnings: string[]
): Promise<Record<string, unknown>[]> {
  if (profile.direction === 'WA_PASTE') {
    if (typeof fileOrText !== 'string') {
      throw new Error('WA_PASTE butuh paste text, bukan file.')
    }
    if (!profile.regex_pattern) {
      throw new Error('Profile belum set regex_pattern.')
    }
    return parseRegex(fileOrText, profile.regex_pattern, warnings)
  }
  if (!(fileOrText instanceof File)) {
    throw new Error('Profile butuh upload file (CSV/XLSX).')
  }
  if (profile.file_format === 'CSV') return parseCsv(fileOrText, profile)
  if (profile.file_format === 'XLSX') return parseXlsx(fileOrText, profile)
  throw new Error(`File format "${profile.file_format}" tidak didukung.`)
}
