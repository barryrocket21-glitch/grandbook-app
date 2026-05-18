/**
 * Phase 8I-Phone DEBUG — reproduce XLSX phone scientific notation bug.
 *
 * Tests 4 SheetJS read modes pada file Orderonline real:
 *   MODE 0: workbook structure introspection (headers, cell types)
 *   MODE 1: sheet_to_json default (project current behavior, raw:false)
 *   MODE 2: sheet_to_json raw:true (proposed fix)
 *   MODE 3: cell direct access (cell.v vs cell.w)
 *
 * Run: npx tsx scripts/debug-xlsx-phone.ts
 */
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

const filePath = '/Users/mr.nobody/Downloads/orderonline_orders_19-05-2026_cjqTlMHUx1SX1aeVvqqK.xlsx'
const buffer = readFileSync(filePath)
const workbook = XLSX.read(buffer, { type: 'buffer' })
const sheetName = workbook.SheetNames[0]
const sheet = workbook.Sheets[sheetName]

console.log(`=== MODE 0: workbook structure ===`)
console.log(`Sheet: ${sheetName}`)
console.log(`Ref: ${sheet['!ref']}`)

// Get header row (row 1)
const range = XLSX.utils.decode_range(sheet['!ref']!)
const headers: { col: string; value: string }[] = []
for (let c = range.s.c; c <= range.e.c; c++) {
  const cellAddr = XLSX.utils.encode_cell({ r: 0, c })
  const cell = sheet[cellAddr]
  if (cell) headers.push({ col: XLSX.utils.encode_col(c), value: String(cell.v ?? '') })
}
console.log(`Headers (${headers.length}):`)
for (const h of headers) console.log(`  ${h.col} = "${h.value}"`)

// Find phone column
const phoneHeader = headers.find(h =>
  /phone|telp|hp|nomor/i.test(h.value),
)
console.log(`\nDetected phone column: ${JSON.stringify(phoneHeader)}`)

console.log(`\n=== MODE 1: sheet_to_json default (raw:false — current parser.ts behavior) ===`)
const rows1 = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
  raw: false,
  defval: '',
})
for (let i = 0; i < Math.min(3, rows1.length); i++) {
  const r = rows1[i]
  const phoneKey = phoneHeader?.value ?? 'phone'
  console.log(`  row ${i + 2}: phone="${r[phoneKey]}" type=${typeof r[phoneKey]}`)
}

console.log(`\n=== MODE 2: sheet_to_json raw:true (proposed fix) ===`)
const rows2 = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
  raw: true,
  defval: '',
})
for (let i = 0; i < Math.min(3, rows2.length); i++) {
  const r = rows2[i]
  const phoneKey = phoneHeader?.value ?? 'phone'
  const v = r[phoneKey]
  console.log(`  row ${i + 2}: phone=${JSON.stringify(v)} type=${typeof v} ${typeof v === 'number' ? `(toString="${v.toString()}", isInt=${Number.isInteger(v)})` : ''}`)
}

console.log(`\n=== MODE 3: cell direct access (rows 2-4 phone column) ===`)
if (phoneHeader) {
  for (let r = 1; r <= 3; r++) {  // Excel rows 2, 3, 4 (zero-indexed 1, 2, 3)
    const addr = `${phoneHeader.col}${r + 1}`
    const cell = sheet[addr]
    console.log(`  ${addr}: cell.v=${JSON.stringify(cell?.v)} (type=${typeof cell?.v}) | cell.w="${cell?.w}" | cell.t="${cell?.t}" | cell.z="${cell?.z}"`)
  }
}

console.log(`\n=== MODE 4: how String() converts integer 13 digit ===`)
const testNum = 6285281479899
console.log(`  String(${testNum}) = "${String(testNum)}"`)
console.log(`  ${testNum}.toString() = "${testNum.toString()}"`)
console.log(`  ${testNum}.toFixed(0) = "${testNum.toFixed(0)}"`)
console.log(`  Number.isInteger(${testNum}) = ${Number.isInteger(testNum)}`)
console.log(`  Implicit conversion via template literal: "${testNum}"`)

// Conclusion summary
console.log(`\n=== SUMMARY ===`)
console.log(`raw:false mode (current) corrupts phone? ${
  typeof rows1[0]?.[phoneHeader?.value ?? 'phone'] === 'string'
  && /[eE][+-]?\d+/.test(String(rows1[0]?.[phoneHeader?.value ?? 'phone']))
    ? 'YES — scientific notation detected'
    : 'NO — phone string OK'
}`)
console.log(`raw:true mode (proposed) gives integer? ${
  typeof rows2[0]?.[phoneHeader?.value ?? 'phone'] === 'number'
    ? 'YES — number type preserved'
    : 'NO — see actual type above'
}`)
