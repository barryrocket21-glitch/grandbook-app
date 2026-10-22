export type CostBasis = 'VERIFIED_COMPONENTS' | 'VERIFIED_SETTLEMENT' | 'ESTIMATE' | 'MISSING'
export interface CostRow {
  order_number: string
  basis: CostBasis
  shipping: number | string | null
  cod: number | string | null
  ppn: number | string | null
  total: number | string | null
  external_id: string | null
  settlement_sn?: string | null
  nominal?: string | null
  balance_before?: string | null
  balance_after?: string | null
  actual_minus_nominal_debit?: string | null
  actual_minus_balance_debit?: string | null
  cash_reconciled?: boolean
}
export function cents(value: number | string): bigint {
  const text = String(value)
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error('Nilai biaya tidak valid.')
  const negative = text.startsWith('-'), [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  return (BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))) * (negative ? -BigInt(1) : BigInt(1))
}
export function rupiah(value: bigint): string {
  const absolute = value < BigInt(0) ? -value : value
  const fraction = absolute % BigInt(100)
  return `${value < BigInt(0) ? '-' : ''}Rp${(absolute / BigInt(100)).toLocaleString('id-ID')}${fraction ? ',' + String(fraction).padStart(2, '0') : ''}`
}
export function parseReferences(text: string): string[] {
  const refs = [...new Set(text.split(/[\s,;]+/).filter(Boolean))]
  if (!refs.length || refs.length > 500 || refs.some(r => r.length > 100)) throw new Error('Masukkan 1–500 nomor GB, dipisahkan baris atau koma.')
  return refs
}
export function validateCosts(data: unknown, refs: string[]): CostRow[] {
  if (!Array.isArray(data) || data.length !== refs.length) throw new Error('Rincian biaya tidak lengkap.')
  const wanted = new Set(refs), seen = new Set<string>()
  for (const row of data) {
    if (!row || !wanted.has(row.order_number) || seen.has(row.order_number) || !['VERIFIED_COMPONENTS', 'VERIFIED_SETTLEMENT', 'ESTIMATE', 'MISSING'].includes(row.basis)) throw new Error('Identitas atau basis biaya tidak valid.')
    seen.add(row.order_number)
    for (const field of ['shipping', 'cod', 'ppn', 'total']) {
      if (row[field] !== null && !['string', 'number'].includes(typeof row[field])) throw new Error('Nilai biaya tidak lengkap.')
      if (row[field] !== null) cents(row[field])
    }
    if (['VERIFIED_COMPONENTS', 'VERIFIED_SETTLEMENT'].includes(row.basis) && (row.shipping === null || row.cod === null || row.total === null || (typeof row.external_id !== 'string' || !row.external_id.trim()) || cents(row.shipping) < BigInt(0) || cents(row.cod) < BigInt(0) || cents(row.total) <= BigInt(0) || row.ppn !== null || cents(row.shipping) + cents(row.cod) !== cents(row.total))) throw new Error('Komponen biaya aktual tidak cocok.')
    if (row.basis === 'VERIFIED_SETTLEMENT') {
      if (typeof row.settlement_sn !== 'string' || !row.settlement_sn.trim() || row.cash_reconciled !== false) throw new Error('Bukti settlement tidak lengkap.')
      for (const field of ['nominal', 'balance_before', 'balance_after', 'actual_minus_nominal_debit', 'actual_minus_balance_debit']) {
        if (typeof row[field] !== 'string') throw new Error('Rincian selisih settlement tidak lengkap.')
        cents(row[field])
      }
      if (cents(row.nominal) >= BigInt(0) || cents(row.total) + cents(row.nominal) !== cents(row.actual_minus_nominal_debit) || cents(row.total) - cents(row.balance_before) + cents(row.balance_after) !== cents(row.actual_minus_balance_debit)) throw new Error('Selisih settlement tidak cocok.')
    }
    if (row.basis === 'ESTIMATE' && row.total === null) throw new Error('Total estimasi tidak lengkap.')
    if (row.basis === 'MISSING' && row.total !== null) throw new Error('Basis biaya tidak cocok.')
  }
  return data as CostRow[]
}
export function costTotals(rows: CostRow[]) {
  return rows.reduce((s, row) => {
    if (row.basis === 'VERIFIED_COMPONENTS' || row.basis === 'VERIFIED_SETTLEMENT') { s.actual += cents(row.total!); s.actualCount++ }
    else if (row.basis === 'ESTIMATE') { s.estimate += cents(row.total!); s.estimateCount++ }
    else s.missingCount++
    return s
  }, { actual: BigInt(0), estimate: BigInt(0), actualCount: 0, estimateCount: 0, missingCount: 0 })
}

export interface RecentCost { order_number: string; external_id: string; transaction_at: string }
export function latestCostReferences(groups: RecentCost[][]): string[] {
  const rows = groups.flat()
  if (rows.some(r => !r.order_number || !r.external_id || !Number.isFinite(Date.parse(r.transaction_at)))) throw new Error('Identitas biaya terbaru tidak lengkap.')
  if (new Set(rows.map(r => r.order_number)).size !== rows.length || new Set(rows.map(r => r.external_id)).size !== rows.length) throw new Error('Biaya tercatat ganda; perlu diperiksa.')
  return rows.sort((a,b) => Date.parse(b.transaction_at) - Date.parse(a.transaction_at) || a.external_id.localeCompare(b.external_id)).slice(0,50).map(r => r.order_number)
}
