/**
 * Phase 8H-1 DEBUG — Full pipeline trace untuk Dedhy + Djono.
 *
 * Reproduces production behavior dengan logging di tiap tahap:
 *   A. extractTokensV3 — show all tokens
 *   B. buildCandidateTuples — show all generated tuples
 *   C. RPC parse_address_v3_lookup per tuple — show row/error
 *   D. parseAddress full — show final result
 *
 * Run: npx tsx scripts/debug-parser-v3.ts
 */
import { extractTokensV3, buildCandidateTuples, parseAddress } from '../src/lib/converter/address-parser'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const cases = [
  {
    name: 'Dedhy',
    address: 'Perumahan Discovery Alton Blok DN/D-16, Bintaro Jaya.  Kel. Parigi Kec. Pondok Aren.  Tangerang Selatan',
  },
  {
    name: 'Djono',
    address: 'Desa Belotan RT 45 RW 16 Kec.Bendo Magetan Jawa Timur',
  },
]

// Debug script — typed loose with `any` karena supabase-js typed RPC butuh
// Database schema generic yang ga di-setup di project ini. rpc('parse_address_v3_lookup')
// otherwise infer args type = undefined.
async function runWithClient(label: string, sb: any) {
  console.log(`\n############### CLIENT: ${label} ###############`)
  for (const tc of cases) {
    console.log(`\n========== TC ${tc.name} ==========`)
    console.log(`Input: ${JSON.stringify(tc.address)}`)
    console.log(`Length: ${tc.address.length}, char codes around "Kec.": ${[...tc.address].slice(tc.address.indexOf('Kec.'), tc.address.indexOf('Kec.') + 8).map(c => c.charCodeAt(0)).join(',')}`)

    // STEP A: extract tokens
    console.log(`\n--- STEP A: extractTokensV3 ---`)
    const tokens = extractTokensV3(tc.address)
    console.log(`  subdistrict: ${JSON.stringify(tokens.subdistrict)}`)
    console.log(`  city:        ${JSON.stringify(tokens.city)}`)
    console.log(`  province:    ${JSON.stringify(tokens.province)}`)
    console.log(`  village:     ${JSON.stringify(tokens.village)}`)
    console.log(`  last_segment:${JSON.stringify(tokens.last_segment)}`)

    // STEP B: build tuples
    console.log(`\n--- STEP B: buildCandidateTuples ---`)
    const tuples = buildCandidateTuples(tokens)
    console.log(`  total: ${tuples.length}`)
    for (const t of tuples) {
      console.log(`    {prov=${JSON.stringify(t.province)}, city=${JSON.stringify(t.city)}, sub=${JSON.stringify(t.subdistrict)}, priority=${t.priority}}`)
    }

    // STEP C: RPC call per tuple
    console.log(`\n--- STEP C: RPC calls ---`)
    for (const t of tuples.slice(0, 10)) {
      const { data, error } = await sb.rpc('parse_address_v3_lookup', {
        p_province: t.province,
        p_city: t.city,
        p_subdistrict: t.subdistrict,
      })
      if (error) {
        console.log(`  ❌ RPC(${t.province}, ${t.city}, ${t.subdistrict}) → ERROR: ${error.message} | code=${error.code}`)
      } else {
        console.log(`  ${data && data.length > 0 ? '✓' : '·'} RPC(${t.province}, ${t.city}, ${t.subdistrict}) → ${data?.length ?? 0} rows`)
        if (data && data.length > 0) {
          for (const r of data) {
            console.log(`      => ${JSON.stringify(r)}`)
          }
        }
      }
    }

    // STEP D: full parseAddress
    console.log(`\n--- STEP D: parseAddress full ---`)
    const result = await parseAddress(
      { address: tc.address, province: null, city: null, subdistrict: null, zip: null },
      sb as never,
    )
    console.log(`  ${JSON.stringify(result, null, 2)}`)
  }
}

async function main() {
  console.log(`URL: ${url}`)
  console.log(`Service key set: ${serviceKey ? 'yes' : 'no'}`)
  console.log(`Anon key set: ${anonKey ? 'yes' : 'no'}`)

  // First: service role (same as verify-8h.ts which passes)
  const sbService = createClient(url, serviceKey)
  await runWithClient('SERVICE_ROLE', sbService)

  // Second: anon key (no auth, mimic unauthenticated browser call)
  if (anonKey) {
    const sbAnon = createClient(url, anonKey)
    await runWithClient('ANON', sbAnon)
  }

  // Third: AUTHENTICATED — login sebagai owner, mimic real production browser context
  if (anonKey) {
    const sbAuth = createClient(url, anonKey)
    const { error: authErr } = await sbAuth.auth.signInWithPassword({
      email: 'owner@grandbook.com',
      password: 'GrandBook2026!',
    })
    if (authErr) {
      console.log(`\n############### AUTHENTICATED LOGIN FAILED: ${authErr.message} ###############`)
    } else {
      await runWithClient('AUTHENTICATED (owner@grandbook.com)', sbAuth)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
