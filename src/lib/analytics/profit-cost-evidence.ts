import { validateCosts, type CostRow } from '../financial/actual-cost-report'

type IndexRow = { order_number: string }
type IndexPage = { data: IndexRow[] | null; count: number | null; error: unknown }
export async function readProfitCostEvidence(
  refs: string[],
  index: (table: 'spx_actual_costs' | 'spx_settlement_costs', refs: string[]) => PromiseLike<IndexPage>,
  detail: (refs: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Map<string, CostRow>> {
  if (refs.some(r => !r) || new Set(refs).size !== refs.length) throw Error('Identitas order biaya tidak unik.')
  const result = new Map<string, CostRow>()
  for (let offset = 0; offset < refs.length; offset += 500) {
    const batch = refs.slice(offset, offset + 500)
    const pages = await Promise.all([index('spx_actual_costs', batch), index('spx_settlement_costs', batch)])
    const matched: string[] = []
    for (const page of pages) {
      if (page.error || !Array.isArray(page.data) || page.count !== page.data.length) throw Error('Daftar bukti biaya tidak lengkap.')
      for (const row of page.data) {
        if (!batch.includes(row.order_number) || matched.includes(row.order_number)) throw Error('Bukti biaya ganda atau tidak cocok.')
        matched.push(row.order_number)
      }
    }
    if (!matched.length) continue
    const response = await detail(matched)
    if (response.error) throw Error('Pembacaan bukti biaya gagal.')
    for (const row of validateCosts(response.data, matched)) {
      if (!['VERIFIED_COMPONENTS', 'VERIFIED_SETTLEMENT'].includes(row.basis)) throw Error('Bukti biaya berubah; muat ulang.')
      result.set(row.order_number, row)
    }
  }
  return result
}

export type ProfitCostBasis = 'verified' | 'legacy' | 'estimate' | 'missing'
export function profitShippingCost(order: {
  order_number: string; shipping_cost_actual: number | null;
  estimated_shipping_net: number | null; estimated_cod_fee: number | null;
}, evidence: Map<string, CostRow>): { amount: number; basis: ProfitCostBasis } {
  const verified = evidence.get(order.order_number)
  if (verified) return { amount: Number(verified.total), basis: 'verified' }
  for (const value of [order.shipping_cost_actual, order.estimated_shipping_net, order.estimated_cod_fee]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw Error('Biaya order tidak valid.')
  }
  if (order.shipping_cost_actual !== null && order.shipping_cost_actual > 0) return { amount: order.shipping_cost_actual, basis: 'legacy' }
  const estimate = (order.estimated_shipping_net ?? 0) + (order.estimated_cod_fee ?? 0)
  return { amount: estimate, basis: estimate > 0 ? 'estimate' : 'missing' }
}
