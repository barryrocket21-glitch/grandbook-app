import * as XLSX from 'xlsx'

export type RescuePriority = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'

export interface SyncRow {
  ref: string
  tracking_no: string | null
  tracking_status: string | null
  actual_fee: number | null
  return_fee: number | null
  delivered_at: string | null
  retur_reason: string | null
  cod_amount: number | null
  create_time: string | null
  rescue_priority: RescuePriority
}

export interface ParseResult {
  rows: SyncRow[]
  total: number
  withGb: number
  noGb: number
  withTracking: number
  fileName: string
  fileSize: number
}

export interface ExistingOrderKey {
  order_number?: string | null
  external_order_id?: string | null
  tracking_no?: string | null
  resi?: string | null
  raw_data?: { tracking_no?: string | null } | null
  meta?: { spx_tracking_no?: string | null } | null
}

export interface MissingPersistCandidate {
  ref: string
  tracking_no: string | null
}

function num(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '' || s === '-') return null
  const n = Number(s.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseDate(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '' || s === '-') return null
  // SPX Indonesia exports local WIB wall time, independent of the uploader's TZ.
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!m) throw new Error('Tanggal SPX tidak valid; gunakan format DD-MM-YYYY HH:mm WIB.')
  const [, d, mo, y, hh, mm, ss] = m
  const year = Number(y), month = Number(mo), day = Number(d)
  const hour = Number(hh || 0), minute = Number(mm || 0), second = Number(ss || 0)
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  // Reject overflow instead of silently moving an invalid date into another month.
  if (year < 1000 || wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1
    || wall.getUTCDate() !== day || wall.getUTCHours() !== hour
    || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second) {
    throw new Error('Tanggal SPX tidak valid; periksa tanggal dan jam pada file.')
  }
  return new Date(wall.getTime() - 7 * 60 * 60 * 1000).toISOString()
}

function rescuePriority(status: string | null, reason: string | null): RescuePriority {
  const s = String(status || '').trim().toLowerCase()
  const hasReason = !!String(reason || '').trim()
  if (hasReason || ['on hold', 'pending pickup', 'returning', 'damaged', 'lost', 'pickup on hold'].includes(s)) return 'HIGH'
  if (['in transit', 'delivering'].includes(s)) return 'MEDIUM'
  if (['cancelled', 'returned'].includes(s)) return 'LOW'
  return 'NONE'
}

export function parseSpxStatusFile(data: ArrayBuffer, fileName: string, fileSize: number): ParseResult {
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  let hi = -1
  for (let i = 0; i < Math.min(aoa.length, 6); i++) {
    if ((aoa[i] || []).some((c) => /customer reference no/i.test(String(c ?? '')))) { hi = i; break }
  }
  if (hi < 0) throw new Error('Header "Customer Reference No." gak ketemu — pastiin ini file status SPX.')
  const hdr = (aoa[hi] as unknown[]).map((h) => String(h ?? '').trim())
  const col = (re: RegExp) => hdr.findIndex((h) => re.test(h))
  const iRef = col(/^customer reference no\.?$/i)
  const iTrk = col(/^tracking no\.?$/i)
  const iStat = col(/^tracking status$/i)
  const iActual = col(/^actual shipping fee$/i)
  const iReturn = col(/^return shipping fee$/i)
  const iDeliv = col(/^delivered time$/i)
  const iFail = col(/^delivery failed reason$/i)
  const iHold = col(/^delivery onhold reason$/i)
  const iCod = col(/^COD Amount$/i)
  const iCreate = col(/^Create Time$/i)

  const rows: SyncRow[] = []
  let withGb = 0, noGb = 0, withTracking = 0
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i] as unknown[]
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue
    const ref = String(r[iRef] ?? '').trim()
    const trackingNo = iTrk >= 0 ? (String(r[iTrk] ?? '').trim() || null) : null
    const status = iStat >= 0 ? (String(r[iStat] ?? '').trim() || null) : null
    const reason = ((iFail >= 0 ? String(r[iFail] ?? '').trim() : '') || (iHold >= 0 ? String(r[iHold] ?? '').trim() : '')) || null
    const isGb = ref.startsWith('GB-')
    if (isGb) withGb++; else noGb++
    if (trackingNo) withTracking++
    rows.push({
      ref,
      tracking_no: trackingNo,
      tracking_status: status,
      actual_fee: iActual >= 0 ? num(r[iActual]) : null,
      return_fee: iReturn >= 0 ? num(r[iReturn]) : null,
      delivered_at: iDeliv >= 0 ? parseDate(r[iDeliv]) : null,
      retur_reason: reason,
      cod_amount: iCod >= 0 ? num(r[iCod]) : null,
      create_time: iCreate >= 0 ? parseDate(r[iCreate]) : null,
      rescue_priority: rescuePriority(status, reason),
    })
  }
  return { rows, total: rows.length, withGb, noGb, withTracking, fileName, fileSize }
}

export function findMissingPersistCandidates(rows: SyncRow[], existing: ExistingOrderKey[]): MissingPersistCandidate[] {
  const key = (value: string | null | undefined) => {
    const normalized = String(value ?? '').trim().toUpperCase()
    return normalized === '-' ? '' : normalized
  }
  const refs = new Set(existing.flatMap((x) => [key(x.order_number), key(x.external_order_id)]).filter(Boolean))
  const tracks = new Set(existing.flatMap((x) => [key(x.tracking_no), key(x.resi), key(x.raw_data?.tracking_no), key(x.meta?.spx_tracking_no)]).filter(Boolean))
  const candidates = rows.map(row => ({ ref: key(row.ref), tracking_no: key(row.tracking_no) || null }))
    .filter(row => /^GB-\d{8}-\d{6}$/.test(row.ref))
  const parents = candidates.map((_, index) => index)
  const root = (index: number): number => {
    let current = index
    while (parents[current] !== current) current = parents[current]
    while (parents[index] !== index) { const next = parents[index]; parents[index] = current; index = next }
    return current
  }
  const firstRef = new Map<string, number>()
  const firstTrack = new Map<string, number>()
  candidates.forEach((row, index) => {
    for (const [map, identity] of [[firstRef, row.ref], [firstTrack, row.tracking_no]] as const) {
      if (!identity) continue
      const previous = map.get(identity)
      if (previous === undefined) map.set(identity, index)
      else { const a = root(index), b = root(previous); parents[Math.max(a, b)] = Math.min(a, b) }
    }
  })
  const known = new Set<number>()
  candidates.forEach((row, index) => {
    if (refs.has(row.ref) || (row.tracking_no && tracks.has(row.tracking_no))) known.add(root(index))
  })
  return candidates.filter((_, index) => root(index) === index && !known.has(index))
}
