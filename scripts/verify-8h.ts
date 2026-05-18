/**
 * Phase 8H-1 smoke verification — Parser V3 runtime test.
 *
 * Verifies:
 *   1. extractTokensV3 — pattern extraction untuk 2 edge case test_1.xlsx
 *   2. buildCandidateTuples — generate interpretations correct
 *   3. parseAddress end-to-end — V3 path returns high confidence
 *
 * Run: npx tsx scripts/verify-8h.ts
 */
import { parseAddress, extractTokensV3, buildCandidateTuples } from '../src/lib/converter/address-parser'
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

const realCases = [
  {
    name: 'TC1 Dedhy (Bug A: city as last segment, no province in text)',
    address: 'Perumahan Discovery Alton Blok DN/D-16, Bintaro Jaya.  Kel. Parigi Kec. Pondok Aren.  Tangerang Selatan',
    expectProvince: 'BANTEN',
    expectCity: 'KOTA TANGERANG SELATAN',
    expectSubdistrict: 'PONDOK AREN',
    expectZipNonEmpty: true,
    expectConfidence: 'high' as const,
  },
  {
    name: 'TC2 Djono (Bug B: Kec.X no whitespace + Bug C: city tanpa prefix)',
    address: 'Desa Belotan RT 45 RW 16 Kec.Bendo Magetan Jawa Timur',
    expectProvince: 'JAWA TIMUR',
    expectCity: 'KAB. MAGETAN',
    expectSubdistrict: 'BENDO',
    expectZipNonEmpty: true,
    expectConfidence: 'high' as const,
  },
]

async function main() {
  console.log('\n=== TEST 1: extractTokensV3 ===')

  // TC1 token extraction
  const t1 = extractTokensV3(realCases[0].address)
  check(
    'TC1 extractTokensV3 — subdistrict has "Pondok Aren"',
    t1.subdistrict.includes('Pondok Aren'),
    `subdistrict=${JSON.stringify(t1.subdistrict)}`,
  )
  check(
    'TC1 extractTokensV3 — last_segment = "Tangerang Selatan"',
    t1.last_segment === 'Tangerang Selatan',
    `last_segment=${JSON.stringify(t1.last_segment)}`,
  )
  check(
    'TC1 extractTokensV3 — no province detected (intentional, city in last segment)',
    t1.province.length === 0,
    `province=${JSON.stringify(t1.province)}`,
  )

  // TC2 token extraction
  const t2 = extractTokensV3(realCases[1].address)
  check(
    'TC2 extractTokensV3 — subdistrict has "Bendo" (relaxed regex)',
    t2.subdistrict.includes('Bendo'),
    `subdistrict=${JSON.stringify(t2.subdistrict)}`,
  )
  check(
    'TC2 extractTokensV3 — province = "jawa timur" (detected from text)',
    t2.province.some(p => p.toLowerCase() === 'jawa timur'),
    `province=${JSON.stringify(t2.province)}`,
  )
  check(
    'TC2 extractTokensV3 — city has "Magetan" (implicit from words after Kec.)',
    t2.city.includes('Magetan'),
    `city=${JSON.stringify(t2.city)}`,
  )

  console.log('\n=== TEST 2: buildCandidateTuples ===')

  const tuples1 = buildCandidateTuples(t1)
  const hasDedhyCorrect = tuples1.some(
    t => t.city === 'Tangerang Selatan' && t.subdistrict === 'Pondok Aren',
  )
  check(
    'TC1 buildCandidateTuples — has {city:Tangerang Selatan, sub:Pondok Aren}',
    hasDedhyCorrect,
    `tuples count=${tuples1.length}, first few=${JSON.stringify(tuples1.slice(0, 3))}`,
  )

  const tuples2 = buildCandidateTuples(t2)
  const hasDjonoCorrect = tuples2.some(
    t => t.province?.toLowerCase() === 'jawa timur'
      && t.city === 'Magetan'
      && t.subdistrict === 'Bendo',
  )
  check(
    'TC2 buildCandidateTuples — has {prov:Jawa Timur, city:Magetan, sub:Bendo} priority 100',
    hasDjonoCorrect,
    `tuples count=${tuples2.length}, first few=${JSON.stringify(tuples2.slice(0, 3))}`,
  )

  console.log('\n=== TEST 3: parseAddress end-to-end (V3 path) ===')

  for (const tc of realCases) {
    const r = await parseAddress(
      { address: tc.address, province: null, city: null, subdistrict: null, zip: null },
      sb as never,
    )
    if (!r.success) {
      check(`${tc.name} → success`, false, `reason=${r.reason}`)
      continue
    }
    const provOk = r.province.toUpperCase() === tc.expectProvince
    const cityOk = r.city.toUpperCase() === tc.expectCity
    const subOk = r.subdistrict.toUpperCase() === tc.expectSubdistrict
    const zipOk = tc.expectZipNonEmpty ? r.zip.trim().length > 0 : true
    const confOk = r.confidence === tc.expectConfidence
    check(
      `${tc.name} → V3 resolved correct`,
      provOk && cityOk && subOk && zipOk && confOk,
      `province="${r.province}" city="${r.city}" subdistrict="${r.subdistrict}" zip="${r.zip}" conf=${r.confidence}`,
    )
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`PASS: ${pass}, FAIL: ${fail}`)
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
