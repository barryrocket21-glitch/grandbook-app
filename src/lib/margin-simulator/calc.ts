// =============================================================
// Phase 7 v2 — Margin Simulator calc (per-periode aware)
// =============================================================
// Formula chain (per hari → kalikan periode):
//   lead_real_pd     = lead_dashboard × (lead_real_pct / 100)
//   closing_pd       = lead_real_pd × (closing_rate / 100)
//   terkirim_pd      = closing_pd × (1 − rts_rate / 100)
//
//   lead_real        = lead_real_pd × periode_days
//   closing          = closing_pd × periode_days
//   terkirim         = terkirim_pd × periode_days
//
//   budget_iklan     = lead_dashboard × cpr_max × periode_days
//   (Meta charge per lead DASHBOARD, NOT per lead real — itu sebabnya
//    cpr_max ditarik dari sisi lead_dashboard, bukan lead_real.)
//
//   gross_margin     = terkirim × margin_item
//   ppn_amount       = gross_margin × (ppn_rate / 100)
//   total_margin     = gross_margin − ppn_amount
//   profit_loss      = total_margin − budget_iklan
//   roi_percent      = profit_loss / budget_iklan × 100
//
// CPR break-even (per lead DASHBOARD, periode-independent):
//   profit_loss = 0
//   → terkirim × margin × (1 − ppn) = lead_dashboard × cpr_breakeven × periode
//   Substitusi terkirim = lead_dashboard × (lr%) × (cr%) × (1−rts%) × periode:
//   cpr_breakeven = (lr%) × (cr%) × (1 − rts%) × margin × (1 − ppn%)
//   (periode cancel out, jadi nilai ini valid untuk semua periode toggle.)
// =============================================================
import type {
  SimulatorScenario,
  SimulatorOutput,
  PeriodeDays,
} from '@/lib/types'

export function calculate(s: SimulatorScenario, periode: PeriodeDays): SimulatorOutput {
  const lead_real_pd = s.lead_dashboard * (s.lead_real_pct / 100)
  const closing_pd = lead_real_pd * (s.closing_rate / 100)
  const terkirim_pd = closing_pd * (1 - s.rts_rate / 100)

  const lead_real = lead_real_pd * periode
  const closing = closing_pd * periode
  const terkirim = terkirim_pd * periode

  // Meta charges per lead dashboard, not per lead real.
  const budget_iklan = s.lead_dashboard * s.cpr_max * periode
  const gross_margin = terkirim * s.margin_item
  const ppn_amount = gross_margin * (s.ppn_rate / 100)
  const total_margin = gross_margin - ppn_amount
  const profit_loss = total_margin - budget_iklan
  const roi_percent = budget_iklan > 0 ? (profit_loss / budget_iklan) * 100 : 0

  // CPR break-even per lead dashboard — periode cancels out, same answer for 1/7/30.
  const cpr_breakeven =
    (s.lead_real_pct / 100) *
    (s.closing_rate / 100) *
    (1 - s.rts_rate / 100) *
    s.margin_item *
    (1 - s.ppn_rate / 100)

  // Threshold 1000 rupiah supaya status nggak flicker karena rounding kecil.
  let status: SimulatorOutput['status'] = 'breakeven'
  if (profit_loss > 1000) status = 'profit'
  else if (profit_loss < -1000) status = 'loss'

  return {
    lead_real,
    closing,
    terkirim,
    budget_iklan,
    total_margin,
    profit_loss,
    roi_percent,
    cpr_breakeven,
    status,
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

export function getInsight(s: SimulatorScenario, o: SimulatorOutput): string {
  if (o.status === 'profit') {
    const headroom = o.cpr_breakeven - s.cpr_max
    return `CPR break-even ${formatIDR(o.cpr_breakeven)} per lead dashboard. Headroom ${formatIDR(headroom)}.`
  }
  if (o.status === 'loss') {
    if (o.cpr_breakeven < s.cpr_max) {
      return `Turunkan CPR max ke ${formatIDR(o.cpr_breakeven)} atau naikkan closing rate / lead real %.`
    }
    return `Struktur loss — adjust closing rate, RTS, atau pilih produk margin lebih besar.`
  }
  return `Break-even. Adjust 5–10% di salah satu metric untuk profit.`
}
