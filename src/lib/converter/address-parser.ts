// =============================================================
// Phase 8F — Hybrid address parser
// =============================================================
// Strategy:
//   STEP 1: Trust structured fields (province + city + subdistrict ada
//           → short-circuit dengan confidence='high')
//   STEP 2: Extract keywords dari free-text address (skip noise words +
//           pure numbers + words <3 char)
//   STEP 3: Untuk tiap keyword, query RPC search_wilayah_fuzzy
//           → group candidates by (province, city, subdistrict)
//   STEP 4: Resolve winner berdasarkan top score + count.
//           Ambigu (2 group sama-sama kuat) → return failure
//           No match atau weak → return failure
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

export interface WilayahCandidate {
  id: number
  province: string
  city: string
  subdistrict: string
  village: string
  zip: string
  match_score: number
}

export interface ParsedAddress {
  success: true
  province: string
  city: string
  subdistrict: string
  village: string | null
  zip: string
  address_detail: string
  confidence: 'high' | 'medium' | 'low'
}

export interface ParseFailure {
  success: false
  reason: 'no_match' | 'ambiguous' | 'too_short' | 'empty_input'
  candidates: WilayahCandidate[]
  extracted_keywords: string[]
}

export type ParseResult = ParsedAddress | ParseFailure

export interface ParseInput {
  address: string
  province?: string | null
  city?: string | null
  subdistrict?: string | null
  zip?: string | null
}

/**
 * Noise words yang sering muncul di alamat tapi bukan nama wilayah.
 * Di-exclude dari keyword extraction.
 */
const NOISE_WORDS = new Set([
  'alamat', 'rt', 'rw', 'rt/rw', 'no', 'nomor', 'jl', 'jalan',
  'kel', 'desa', 'kel/desa', 'kelurahan', 'kec', 'kecamatan',
  'kab', 'kabupaten', 'kota', 'prov', 'provinsi', 'dusun', 'lingkungan',
  'gg', 'gang', 'blok', 'rumah', 'depan', 'dekat', 'samping', 'belakang',
  'sebelah', 'sebrang', 'jln', 'komplek', 'komp', 'perumahan', 'perum',
  'rumah', 'kantor', 'pasar', 'sekolah', 'mesjid', 'masjid', 'gereja',
  'puskesmas', 'rs', 'rumah sakit', 'depan', 'belakang', 'kel/des',
  'and', 'atau', 'or', 'the',
])

/**
 * Extract keyword candidates dari raw address text.
 * Output: lowercase words yang panjang >= 3 char, bukan noise, bukan murni angka.
 */
export function extractKeywords(rawAddress: string): string[] {
  return rawAddress
    .toLowerCase()
    .replace(/[,./\\\-():;]/g, ' ')
    .split(/\s+/)
    .filter(
      w =>
        w.length >= 3
        && !NOISE_WORDS.has(w)
        && !/^\d+$/.test(w),
    )
}

/**
 * Hybrid parser: trust structured fields kalau lengkap, fallback ke keyword
 * search di master_wilayah via RPC search_wilayah_fuzzy.
 */
export async function parseAddress(
  raw: ParseInput,
  supabase: SupabaseClient,
): Promise<ParseResult> {
  const detailRaw = (raw.address || '').trim()

  // STEP 1: trust structured fields kalau lengkap (province + city + subdistrict)
  const provStruct = raw.province?.trim() || ''
  const cityStruct = raw.city?.trim() || ''
  const subStruct  = raw.subdistrict?.trim() || ''

  if (provStruct && cityStruct && subStruct) {
    return {
      success: true,
      province: provStruct,
      city: cityStruct,
      subdistrict: subStruct,
      village: null,
      zip: (raw.zip || '').trim(),
      address_detail: detailRaw,
      confidence: 'high',
    }
  }

  // STEP 2: kalau detail kosong total → langsung gagal
  if (!detailRaw) {
    return {
      success: false,
      reason: 'empty_input',
      candidates: [],
      extracted_keywords: [],
    }
  }

  const keywords = extractKeywords(detailRaw)
  if (keywords.length === 0) {
    return {
      success: false,
      reason: 'too_short',
      candidates: [],
      extracted_keywords: [],
    }
  }

  // STEP 3: query RPC per keyword (top 5 candidates each)
  const allCandidates: WilayahCandidate[] = []
  for (const kw of keywords) {
    const { data, error } = await supabase.rpc('search_wilayah_fuzzy', {
      p_query: kw,
      p_limit: 5,
    })
    if (error || !data) continue
    for (const c of data as WilayahCandidate[]) {
      allCandidates.push(c)
    }
  }

  if (allCandidates.length === 0) {
    return {
      success: false,
      reason: 'no_match',
      candidates: [],
      extracted_keywords: keywords,
    }
  }

  // STEP 4: group by (province, city, subdistrict)
  const grouped = new Map<string, { count: number; topScore: number; sample: WilayahCandidate }>()
  for (const c of allCandidates) {
    const key = `${c.province}|${c.city}|${c.subdistrict}`
    const g = grouped.get(key)
    if (g) {
      g.count++
      if (c.match_score > g.topScore) {
        g.topScore = c.match_score
        g.sample = c
      }
    } else {
      grouped.set(key, { count: 1, topScore: c.match_score, sample: c })
    }
  }

  const groups = Array.from(grouped.values())
    .sort((a, b) => b.topScore - a.topScore || b.count - a.count)

  const winner = groups[0]
  const runnerUp = groups[1]

  // Ambigu kalau runner-up punya score >=90 dan selisih dengan winner <10
  const isAmbiguous =
    runnerUp
    && runnerUp.topScore >= 90
    && Math.abs(winner.topScore - runnerUp.topScore) < 10
    && winner.sample.subdistrict !== runnerUp.sample.subdistrict

  if (isAmbiguous) {
    return {
      success: false,
      reason: 'ambiguous',
      candidates: allCandidates.slice(0, 5),
      extracted_keywords: keywords,
    }
  }

  // Strong winner: score >=95 OR count >=2 dan clearly ahead
  const isStrong =
    winner.topScore >= 95
    || (winner.count >= 2 && (!runnerUp || winner.count > runnerUp.count))

  if (!isStrong) {
    return {
      success: false,
      reason: 'no_match',
      candidates: allCandidates.slice(0, 5),
      extracted_keywords: keywords,
    }
  }

  const confidence: ParsedAddress['confidence'] =
    winner.topScore >= 95 ? 'high'
    : winner.topScore >= 80 ? 'medium'
    : 'low'

  return {
    success: true,
    province: winner.sample.province,
    city: winner.sample.city,
    subdistrict: winner.sample.subdistrict,
    village: winner.sample.village || null,
    zip: winner.sample.zip || (raw.zip || '').trim(),
    address_detail: detailRaw,
    confidence,
  }
}
