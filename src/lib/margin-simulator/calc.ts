// =============================================================
// Phase 7 — Margin Simulator calculator (pure functions)
// =============================================================
// Formula chain:
//   lead_real     = lead_dashboard × multiplier
//   closing       = lead_real × (closing_rate / 100)
//   terkirim      = closing × (1 − rts_rate / 100)
//   budget_iklan  = lead_real × cpr_max
//   gross_margin  = terkirim × margin_item
//   ppn_amount    = gross_margin × (ppn_rate / 100)
//   total_margin  = gross_margin − ppn_amount
//   profit_loss   = total_margin − budget_iklan
//   roi_percent   = profit_loss / budget_iklan × 100
//
// CPR break-even (max CPR yang masih untung):
//   profit_loss = 0 → total_margin = budget_iklan
//   (lead_real × cr × (1-rts) × margin × (1-ppn)) = (lead_real × cpr_max)
//   cpr_be = cr × (1-rts) × margin × (1-ppn)
//   (cancel-out lead_real & multiplier — structural per-lead value)
// =============================================================
import type { SimulatorInput, SimulatorOutput } from '@/lib/types'

export const DEFAULT_INPUT: SimulatorInput = {
  product_id: null,
  margin_item: 0,
  cpr_max: 0,
  lead_dashboard: 100,
  jenis_iklan: 'Form',
  multiplier: 1.0,
  closing_rate: 20,
  rts_rate: 20,
  ppn_rate: 12,
}

export function calculate(input: SimulatorInput): SimulatorOutput {
  const lead_real = input.lead_dashboard * input.multiplier
  const closing = lead_real * (input.closing_rate / 100)
  const terkirim = closing * (1 - input.rts_rate / 100)
  const budget_iklan = lead_real * input.cpr_max
  const gross_margin = terkirim * input.margin_item
  const ppn_amount = gross_margin * (input.ppn_rate / 100)
  const total_margin = gross_margin - ppn_amount
  const profit_loss = total_margin - budget_iklan
  const roi_percent = budget_iklan > 0 ? (profit_loss / budget_iklan) * 100 : 0

  // CPR break-even = per-lead value (structural; tidak depend on lead_real volume)
  const cpr_breakeven =
    input.margin_item *
    (input.closing_rate / 100) *
    (1 - input.rts_rate / 100) *
    (1 - input.ppn_rate / 100)

  // Structural loss = CPR max sudah di atas break-even (impossible jadi profit
  // selama asumsi closing/rts/margin tidak berubah).
  const structural_loss = input.cpr_max > cpr_breakeven && cpr_breakeven > 0

  let status: SimulatorOutput['status'] = 'breakeven'
  if (profit_loss > 0.005) status = 'profit'
  else if (profit_loss < -0.005) status = 'loss'

  return {
    lead_real,
    closing,
    terkirim,
    budget_iklan,
    gross_margin,
    ppn_amount,
    total_margin,
    profit_loss,
    roi_percent,
    cpr_breakeven,
    status,
    structural_loss,
  }
}

export function formatIDR(value: number): string {
  if (!Number.isFinite(value)) return 'Rp 0'
  const rounded = Math.round(value)
  return 'Rp ' + rounded.toLocaleString('id-ID')
}

export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(digits)}%`
}

export function getInsight(input: SimulatorInput, output: SimulatorOutput): string {
  if (output.status === 'profit') {
    return `CPR break-even: ${formatIDR(output.cpr_breakeven)}. Margin per lead masih aman; CPR max sekarang ${formatIDR(input.cpr_max)}.`
  }
  if (output.status === 'loss') {
    if (output.structural_loss) {
      return `Struktur loss — CPR max (${formatIDR(input.cpr_max)}) di atas break-even (${formatIDR(output.cpr_breakeven)}). Turunkan CPR, naikkan closing rate, atau pilih produk dengan margin lebih besar.`
    }
    return `Loss. Adjust salah satu: CPR (${formatIDR(input.cpr_max)}) → ke ${formatIDR(output.cpr_breakeven)} max, closing (${formatPct(input.closing_rate, 0)}), atau RTS (${formatPct(input.rts_rate, 0)}).`
  }
  return `Break-even. Naik 5–10% di closing rate, RTS rate (turun), atau margin per item untuk masuk zona profit.`
}
