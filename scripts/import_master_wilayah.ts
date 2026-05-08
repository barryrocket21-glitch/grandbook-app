#!/usr/bin/env tsx
/**
 * Import master wilayah (~82547 rows) dari Daftar_Kodepos.xlsx ke
 * Supabase table master_wilayah.
 *
 * Setup:
 *   1. Place file di scripts/data/Daftar_Kodepos.xlsx
 *   2. Pastikan .env.local punya NEXT_PUBLIC_SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY
 *   3. Run: npm run import:wilayah
 *
 * Idempotent: row yang sudah ada (UNIQUE province+city+subdistrict+village+zip)
 * akan di-skip otomatis lewat ON CONFLICT.
 */
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') })

const FILE_PATH = resolve(process.cwd(), 'scripts/data/Daftar_Kodepos.xlsx')
const BATCH_SIZE = 1000
const PROGRESS_EVERY = 5000

function normalize(s: string): string {
  return (s ?? '')
    .toString()
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')        // hapus konten dalam kurung "(NTB)"
    .replace(/[^a-z0-9 ]/g, ' ')       // hapus tanda baca
    .replace(/\bprovinsi\b/g, ' ')     // hapus kata "provinsi" kalau ada
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim()
}

async function main() {
  // Check file exists
  if (!existsSync(FILE_PATH)) {
    console.error('\n❌ File scripts/data/Daftar_Kodepos.xlsx tidak ditemukan.\n')
    console.error('Cara fix:')
    console.error('  1. Download / siapkan file Daftar_Kodepos.xlsx')
    console.error('  2. Copy ke: scripts/data/Daftar_Kodepos.xlsx')
    console.error('  3. Run ulang: npm run import:wilayah\n')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY missing di .env.local')
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`📂 Reading ${FILE_PATH}...`)
  const wb = XLSX.read(readFileSync(FILE_PATH), { type: 'buffer', raw: false })
  const ws = wb.Sheets[wb.SheetNames[0]]

  // File Daftar_Kodepos.xlsx structure:
  //   Row 1: title/disclaimer
  //   Row 2: empty
  //   Row 3: header (PROVINSI, KOTA/KABUPATEN, KECAMATAN, KELURAHAN, KODE POS)
  //   Row 4..end: data
  const allRows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: false })
  const dataRows = allRows.slice(3) // skip 3 header rows

  console.log(`📊 ${dataRows.length} candidate rows in file`)

  let parsed = 0
  let skipped = 0
  let inserted = 0
  let conflicts = 0
  let errors = 0
  let batch: any[] = []

  const flush = async () => {
    if (batch.length === 0) return
    const { error, count } = await supabase
      .from('master_wilayah')
      .upsert(batch, { onConflict: 'province,city,subdistrict,village,zip', ignoreDuplicates: true, count: 'exact' })
    if (error) {
      console.error(`❌ Batch error (${batch.length} rows):`, error.message)
      errors += batch.length
    } else {
      // count is rows ACTUALLY inserted (excluding conflicts since ignoreDuplicates: true)
      const newCount = count ?? 0
      inserted += newCount
      conflicts += batch.length - newCount
    }
    batch = []
  }

  for (const row of dataRows) {
    const province = String(row[0] ?? '').trim()
    const city = String(row[1] ?? '').trim()
    const subdistrict = String(row[2] ?? '').trim()
    const village = String(row[3] ?? '').trim()
    const zipRaw = row[4]
    const zip = zipRaw === null || zipRaw === undefined ? '' : String(zipRaw).trim()

    if (!province || !city || !subdistrict || !village || !zip) {
      skipped++
      continue
    }

    parsed++
    batch.push({
      province, city, subdistrict, village, zip,
      province_normalized: normalize(province),
      city_normalized: normalize(city),
      subdistrict_normalized: normalize(subdistrict),
      village_normalized: normalize(village),
    })

    if (batch.length >= BATCH_SIZE) await flush()
    if (parsed % PROGRESS_EVERY === 0) {
      console.log(`  ... ${parsed} parsed, ${inserted} inserted, ${conflicts} skipped (existing), ${errors} errors`)
    }
  }
  await flush()

  console.log('')
  console.log('✅ Import selesai')
  console.log(`   Parsed:     ${parsed}`)
  console.log(`   Inserted:   ${inserted}`)
  console.log(`   Conflicts:  ${conflicts} (already exist)`)
  console.log(`   Skipped:    ${skipped} (incomplete row)`)
  console.log(`   Errors:     ${errors}`)

  // Verify count
  const { count: totalInDb } = await supabase
    .from('master_wilayah')
    .select('*', { count: 'exact', head: true })
  console.log(`   Total in master_wilayah: ${totalInDb}`)
}

main().catch(err => {
  console.error('❌ Fatal:', err)
  process.exit(1)
})
