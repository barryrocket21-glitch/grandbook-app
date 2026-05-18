// =============================================================
// Phase 8G — Seed master_wilayah_spx dari template SPX V2
// =============================================================
// Usage: node scripts/seed-master-wilayah-spx.mjs <path-to-xlsx>
//
// Default path: ~/Downloads/mass_order_creation_template_id_V2*.xlsx
// (pakai versi terbaru kalau ada multiple).
//
// Membaca sheet `List Provinsi-Kota-Kecamatan` (7094 row), group postcode
// per (state, city, district), bulk upsert ke master_wilayah_spx (chunked 500).
// =============================================================
import * as XLSX from 'xlsx'
import * as dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

dotenv.config({ path: '.env.local' })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const xlsxPath = process.argv[2] || findLatestTemplate()
if (!xlsxPath || !fs.existsSync(xlsxPath)) {
  console.error('XLSX not found:', xlsxPath)
  process.exit(1)
}
console.log('Reading', xlsxPath)

const wb = XLSX.readFile(xlsxPath)
const sheet = wb.Sheets['List Provinsi-Kota-Kecamatan']
if (!sheet) {
  console.error('Sheet "List Provinsi-Kota-Kecamatan" not found')
  process.exit(1)
}

const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
const dataRows = rows.slice(2) // skip 2 header rows

const records = []
for (const row of dataRows) {
  const [state, city, district, ...postcodes] = row
  if (!state || !city || !district) continue
  const pc = postcodes
    .filter(p => p !== '' && p != null)
    .map(p => String(p).trim())
    .filter(p => p.length > 0)
  records.push({
    state: String(state).trim(),
    city: String(city).trim(),
    district: String(district).trim(),
    postal_codes: [...new Set(pc)],
  })
}

console.log('Records to upsert:', records.length)

async function callRest(body) {
  const r = await fetch(url + '/rest/v1/master_wilayah_spx?on_conflict=state,city,district', {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
  })
  return { status: r.status, text: await r.text() }
}

const CHUNK = 500
for (let i = 0; i < records.length; i += CHUNK) {
  const chunk = records.slice(i, i + CHUNK)
  const { status, text } = await callRest(chunk)
  console.log(`Batch ${i / CHUNK + 1}/${Math.ceil(records.length / CHUNK)}: status=${status}`)
  if (status >= 400) {
    console.error('ERROR:', text.slice(0, 300))
    process.exit(1)
  }
}
console.log('Done.')

function findLatestTemplate() {
  const dir = `${process.env.HOME}/Downloads`
  const files = fs.readdirSync(dir)
    .filter(f => /^mass_order_creation_template_id_V2.*\.xlsx$/.test(f))
    .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return files[0] ? path.join(dir, files[0].f) : null
}
