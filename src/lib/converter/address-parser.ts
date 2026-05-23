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

// =============================================================
// Phase 8H — Parser V3 (lookup-driven, SPX-canonical)
// =============================================================
// V3 strategy: ekstrak kandidat tokens (subdistrict/city/province/village)
// dari raw address, generate semua interpretasi (tuples), validate via
// RPC parse_address_v3_lookup (4-tier match terhadap master_wilayah_spx).
// DB jadi source of truth — pattern extraction kasih "guess", lookup validate.
//
// Address bugs fixed dibanding V2:
//   Bug A: city as last segment, no province in text
//          "...Kec. Pondok Aren. Tangerang Selatan"
//          → last_segment="Tangerang Selatan" jadi city candidate
//   Bug B: marker tanpa whitespace setelah dot
//          "Kec.Bendo Magetan Jawa Timur"
//          → regex relax \s* (vs \s+ V2) capture "Bendo" setelah "Kec."
//   Bug C: city tanpa Kab./Kota prefix
//          "Kec.Bendo Magetan Jawa Timur"
//          → kalau province ke-detect + 2+ word setelah Kec., word ke-2 jadi
//          implicit city candidate
// =============================================================

interface ExtractedTokensV3 {
  subdistrict: string[]
  city: string[]
  province: string[]
  village: string[]
  last_segment: string | null
}

interface CandidateTuple {
  province: string | null
  city: string | null
  subdistrict: string
  priority: number
}

interface V3MatchRow {
  province: string
  city: string
  subdistrict: string
  zip: string
  match_score: number
  matched_via: string
}

const V3_MARKER_KEYWORDS = /\b(?:Kec|Kab|Kota|Kel|Desa|Kabupaten|Kecamatan|Kelurahan|Provinsi)\b/i
const V3_STOP_PATTERN = /[,;\n]|\b(?:Kec|Kab|Kota|Kel|Desa|Kabupaten|Kecamatan|Kelurahan|Provinsi)\b|\.\s+[A-Z]|\.\s*$/

function captureWordsAfterMarker(rawAddress: string, marker: RegExp): string[][] {
  const results: string[][] = []
  const re = new RegExp(marker.source, marker.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(rawAddress)) !== null) {
    const startAfter = m.index + m[0].length
    const remainder = rawAddress.substring(startAfter)
    const stopMatch = remainder.match(V3_STOP_PATTERN)
    const endIdx = stopMatch && stopMatch.index !== undefined ? stopMatch.index : remainder.length
    const text = remainder.substring(0, endIdx).trim()
    if (!text) continue
    const words = text.split(/\s+/).filter(w => /^[A-Za-z][\w()]*$/.test(w))
    if (words.length > 0) results.push(words)
  }
  return results
}

