// =============================================================
// Cost calculator (Phase 4C) — TypeScript mirror dari compute_order_costs SQL
// Dipakai di Settings courier-rates Preview Calculator + di mana saja yang
// butuh estimasi cost client-side tanpa round-trip ke server.
//
// Logic harus identik dengan migration 018 compute_order_costs() supaya
// preview matches actual computation.
// =============================================================
import type { BillingModel, CodFeeBase, CodFeeRounding, PpnAppliedTo } from '@/lib/types'

export interface CostInput {
  // Order data
  payment_method: 'COD' | 'TRANSFER'
  total: number
  subtotal: number
  /** Gross shipping yang ditagih ke customer */
  shipping_cost: number
  /** Actual shipping dari ekspedisi (kalau sudah rekonsil). Override shipping_cost kalau ada. */
  shipping_cost_actual?: number | null
  /** Total HPP (sum qty * hpp_snapshot per item). Optional untuk preview. */
  hpp?: number
  /** Total commissions ESTIMATED+EARNED+PAID (exclude CANCELLED). Optional untuk preview. */
  commission?: number

  // Channel config (would normally fetched from DB)
  billing_model: BillingModel
  shipping_discount_rate: number  // PERCENT scale 0..100 (e.g. 40 = 40%) — codebase convention
  cod_fee_rate: number             // PERCENT scale 0..100 (e.g. 1 = 1%)
  ppn_rate: number                 // PERCENT scale 0..100 (e.g. 12 = 12%)
  cod_fee_base: CodFeeBase
  cod_fee_rounding: CodFeeRounding
  ppn_applied_to: PpnAppliedTo
}

export interface CostBreakdown {
  shipping_gross: number
  shipping_discount: number
  shipping_net: number
  cod_fee_base_amount: number
  cod_fee_raw: number
  cod_fee: number
  ppn: number
  total_cost: number
  cash_in: number
  hpp: number
  commission: number
  profit: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

export function computeCost(input: CostInput): CostBreakdown {
  const shipping_gross = input.shipping_cost_actual != null && input.shipping_cost_actual > 0
    ? input.shipping_cost_actual
    : (input.shipping_cost || 0)

  // Rates disimpan PERCENT (40 untuk 40%) — divide by 100 saat hitung.
  const shipping_discount = round2(shipping_gross * input.shipping_discount_rate / 100)
  const shipping_net = round2(shipping_gross - shipping_discount)

  // COD fee base
  let cod_fee_base_amount = 0
  switch (input.cod_fee_base) {
    case 'NOMINAL_COD':
      cod_fee_base_amount = input.payment_method === 'COD' ? input.total : 0
      break
    case 'BARANG_PLUS_ONGKIR_GROSS':
      cod_fee_base_amount = input.subtotal + shipping_gross
      break
    case 'BARANG_PLUS_ONGKIR_NET':
      cod_fee_base_amount = input.subtotal + shipping_net
      break
  }

  const cod_fee_raw = cod_fee_base_amount * input.cod_fee_rate / 100
  let cod_fee = 0
  switch (input.cod_fee_rounding) {
    case 'FLOOR':
      cod_fee = Math.floor(cod_fee_raw)
      break
    case 'CEIL':
      cod_fee = Math.ceil(cod_fee_raw)
      break
    case 'ROUND':
      cod_fee = Math.round(cod_fee_raw)
      break
  }

  // PPN (rate divided by 100)
  let ppn = 0
  switch (input.ppn_applied_to) {
    case 'COD_FEE_ONLY':
      ppn = cod_fee * input.ppn_rate / 100
      break
    case 'COD_FEE_PLUS_SHIPPING':
      ppn = (cod_fee + shipping_net) * input.ppn_rate / 100
      break
    case 'NONE':
      ppn = 0
      break
  }
  ppn = round2(ppn)

  const total_cost = round2(shipping_net + cod_fee + ppn)

  // Cash in by billing model
  let cash_in = 0
  switch (input.billing_model) {
    case 'MONTHLY_INVOICE':
      cash_in = input.payment_method === 'COD' ? input.total : 0
      break
    case 'NETT_OFF_PER_ORDER':
      cash_in = input.payment_method === 'COD' ? input.total - total_cost : 0
      break
    case 'DIRECT_TRANSFER':
      cash_in = input.payment_method === 'TRANSFER' ? input.total : 0
      break
    case 'NO_RECONCILIATION':
      cash_in = input.payment_method === 'COD' ? input.total : 0
      break
  }
  cash_in = round2(cash_in)

  const hpp = input.hpp ?? 0
  const commission = input.commission ?? 0

  // Profit:
  //   MONTHLY_INVOICE: cash_in masih full (cost belum dipotong) → kurang cost
  //   Lainnya: cash_in sudah dipotong cost atau tidak ada cost → langsung
  let profit = cash_in - hpp - commission
  if (input.billing_model === 'MONTHLY_INVOICE') {
    profit -= total_cost
  }
  profit = round2(profit)

  return {
    shipping_gross,
    shipping_discount,
    shipping_net,
    cod_fee_base_amount,
    cod_fee_raw,
    cod_fee,
    ppn,
    total_cost,
    cash_in,
    hpp,
    commission,
    profit,
  }
}
