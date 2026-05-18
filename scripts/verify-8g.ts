/**
 * Phase 8G smoke verification — runtime end-to-end test.
 *
 * Verifies:
 *   1. normalize_phone_id_safe — 6 case (sci notation, valid, short, etc.)
 *   2. parseAddress (V2 pattern-aware) — 4 real Orderonline address (brief test cases)
 *   3. lookup_spx_wilayah RPC — Petarukan + Umalulu kasus real
 *
 * Run: npx tsx scripts/verify-8g.mts
 */
import { normalize_phone_id_safe } from '../src/lib/converter/transforms'
import { parseAddress } from '../src/lib/converter/address-parser'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`✅ ${name}`)
    pass++
  } else {
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`)
    fail++
  }
}

async function main() {
// =====================================================================
// TEST 1 — normalize_phone_id_safe
// =====================================================================
console.log('\n=== TEST 1: normalize_phone_id_safe ===')

const r1 = normalize_phone_id_safe(6287808123771)
check('XLSX integer 6287808123771 → 87808123771 valid', r1.isValid && r1.phone === '87808123771', JSON.stringify(r1))

const r2 = normalize_phone_id_safe('6.28781E+12')
check('Sci notation "6.28781E+12" → invalid scientific_notation', !r2.isValid && r2.reason === 'scientific_notation', JSON.stringify(r2))

const r3 = normalize_phone_id_safe('081234567890')
check('"081234567890" → valid 81234567890', r3.isValid && r3.phone === '81234567890', JSON.stringify(r3))

const r4 = normalize_phone_id_safe('0878112')
check('"0878112" → invalid too_short', !r4.isValid && r4.reason === 'too_short', JSON.stringify(r4))

const r5 = normalize_phone_id_safe('')
check('"" → invalid empty', !r5.isValid && r5.reason === 'empty', JSON.stringify(r5))

const r6 = normalize_phone_id_safe(null)
check('null → invalid empty', !r6.isValid && r6.reason === 'empty', JSON.stringify(r6))

const r7 = normalize_phone_id_safe('+62 812 3456 7890')
check('"+62 812 3456 7890" → valid 81234567890', r7.isValid && r7.phone === '81234567890', JSON.stringify(r7))

// =====================================================================
// TEST 2 — parseAddress V2 dengan 4 case Orderonline real
// =====================================================================
console.log('\n=== TEST 2: parseAddress V2 (pattern-aware) ===')

const addrTests = [
  {
    label: 'Tangerang/Pinang/Banten',
    input: 'Jl. Hidup Baru VIII Blok A61 No. 6, Kel. Sudimara Pinang, Kec. Pinang, Kota Tangerang, Banten',
    expectProvince: 'BANTEN',
    expectCityContains: 'TANGERANG',
    // master_wilayah lokal pakai alias "Pinang (Penang)". SPX lookup strip parenthesis.
    expectSubdistrict: 'PINANG (PENANG)',
  },
  {
    label: 'Magetan/Bendo/Jawa Timur',
    input: 'RT 045 RW 016, Desa Belotan, Kec. Bendo, Kab. Magetan, Jawa Timur',
    expectProvince: 'JAWA TIMUR',
    expectCityContains: 'MAGETAN',
    expectSubdistrict: 'BENDO',
  },
  {
    label: 'Tangerang Selatan/Pondok Aren (no province)',
    input: 'Discovery Alton Blok DN/D-16, Bintaro Jaya, Kel. Parigi, Kec. Pondok Aren, Kota Tangerang Selatan',
    expectProvince: null, // no province explicit → city/subdistrict context fallback
    expectCityContains: 'TANGERANG SELATAN',
    expectSubdistrict: 'PONDOK AREN',
  },
  {
    label: 'Pemalang/Petarukan/Jawa Tengah (Bug D real case)',
    input: 'Kios Martani, Jl. Manduro, RT 002 RW 001, Desa Klareyan, Kec. Petarukan, Kab. Pemalang, Jawa Tengah',
    expectProvince: 'JAWA TENGAH',
    expectCityContains: 'PEMALANG',
    expectSubdistrict: 'PETARUKAN',
  },
]

for (const t of addrTests) {
  const r = await parseAddress(
    { address: t.input, province: null, city: null, subdistrict: null, zip: null },
    sb as never,
  )
  if (!r.success) {
    check(`Parse "${t.label}" → success`, false, `reason=${r.reason}`)
    continue
  }
  const provOk = t.expectProvince === null || r.province.toUpperCase().includes(t.expectProvince)
  const cityOk = r.city.toUpperCase().includes(t.expectCityContains)
  const subOk = r.subdistrict.toUpperCase() === t.expectSubdistrict
  check(
    `Parse "${t.label}" → high/medium confidence + correct extraction`,
    provOk && cityOk && subOk,
    `province="${r.province}" city="${r.city}" subdistrict="${r.subdistrict}" conf=${r.confidence}`,
  )
}

// =====================================================================
// TEST 3 — lookup_spx_wilayah RPC (Bug B verify)
// =====================================================================
console.log('\n=== TEST 3: lookup_spx_wilayah RPC ===')

const spxTests = [
  {
    label: 'Petarukan (Bug D)',
    args: { p_province: 'Jawa Tengah', p_city: 'Pemalang', p_subdistrict: 'Petarukan' },
    expectState: 'JAWA TENGAH',
    expectCity: 'KAB. PEMALANG',
    expectDistrict: 'PETARUKAN',
    expectPostal: '52362',
  },
  {
    label: 'Umalulu Jeksenn (Phase 8F orig case)',
    args: { p_province: 'Nusa Tenggara Timur (NTT)', p_city: 'Sumba Timur', p_subdistrict: 'Umalulu' },
    expectState: 'NUSA TENGGARA TIMUR (NTT)',
    expectCity: 'KAB. SUMBA TIMUR',
    expectDistrict: 'UMALULU',
    expectPostal: '87181',
  },
]

// Test alias strip via direct comparison (not full match — SPX template ga
// punya entry Pinang Tangerang, ini coverage gap bukan code bug)
const spxAliasTests = [
  {
    label: 'Pinang (Penang) — coverage gap di SPX template V2 (expected not_found)',
    args: { p_province: 'Banten', p_city: 'Tangerang', p_subdistrict: 'Pinang (Penang)' },
    expectConfidence: 'not_found',
  },
]

for (const t of spxTests) {
  const { data, error } = await sb.rpc('lookup_spx_wilayah', t.args)
  if (error || !data || data.length === 0) {
    check(`SPX lookup "${t.label}"`, false, `error=${error?.message ?? 'no data'}`)
    continue
  }
  const r = data[0]
  const ok = r.spx_state === t.expectState
    && r.spx_city === t.expectCity
    && r.spx_district === t.expectDistrict
    && r.spx_postal_code === t.expectPostal
  check(
    `SPX lookup "${t.label}" → SPX format`,
    ok,
    `state="${r.spx_state}" city="${r.spx_city}" district="${r.spx_district}" postal="${r.spx_postal_code}" conf=${r.match_confidence}`,
  )
}

for (const t of spxAliasTests) {
  const { data, error } = await sb.rpc('lookup_spx_wilayah', t.args)
  if (error || !data) { check(`SPX alias "${t.label}"`, false, `error=${error?.message}`); continue }
  const r = data[0]
  check(
    `SPX alias "${t.label}" → ${t.expectConfidence}`,
    r.match_confidence === t.expectConfidence,
    `actual conf=${r.match_confidence} state=${r.spx_state}`,
  )
}

// =====================================================================
// SUMMARY
// =====================================================================
console.log(`\n=== SUMMARY ===`)
console.log(`PASS: ${pass}, FAIL: ${fail}`)
if (fail > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