export function extractTokensV3(rawAddress: string): ExtractedTokensV3 {
  const out: ExtractedTokensV3 = {
    subdistrict: [],
    city: [],
    province: [],
    village: [],
    last_segment: null,
  }

  // Province detection — whole-word match against PROVINCE_NAMES anywhere in text
  const lower = rawAddress.toLowerCase()
  for (const prov of PROVINCE_NAMES) {
    const escaped = prov.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
      out.province.push(prov)
    }
  }
  out.province = Array.from(new Set(out.province))
  const provinceDetected = out.province.length > 0

  // Subdistrict — relax to \s* (Bug B: "Kec.Bendo")
  for (const words of captureWordsAfterMarker(rawAddress, /\bKec(?:amatan)?\.?\s*/gi)) {
    out.subdistrict.push(words[0])
    if (words.length >= 2) out.subdistrict.push(words.slice(0, 2).join(' '))
    // Bug C: kalau province detected + 2+ word, word ke-2 might be implicit city
    if (provinceDetected && words.length >= 2) {
      out.city.push(words[1])
      if (words.length >= 3) out.city.push(words.slice(1, 3).join(' '))
    }
  }

  // City (Kab./Kota/Kabupaten)
  for (const words of captureWordsAfterMarker(rawAddress, /\b(?:Kab(?:upaten)?|Kota)\.?\s*/gi)) {
    out.city.push(words[0])
    if (words.length >= 2) out.city.push(words.slice(0, 2).join(' '))
    if (words.length >= 3) out.city.push(words.slice(0, 3).join(' '))
  }

  // Village (Kel./Desa/Kelurahan)
  for (const words of captureWordsAfterMarker(rawAddress, /\b(?:Kel(?:urahan)?|Desa)\.?\s*/gi)) {
    out.village.push(words[0])
    if (words.length >= 2) out.village.push(words.slice(0, 2).join(' '))
  }

  // Last segment without marker — Bug A: city as last segment
  const protectedAddr = rawAddress.replace(
    /\b(Kec|Kab|Kota|Kel|Desa|Kabupaten|Kecamatan|Kelurahan|Provinsi)\./gi,
    '$1__DOT__',
  )
  const segments = protectedAddr
    .split(/[,;.]+/)
    .map(s => s.replace(/__DOT__/g, '.').trim())
    .filter(Boolean)

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    if (V3_MARKER_KEYWORDS.test(seg)) continue
    if (/\b(RT|RW)\b/i.test(seg)) continue
    if (seg.length < 4 || /^\d/.test(seg)) continue
    if (out.province.some(p => seg.toLowerCase().includes(p))) continue
    out.last_segment = seg
    break
  }

  out.subdistrict = Array.from(new Set(out.subdistrict))
  out.city = Array.from(new Set(out.city))
  out.village = Array.from(new Set(out.village))

  return out
}

export function buildCandidateTuples(tokens: ExtractedTokensV3): CandidateTuple[] {
  const tuples: CandidateTuple[] = []
  const seen = new Set<string>()

  const add = (p: string | null, c: string | null, s: string) => {
    if (!s) return
    const key = `${p || ''}|${c || ''}|${s}`
    if (seen.has(key)) return
    seen.add(key)
    const priority = p && c ? 100 : p || c ? 95 : 70
    tuples.push({ province: p, city: c, subdistrict: s, priority })
  }

  const cityVariants = [...tokens.city, ...(tokens.last_segment ? [tokens.last_segment] : [])]
  const provinceVariants = tokens.province

  for (const sub of tokens.subdistrict) {
    for (const prov of provinceVariants) {
      for (const city of cityVariants) {
        add(prov, city, sub)
      }
      add(prov, null, sub)
    }
    for (const city of cityVariants) {
      add(null, city, sub)
    }
    add(null, null, sub)
  }

  return tuples.sort((a, b) => b.priority - a.priority)
}

async function tryParseAddressV3(
  detail: string,
  zipFromInput: string,
  supabase: SupabaseClient,
): Promise<ParseResult | null> {
  const tokens = extractTokensV3(detail)
  if (tokens.subdistrict.length === 0) return null

  const tuples = buildCandidateTuples(tokens).slice(0, 20)
  if (tuples.length === 0) return null

  const allMatches: Array<V3MatchRow & { priority: number }> = []
  for (const t of tuples) {
    const { data, error } = await supabase.rpc('parse_address_v3_lookup', {
      p_province: t.province,
      p_city: t.city,
      p_subdistrict: t.subdistrict,
    })
    if (error || !data) continue
    for (const row of data as V3MatchRow[]) {
      allMatches.push({ ...row, priority: t.priority })
    }
  }

  if (allMatches.length === 0) return null

  // Dedup by (province, city, subdistrict), keep best (score then priority)
  const grouped = new Map<string, V3MatchRow & { priority: number }>()
  for (const m of allMatches) {
    const key = `${m.province}|${m.city}|${m.subdistrict}`
    const existing = grouped.get(key)
    if (!existing || m.match_score > existing.match_score
        || (m.match_score === existing.match_score && m.priority > existing.priority)) {
      grouped.set(key, m)
    }
  }
  const unique = Array.from(grouped.values()).sort(
    (a, b) => b.match_score - a.match_score || b.priority - a.priority,
  )

  const top = unique[0]
  const runnerUp = unique[1]
  // Ambiguous: gap < 10 AND top score < 100 (tier 1 unique wins absolutely)
  const isAmbiguous = runnerUp !== undefined
    && top.match_score < 100
    && top.match_score - runnerUp.match_score < 10

  if (isAmbiguous) {
    return {
      success: false,
      reason: 'ambiguous',
      candidates: unique.slice(0, 5).map(m => ({
        id: 0,
        province: m.province,
        city: m.city,
        subdistrict: m.subdistrict,
        village: '',
        zip: m.zip,
        match_score: m.match_score,
      })),
      extracted_keywords: [],
    }
  }

  const confidence: ParsedAddress['confidence'] =
    top.match_score >= 95 ? 'high' : top.match_score >= 70 ? 'medium' : 'low'

  return {
    success: true,
    province: top.province,
    city: top.city,
    subdistrict: top.subdistrict,
    village: tokens.village[0] || null,
    zip: top.zip || zipFromInput,
    address_detail: detail,
    confidence,
  }
}

