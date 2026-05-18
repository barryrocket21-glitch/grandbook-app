/**
 * Phase 8I-Phone VERIFY — run new parseXlsx logic on real Orderonline file.
 * Mirror exact production behavior + check normalize_phone_id_safe handling.
 */
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'
import { normalize_phone_id_safe, applyTransform } from '../src/lib/converter/transforms'

const filePath = '/Users/mr.nobody/Downloads/orderonline_orders_19-05-2026_cjqTlMHUx1SX1aeVvqqK.xlsx'
const buffer = readFileSync(filePath)

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

const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
const sheet = wb.Sheets[wb.SheetNames[0]]
const allArrays = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
  header: 1,
  raw: true,
  defval: '',
}).map(row => row.map(coerceXlsxCell))

const headers = (allArrays[0] as string[]).map(h => String(h ?? ''))
const dataRows = allArrays.slice(1)
const phoneIdx = headers.indexOf('phone')
const nameIdx = headers.indexOf('name')

console.log(`=== Headers: ${headers.length} cols, dataRows: ${dataRows.length} ===`)
console.log(`Phone column index: ${phoneIdx}, Name index: ${nameIdx}`)

console.log(`\n=== Phone values after coerceXlsxCell (first 5 rows) ===`)
for (let i = 0; i < Math.min(5, dataRows.length); i++) {
  const row = dataRows[i] as unknown[]
  const phone = row[phoneIdx]
  const name = row[nameIdx]
  console.log(`  row ${i + 2}: name="${name}" phone=${JSON.stringify(phone)} type=${typeof phone}`)
}

console.log(`\n=== Pipe through normalize_phone_id_safe (mirror engine path) ===`)
let validCount = 0
let invalidCount = 0
for (let i = 0; i < dataRows.length; i++) {
  const row = dataRows[i] as unknown[]
  const phoneRaw = row[phoneIdx]
  const safe = normalize_phone_id_safe(phoneRaw)
  if (safe.isValid) validCount++
  else invalidCount++
  if (i < 3) {
    console.log(`  row ${i + 2}: raw=${JSON.stringify(phoneRaw)} → isValid=${safe.isValid} phone="${safe.phone}" reason=${(safe as { reason?: string }).reason ?? '-'}`)
  }
}
console.log(`  Total: ${validCount} valid, ${invalidCount} invalid`)

console.log(`\n=== Pipe through applyTransform('normalize_phone_id') (engine-side transform) ===`)
for (let i = 0; i < Math.min(3, dataRows.length); i++) {
  const row = dataRows[i] as unknown[]
  const phoneRaw = row[phoneIdx]
  const result = applyTransform('normalize_phone_id', phoneRaw)
  console.log(`  row ${i + 2}: raw=${JSON.stringify(phoneRaw)} → transformed=${JSON.stringify((result as { value?: unknown }).value ?? result)}`)
}

console.log(`\n=== Verify CSV refusal regex does NOT false-positive on integer string ===`)
const refusalRegex = /\b\d+(?:\.\d+)?[eE][+-]?\d+\b/g
const testStrings = ['6285281479899', '+6285281479899', '6.28528E+12', '6.28e+12', 'name: John, phone: +6285281479899']
for (const s of testStrings) {
  const matches = s.match(refusalRegex)
  console.log(`  "${s}" → match count: ${matches?.length ?? 0}`)
}

console.log(`\n=== SUMMARY ===`)
console.log(`  Phone preservation: ${dataRows.length > 0 && typeof (dataRows[0] as unknown[])[phoneIdx] === 'string' && (dataRows[0] as unknown[])[phoneIdx] === '6285281479899' ? '✅ PASS' : '❌ FAIL'}`)
console.log(`  Phone validity: ${validCount}/${dataRows.length} valid (target: ${dataRows.length}/${dataRows.length})`)
