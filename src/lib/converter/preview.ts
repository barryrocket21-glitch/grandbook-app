// =============================================================
// Light-weight parser preview (Phase 2B)
// Shares parser.ts core with engine.ts (Phase 3A).
// Pure function — no DB writes.
// =============================================================
import { applyTransform } from './transforms'
import { indexValueMappings, parseSource } from './parser'
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
    rawRows = await parseSource(profile, fileOrText, warnings)
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
      let postValue: unknown = rawVal
      const vmList = valueMapIndex.get(fm.source_field)
      if (vmList && rawVal != null) {
        const hit = vmList.get(String(rawVal))
        if (hit !== undefined) postValue = hit
      }
      if (fm.transform) {
        const result = applyTransform(fm.transform, postValue, { orders: out.orders })
        if (result.ok) {
          postValue = result.value
        } else {
          warnings.push(
            `Row ${idx + 1}: transform "${fm.transform}" gagal di field "${fm.source_field}" — ${result.reason}`
          )
        }
      }
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