/**
 * Phase 8H — Parser dengan V3 first → V2 pattern → V1 keyword fallback.
 *   1. Trust structured fields (province + city + subdistrict ada) → high
 *   2. V3: extractTokensV3 + buildCandidateTuples + parse_address_v3_lookup RPC
 *      Handles Bug A/B/C (city as last segment, marker-tanpa-whitespace, city
 *      tanpa Kab./Kota prefix). Operates against master_wilayah_spx (7092 row).
 *   3. V2: extractTokensWithPatterns + search_wilayah_fuzzy (master_wilayah)
 *      Fallback untuk address yang ga ke-cover V3 (mis. non-SPX area).
 *   4. V1 legacy: extractKeywords + group by topScore (last resort)
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
    // Phase 8K-Geo: don't trust structured fields blindly — validate against
    // master_wilayah_spx so a user-typed combo that doesn't exist in any
    // ekspedisi master list (e.g. "Lampung / Pesawaran / Teluk Pandan", a
    // post-2021 pemekaran no master has synced yet) doesn't silently ship
    // wrong wilayah to the courier. If the structured combo resolves, use
    // master's canonical spelling; if it doesn't, fall through to the
    // detail-based STEP 2/3 so the row can still be salvaged or flagged.
    const { data: hits } = await supabase.rpc('parse_address_v3_lookup', {
      p_province: provStruct,
      p_city: cityStruct,
      p_subdistrict: subStruct,
    })
    type RpcHit = {
      province: string
      city: string
      subdistrict: string
      zip: string
      match_score: number
      matched_via: string
    }
    const hit = (hits as RpcHit[] | null)?.[0]
    if (hit) {
      const conflict = hit.matched_via !== 'tier1_exact'
      return {
        success: true,
        province: hit.province,
        city: hit.city,
        subdistrict: hit.subdistrict,
        village: null,
        zip: (raw.zip || '').trim() || hit.zip,
        address_detail: detailRaw,
        // tier1 = clean exact match. Anything else = best-guess that conflicts
        // with the user's province or city; flag low so downstream can route
        // it to the address-review inbox instead of silently accepting.
        confidence: conflict ? 'low' : 'high',
      }
    }
    // No master hit at all — let STEP 2/3 try the free-text detail.
  }

  if (!detailRaw) {
    return {
      success: false,
      reason: 'empty_input',
      candidates: [],
      extracted_keywords: [],
    }
  }

  // STEP 2 (Phase 8H V3): lookup-driven against master_wilayah_spx
  const v3 = await tryParseAddressV3(detailRaw, (raw.zip || '').trim(), supabase)
  if (v3 && v3.success) return v3

  // STEP 3 (Phase 8G V2): pattern-aware against master_wilayah (general)
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
      // Phase 8G fix: kalau exact empty + ada city context, relax ke prefix
      // match (score >= 80). Kasus: master_wilayah lokal punya alias
      // parenthesis (e.g. "Pinang (Penang)") → exact "pinang" miss tapi prefix hit.
      // City/province narrowing tetap disambiguate.
      if (filtered.length === 0 && (tokens.city_candidates.length > 0 || tokens.province_candidates.length > 0)) {
        filtered = cands.filter(c => c.match_score >= 80)
      }
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
