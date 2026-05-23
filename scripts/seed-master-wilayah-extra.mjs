// =============================================================
// Phase 8K-Geo — seed Mengantar + Komship gap rows into master_wilayah_spx
// =============================================================
// SPX's official template ships ~7,092 kecamatan. Two aggregators ship
// supplementary lists that include kecamatan SPX is missing (e.g. Teluk
// Pandan / Pesawaran — a 2021 pemekaran SPX hasn't synced yet).
//
// Strategy: for every (province_norm, city_norm, district_norm) tuple in
// the aggregator JSON that doesn't already exist in master_wilayah_spx,
// insert it with source = 'MENGANTAR' | 'KOMSHIP'. Existing SPX rows are
// untouched.
//
// Usage:
//   npm run seed:wilayah-extra
// (requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
// =============================================================
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const SOURCES = [
  { source: 'MENGANTAR', path: resolve(__dirname, 'data', 'mengantar-geo.json') },
  { source: 'KOMSHIP', path: resolve(__dirname, 'data', 'komship-geo.json') },
]

/** Match parse_address_v3_lookup runtime normalization. The DB has
 * generated *_normalized columns but they normalize differently than the
 * runtime lookup (district keeps parens stored, runtime strips them); use
 * the runtime form everywhere here so dedup matches what the parser sees. */
const normProvince = (s) =>
  (s ?? '').replace(/\s*\([^)]*\)\s*/g, '').toLowerCase().trim()
const normCity = (s) =>
  (s ?? '').replace(/^(kab\.|kota|kabupaten)\s+/i, '').toLowerCase().trim()
const normDistrict = (s) =>
  (s ?? '').replace(/\s*\([^)]*\)\s*/g, '').toLowerCase().trim()

const tupleKey = (state, city, district) =>
  `${normProvince(state)}|${normCity(city)}|${normDistrict(district)}`

async function loadExistingKeys() {
  const keys = new Set()
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('master_wilayah_spx')
      .select('state, city, district')
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) keys.add(tupleKey(r.state, r.city, r.district))
    if (data.length < PAGE) break
    from += PAGE
  }
  return keys
}

function readSource({ source, path }) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const rows = []
  for (const [ci, district, postcode] of data.districts) {
    const [pi, city] = data.cities[ci]
    const state = data.provinces[pi]
    rows.push({ source, state, city, district, postcode })
  }
  return rows
}

async function main() {
  console.log('Loading existing SPX wilayah tuples...')
  const existing = await loadExistingKeys()
  console.log(`  → ${existing.size} existing rows in master_wilayah_spx`)

  const insertRows = []
  const seen = new Set([...existing])
  for (const src of SOURCES) {
    const rows = readSource(src)
    console.log(`\n[${src.source}] ${rows.length} rows in source file`)
    let added = 0
    for (const r of rows) {
      const key = tupleKey(r.state, r.city, r.district)
      if (seen.has(key)) continue
      seen.add(key)
      insertRows.push({
        state: r.state.toUpperCase(),
        city: r.city.toUpperCase(),
        district: r.district.toUpperCase(),
        postal_codes: r.postcode ? [String(r.postcode)] : [],
        is_serviceable: true,
        source: src.source,
      })
      added += 1
    }
    console.log(`  → ${added} rows to insert (gap-filling)`)
  }

  if (insertRows.length === 0) {
    console.log('\nNothing to insert. Master is already up to date.')
    return
  }

  console.log(`\nInserting ${insertRows.length} rows (batches of 500)...`)
  for (let i = 0; i < insertRows.length; i += 500) {
    const batch = insertRows.slice(i, i + 500)
    const { error, count } = await supabase
      .from('master_wilayah_spx')
      .upsert(batch, {
        onConflict: 'state,city,district',
        ignoreDuplicates: true,
        count: 'exact',
      })
    if (error) {
      console.error(`  ✗ Batch [${i}..${i + batch.length}] error: ${error.message}`)
      process.exit(1)
    }
    console.log(`  ✓ Batch [${i}..${i + batch.length}] — ${count ?? batch.length} inserted`)
  }

  const after = await loadExistingKeys()
  console.log(`\nDone. master_wilayah_spx: ${existing.size} → ${after.size} (+${after.size - existing.size}).`)
}

main().catch((err) => {
  console.error('\n✗ Fatal:', err.message ?? err)
  process.exit(1)
})
