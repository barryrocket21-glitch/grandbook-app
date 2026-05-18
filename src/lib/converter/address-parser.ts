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
 * Phase 8G — List nama provinsi Indonesia (38 provinsi + alias umum).
 * Dipakai sebagai high-confidence anchor di address parser V2 — last segment
 * setelah comma yang match list ini = strong province signal.
 */
const PROVINCE_NAMES: string[] = [
  // 38 provinsi resmi (lowercase untuk match insensitive)
  'aceh', 'sumatera utara', 'sumatera barat', 'riau', 'kepulauan riau', 'jambi',
  'sumatera selatan', 'bangka belitung', 'kepulauan bangka belitung', 'bengkulu', 'lampung',
  'dki jakarta', 'banten', 'jawa barat', 'jawa tengah', 'di yogyakarta', 'yogyakarta', 'jawa timur',
  'bali', 'nusa tenggara barat', 'ntb', 'nusa tenggara timur', 'ntt',
  'kalimantan barat', 'kalimantan tengah', 'kalimantan selatan', 'kalimantan timur', 'kalimantan utara',
  'sulawesi utara', 'gorontalo', 'sulawesi tengah', 'sulawesi barat', 'sulawesi selatan', 'sulawesi tenggara',
  'maluku', 'maluku utara',
  'papua', 'papua barat', 'papua tengah', 'papua pegunungan', 'papua selatan', 'papua barat daya',
]

/**
 * Phase 8G — Pattern-extracted tokens dari raw address.
 * Marker-based extraction (Kec./Kab./Kota/Kel./Desa) lebih reliable dari
 * keyword-frequency-based untuk address Indonesia yang well-structured.
 */
export interface ExtractedTokens {
  subdistrict_candidates: string[]   // After "Kec." / "Kecamatan"
  city_candidates: string[]          // After "Kab." / "Kabupaten" / "Kota"
  province_candidates: string[]      // Last segment match PROVINCE_NAMES
  village_candidates: string[]       // After "Kel." / "Desa"
  generic_candidates: string[]       // Fallback: extractKeywords (legacy V1)
}

/**
 * Pattern-aware tokenizer. Marker eksplisit di alamat Indonesia (Kec., Kab.,
 * Kota, Kel., Desa) lebih trustworthy dari word-frequency match.
 */
export function extractTokensWithPatterns(rawAddress: string): ExtractedTokens {
  const out: ExtractedTokens = {
    subdistrict_candidates: [],
    city_candidates: [],
    province_candidates: [],
    village_candidates: [],
    generic_candidates: extractKeywords(rawAddress),
  }

  // "Kec. Petarukan" or "Kecamatan Petarukan" — capture word(s) sampai koma/end
  for (const m of rawAddress.matchAll(/\bKec(?:amatan)?\.?\s+([A-Za-z][\w\s]{1,40}?)(?=[,;\n]|$)/gi)) {
    out.subdistrict_candidates.push(m[1].trim())
  }

  // "Kab. Pemalang" / "Kabupaten Sumba Timur" / "Kota Tangerang"
  for (const m of rawAddress.matchAll(/\b(Kab(?:upaten)?|Kota)\.?\s+([A-Za-z][\w\s]{1,40}?)(?=[,;\n]|$)/gi)) {
    out.city_candidates.push(m[2].trim())
  }

  // "Kel. Parigi" / "Desa Belotan" / "Kelurahan Sudimara"
  for (const m of rawAddress.matchAll(/\b(Kel(?:urahan)?|Desa)\.?\s+([A-Za-z][\w\s]{1,40}?)(?=[,;\n]|$)/gi)) {
    out.village_candidates.push(m[2].trim())
  }

  // Province — last comma-separated segment yang match PROVINCE_NAMES
  const segments = rawAddress.split(',').map(s => s.trim()).filter(Boolean)
  for (let i = segments.length - 1; i >= Math.max(0, segments.length - 3); i--) {
    const segLower = segments[i].toLowerCase()
    if (PROVINCE_NAMES.includes(segLower)) {
      out.province_candidates.push(segments[i])
      break
    }
  }

  return out
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
 * Phase 8G — Pattern-aware parser. Priority:
 *   1. Trust structured fields (province + city + subdistrict ada) → high confidence
 *   2. Marker extraction (Kec./Kab./Kota/Kel.) → query subdistrict candidates,
 *      filter dengan context city/province → strong winner = high confidence
 *   3. Fallback ke generic V1 (extractKeywords + group by topScore)
 *
 * Address Indonesia well-structured (eg "Kec. Petarukan, Kab. Pemalang, Jawa Tengah")
 * harusnya HIT step 2 dan return high confidence. Phase 8F naive parser
 * gagal di kasus ini karena keyword "Petarukan", "Pemalang", "Jawa", "Tengah",
 * etc. semua hit multiple wilayah berbeda → false ambiguous detection.
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

  if (!detailRaw) {
    return {
      success: false,
      reason: 'empty_input',
      candidates: [],
      extracted_keywords: [],
    }
  }

  // STEP 2: Pattern-aware extraction
  const tokens = extractTokensWithPatterns(detailRaw)

  if (tokens.subdistrict_candidates.length > 0) {
    for (const subdist of tokens.subdistrict_candidates) {
      const { data, error } = await supabase.rpc('search_wilayah_fuzzy', {
        p_query: subdist,
        p_limit: 30,
      })
      if (error || !data) continue
      const cands = data as WilayahCandidate[]

      // Filter only exact subdistrict match (score 100)
      let filtered = cands.filter(c => c.match_score === 100)
      if (filtered.length === 0) continue

      // Narrow by city context kalau ada
      if (tokens.city_candidates.length > 0) {
        const cityLower = tokens.city_candidates[0].toLowerCase()
        const byCity = filtered.filter(c => c.city.toLowerCase().includes(cityLower))
        if (byCity.length > 0) filtered = byCity
      }

      // Narrow by province context kalau ada
      if (tokens.province_candidates.length > 0) {
        const provLower = tokens.province_candidates[0].toLowerCase()
        const byProv = filtered.filter(c =>
          c.province.toLowerCase().includes(provLower)
          || provLower.includes(c.province.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim())
        )
        if (byProv.length > 0) filtered = byProv
      }

      if (filtered.length >= 1) {
        // Strong pattern winner. Confidence high kalau province+city ke-narrow,
        // medium kalau cuma subdistrict exact tanpa context narrowing.
        const conf: ParsedAddress['confidence'] =
          (tokens.province_candidates.length > 0 || tokens.city_candidates.length > 0)
            ? 'high'
            : 'medium'
        return {
          success: true,
          province: filtered[0].province,
          city: filtered[0].city,
          subdistrict: filtered[0].subdistrict,
          village: tokens.village_candidates[0] || filtered[0].village || null,
          zip: filtered[0].zip || (raw.zip || '').trim(),
          address_detail: detailRaw,
          confidence: conf,
        }
      }
    }
  }

  // STEP 3: Fallback ke V1 generic keyword search
  return parseAddressLegacyV1(raw, supabase, detailRaw)
}

/**
 * Phase 8F legacy generic parser (preserved sebagai fallback).
 * Pakai keyword-frequency grouping; cocok kalau address tidak punya marker eksplisit.
 */
async function parseAddressLegacyV1(
  raw: ParseInput,
  supabase: SupabaseClient,
  detailRaw: string,
): Promise<ParseResult> {
  // Phase 8G: STEP 1 (trust struktural) + STEP 2 (empty check) handled di caller
  // parseAddress V2. Legacy mulai dari extractKeywords.
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
