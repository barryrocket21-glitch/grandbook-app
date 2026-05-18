import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

const buffer = readFileSync('/Users/mr.nobody/Downloads/orderonline_orders_19-05-2026_cjqTlMHUx1SX1aeVvqqK.xlsx')
const wb = XLSX.read(buffer, { type: 'buffer' })
const sheet = wb.Sheets[wb.SheetNames[0]]

const dateCols = ['AD', 'AE', 'AF', 'AG']
const dateNames = ['created_at', 'processing_at', 'completed_at', 'paid_at']

console.log('=== Cell direct access for date columns (row 2) ===')
for (let i = 0; i < dateCols.length; i++) {
  const addr = `${dateCols[i]}2`
  const c = sheet[addr]
  console.log(`  ${addr} (${dateNames[i]}): v=${JSON.stringify(c?.v)} | w="${c?.w}" | t="${c?.t}" | z="${c?.z}"`)
}

console.log('\n=== raw:false (current) — dates as formatted strings ===')
const r1 = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: '' })
for (const name of dateNames) {
  const v = r1[0]?.[name]
  console.log(`  ${name}: ${JSON.stringify(v)} type=${typeof v}`)
}
console.log(`  phone: ${JSON.stringify(r1[0]?.phone)} type=${typeof r1[0]?.phone}`)

console.log('\n=== raw:true WITHOUT cellDates ===')
const r2 = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true, defval: '' })
for (const name of dateNames) {
  const v = r2[0]?.[name]
  console.log(`  ${name}: ${JSON.stringify(v)} type=${typeof v}`)
}
console.log(`  phone: ${JSON.stringify(r2[0]?.phone)} type=${typeof r2[0]?.phone}`)

console.log('\n=== raw:true + cellDates:true ===')
const wb2 = XLSX.read(buffer, { type: 'buffer', cellDates: true })
const sheet2 = wb2.Sheets[wb2.SheetNames[0]]
const r3 = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet2, { raw: true, defval: '' })
for (const name of dateNames) {
  const v = r3[0]?.[name]
  const isDate = v instanceof Date
  console.log(`  ${name}: ${isDate ? `Date(${(v as Date).toISOString()})` : JSON.stringify(v)} type=${isDate ? 'Date' : typeof v}`)
}
console.log(`  phone: ${JSON.stringify(r3[0]?.phone)} type=${typeof r3[0]?.phone}`)

console.log('\n=== Check if dates are stored as Excel serial number or text in source ===')
console.log('  AD2 cell.t (n = number/serial, s = string, d = date):', sheet['AD2']?.t)
console.log('  AD2 cell.z (format code):', sheet['AD2']?.z)
