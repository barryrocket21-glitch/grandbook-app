// =============================================================
// Light-weight parser preview (Phase 2B)
// Pure function — no DB writes, no side-effects.
// Engine production akan dibangun di Phase 3.
// =============================================================
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { applyTransform } from './transforms'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
} from '@/lib/types'

export interface ParsedRow {
  orders: Record<string, unknown>
  order_items: Record<string, unknown>
  meta: Record<string, unknown>
  file_column: Record<string, unknown>
  raw: Record<string, unknown>
}

export interface PreviewResult {
  rows: ParsedRow[]
  totalRowsDetected: number
  warnings: string[]
  errors: string[]
}

const EMPTY: PreviewResult = { rows: [], totalRowsDetected: 0, warnings: [], errors: [] }

export async function previewParse(
  profile: ConverterProfile,
  fieldMappings: ConverterFieldMapping[],
  valueMappings: ConverterValueMapping[],
  fileOrText: File | string,
  maxRows = 3
): Promise<PreviewResult> {
  if (profile.direction === 'OUTBOUND_TO_COURIER') {
    return {
      ...EMPTY,
      errors: ['OUTBOUND parser preview akan tersedia di Phase 3 (Converter Engine).'],
    }
  }

  const warnings: string[] = []
  const errors: string[] = []
  let rawRows: Record<string, unknown>[] = []

  try {
    if (profile.direction === 'WA_PASTE') {
      if (typeof fileOrText !== 'string') {
        errors.push('WA_PASTE butuh paste text, bukan file.')
        return { ...EMPTY, errors }
      }
      if (!profile.regex_pattern) {
        errors.push('Profile belum set regex_pattern.')
        return { ...EMPTY, errors }
      }
      rawRows = parseRegex(fileOrText, profile.regex_pattern, warnings)
    } else {
      if (!(fileOrText instanceof File)) {
        errors.push('Profile butuh upload file (CSV/XLSX).')
        return { ...EMPTY, errors }
      }
      if (profile.file_format === 'CSV') {
        rawRows = await parseCsv(fileOrText, profile)
      } else if (profile.file_format === 'XLSX') {
        rawRows = await parseXlsx(fileOrText, profile)
      } else {
        errors.push(`File format "${profile.file_format}" tidak didukung di preview.`)
        return { ...EMPTY, errors }
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    return { ...EMPTY, errors }
  }

  const totalRowsDetected = rawRows.length
  const sliced = rawRows.slice(0, maxRows)
  const valueMapIndex = indexValueMappings(valueMappings)

  const rows: ParsedRow[] = sliced.map((raw, idx) => {
    const out: ParsedRow = {
      orders: {},
      order_items: {},
      meta: {},
      file_column: {},
      raw,
    }
    for (const fm of fieldMappings) {
      const rawVal = raw[fm.source_field]
      // value mapping
      let postValue: unknown = rawVal
      const vmKey = fm.source_field
      const vmList = valueMapIndex.get(vmKey)
      if (vmList && rawVal != null) {
        const hit = vmList.get(String(rawVal))
        if (hit !== undefined) postValue = hit
      }
      // transform
      if (fm.transform) {
        const result = applyTransform(fm.transform, postValue)
        if (result.ok) {
          postValue = result.value
        } else {
          warnings.push(`Row ${idx + 1}: transform "${fm.transform}" gagal di field "${fm.source_field}" — ${result.reason}`)
        }
      }
      // required check
      if (
        fm.required &&
        (postValue == null || (typeof postValue === 'string' && postValue.trim() === ''))
      ) {
        warnings.push(`Row ${idx + 1}: required field "${fm.target_field}" (${fm.target_table}) kosong`)
      }
      const bucket = out[fm.target_table as keyof ParsedRow]
      if (bucket && typeof bucket === 'object' && !Array.isArray(bucket)) {
        ;(bucket as Record<string, unknown>)[fm.target_field] = postValue
      }
    }
    return out
  })

  return { rows, totalRowsDetected, warnings, errors }
}

function indexValueMappings(
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

async function parseCsv(file: File, profile: ConverterProfile): Promise<Record<string, unknown>[]> {
  const text = await readFileAsText(file, profile.file_encoding || 'utf-8')
  // Skip rows before header_row_index when has_header_row & index > 1
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

async function parseXlsx(file: File, profile: ConverterProfile): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const headerRowIdx = profile.has_header_row ? profile.header_row_index : 1
  // sheet_to_json with header option uses 0-based skipping
  const allArrays = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  })
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

function parseRegex(text: string, pattern: string, warnings: string[]): Record<string, unknown>[] {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'gm')
  } catch (err) {
    throw new Error(`Regex tidak valid: ${err instanceof Error ? err.message : String(err)}`)
  }
  const rows: Record<string, unknown>[] = []
  let m: RegExpExecArray | null
  let safety = 0
  while ((m = re.exec(text)) !== null && safety < 1000) {
    safety++
    const groups = m.groups || {}
    if (Object.keys(groups).length === 0) {
      warnings.push('Regex pattern tidak punya named groups (?<name>...). Hasil tidak bisa di-mapping.')
      return []
    }
    rows.push({ ...groups })
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return rows
}

function readFileAsText(file: File, encoding: string): Promise<string> {
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
