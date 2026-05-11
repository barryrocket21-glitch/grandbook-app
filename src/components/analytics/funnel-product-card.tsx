'use client'
// =============================================================
// FunnelProductCard (Phase 6 — UI polish)
//
// Card-based replacement untuk tabel 12-kolom Funnel & Cross-Check.
// 1 card per produk dengan:
//   - Header: nama + kategori + status badge
//   - KPI right: ROAS (kalau spend>0) atau Close Rate (kalau no spend)
//   - 3 mini metrics: Spend / Revenue / Close Rate
//   - Visual funnel: 4 boxes (Meta Lead → CS Lead → CS Close → System Order)
//     dengan variance arrows + warna kontekstual
//   - Insight box: auto-generated action message berdasarkan kondisi data
// =============================================================
import { ArrowRight, Lightbulb, CircleCheck, TriangleAlert, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatRupiah, formatNumber } from '@/lib/format'
import type { FunnelPerProductRow } from '@/lib/supabase/queries/analytics'

type Status = 'HEALTHY' | 'WARNING' | 'CRITICAL'

interface Props {
  row: FunnelPerProductRow
}

// --- Status computation ---------------------------------------------------
function computeStatus(row: FunnelPerProductRow): Status {
  const spend = Number(row.total_spend)
  const closeRate = Number(row.close_rate_cs)
  const roas = Number(row.roas_system)
  const hasSpend = row.has_meta_data && spend > 0
  const hasCs = row.has_cs_data && Number(row.cs_lead_count) > 0

  // CRITICAL: explicit loss (spend > 0 dengan roas < 1) atau close rate sangat rendah
  if (hasSpend && roas > 0 && roas < 1) return 'CRITICAL'
  if (hasCs && closeRate < 10) return 'CRITICAL'

  // HEALTHY: close rate bagus DAN (no spend ATAU roas decent)
  if (hasCs && closeRate >= 20 && (!hasSpend || roas >= 1)) return 'HEALTHY'

  // WARNING: ada signifikansi variance, atau close rate borderline (10-20%)
  const sigVarLead = Math.abs(Number(row.variance_lead_meta_cs)) >= 5 && row.has_meta_data && row.has_cs_data
  const sigVarClose = Math.abs(Number(row.variance_closing_cs_system)) >= 5 && row.has_cs_data && row.has_system_data
  if (sigVarLead || sigVarClose) return 'WARNING'
  if (hasCs && closeRate >= 10 && closeRate < 20) return 'WARNING'

  // Default fallback (no enough data → treat neutral as WARNING)
  return hasSpend || hasCs ? 'WARNING' : 'HEALTHY'
}

// --- Insight generation ---------------------------------------------------
function generateInsight(row: FunnelPerProductRow): { keyword: string; message: string } {
  const spend = Number(row.total_spend)
  const closeRate = Number(row.close_rate_cs)
  const roas = Number(row.roas_system)
  const metaLead = Number(row.meta_lead_count)
  const csClose = Number(row.cs_closing_count)
  const sysOrder = Number(row.system_orders_count)
  const varClose = Number(row.variance_closing_cs_system)

  // Priority 1: backlog (system < cs_close, artinya CS catat lebih banyak dari yang masuk system)
  if (row.has_cs_data && row.has_system_data && varClose < -5) {
    const backlog = Math.abs(varClose)
    return {
      keyword: 'Backlog CS',
      message: `${backlog} closing belum di-input ke system (CS catat ${formatNumber(csClose)}, system cuma ${formatNumber(sysOrder)} order). Cek backlog CS.`,
    }
  }

  // Priority 2: ROAS loss
  if (row.has_meta_data && spend > 0 && roas > 0 && roas < 1) {
    return {
      keyword: 'ROAS Loss',
      message: `ROAS ${roas.toFixed(2)}x — campaign masih rugi. Pertimbangkan pause atau optimize creative.`,
    }
  }

  // Priority 3: close rate rendah
  if (row.has_cs_data && Number(row.cs_lead_count) >= 5 && closeRate < 10) {
    return {
      keyword: 'Close Rate Rendah',
      message: `Close rate ${closeRate.toFixed(1)}% — evaluasi sales script atau lead quality.`,
    }
  }

  // Priority 4: Meta tidak track lead
  if (row.has_meta_data && spend > 0 && metaLead === 0) {
    return {
      keyword: 'Meta Lead Hilang',
      message: 'Meta lead tidak ke-track padahal ada spend — cek setup Meta Pixel atau Conversion API.',
    }
  }

  // Priority 5: top performer (scale up)
  if (row.has_cs_data && Number(row.cs_lead_count) >= 10 && closeRate >= 50) {
    return {
      keyword: 'Excellent',
      message: `Close rate ${closeRate.toFixed(1)}% — pertimbangkan scale up budget atau replicate strategy.`,
    }
  }

  // Default
  return {
    keyword: 'Funnel Sehat',
    message: 'Maintain current strategy. Cek lagi minggu depan.',
  }
}

// --- Sub: status badge ----------------------------------------------------
function StatusBadge({ status }: { status: Status }) {
  if (status === 'HEALTHY') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 dark:text-emerald-400">
        <CircleCheck className="w-3 h-3" />Healthy
      </span>
    )
  }
  if (status === 'WARNING') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-700 border border-amber-500/30 dark:text-amber-400">
        <TriangleAlert className="w-3 h-3" />Warning
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-700 border border-red-500/30 dark:text-red-400">
      <AlertCircle className="w-3 h-3" />Critical
    </span>
  )
}

// --- Sub: funnel box ------------------------------------------------------
type BoxTone = 'meta' | 'cs-lead' | 'cs-close' | 'system'

const BOX_STYLES: Record<BoxTone, string> = {
  meta:
    'bg-[#F1EFE8] text-[#2C2C2A] dark:bg-[#2C2C2A] dark:text-[#F1EFE8]',
  'cs-lead':
    'bg-[#EAF3DE] text-[#173404] dark:bg-[#173404] dark:text-[#EAF3DE]',
  'cs-close':
    'bg-[#E1F5EE] text-[#04342C] dark:bg-[#04342C] dark:text-[#E1F5EE]',
  system:
    'bg-[#FAEEDA] text-[#412402] dark:bg-[#412402] dark:text-[#FAEEDA]',
}

const BOX_SUBTITLE: Record<BoxTone, string> = {
  meta: 'text-[#5F5E5A] dark:text-[#A8A6A0]',
  'cs-lead': 'text-[#3B6D11] dark:text-[#A6CC7E]',
  'cs-close': 'text-[#0F6E56] dark:text-[#7DCDB6]',
  system: 'text-[#854F0B] dark:text-[#D7AB6E]',
}

function FunnelBox({
  tone, label, value, hasData,
}: {
  tone: BoxTone
  label: string
  value: number
  hasData: boolean
}) {
  return (
    <div
      className={`flex-1 min-w-[88px] rounded-lg p-3 text-center transition-opacity ${BOX_STYLES[tone]} ${hasData ? '' : 'opacity-50'}`}
    >
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${BOX_SUBTITLE[tone]}`}>
        {label}
      </div>
      <div className="text-xl font-bold mt-1">
        {hasData ? formatNumber(value) : '—'}
      </div>
      {!hasData && (
        <div className={`text-[9px] mt-0.5 italic ${BOX_SUBTITLE[tone]}`}>no data</div>
      )}
    </div>
  )
}

// --- Sub: variance arrow connector ---------------------------------------
function VarianceArrow({
  primaryText, primaryClass, subtitle,
}: {
  primaryText: string | null
  primaryClass?: string
  subtitle?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center px-1 shrink-0 min-w-[40px]">
      <ArrowRight className="w-4 h-4 text-muted-foreground" />
      {primaryText && (
        <div className={`text-[10px] font-semibold leading-tight mt-0.5 text-center ${primaryClass}`}>
          {primaryText}
        </div>
      )}
      {subtitle && (
        <div className="text-[9px] text-muted-foreground leading-tight">{subtitle}</div>
      )}
    </div>
  )
}

// --- Sub: insight box ----------------------------------------------------
function InsightBox({ status, keyword, message }: { status: Status; keyword: string; message: string }) {
  const tint =
    status === 'CRITICAL'
      ? 'bg-red-500/5 border-red-500/30 text-red-700 dark:text-red-400'
      : status === 'WARNING'
        ? 'bg-amber-500/5 border-amber-500/30 text-amber-700 dark:text-amber-400'
        : 'bg-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
  return (
    <div className={`rounded-lg border p-3 flex gap-2.5 items-start ${tint}`}>
      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="text-xs leading-snug">
        <span className="font-semibold">{keyword}.</span>{' '}
        <span className="text-muted-foreground">{message}</span>
      </div>
    </div>
  )
}

// --- Main component ------------------------------------------------------
export function FunnelProductCard({ row }: Props) {
  const status = computeStatus(row)
  const insight = generateInsight(row)

  const spend = Number(row.total_spend)
  const revenue = Number(row.system_revenue)
  const closeRate = Number(row.close_rate_cs)
  const roas = Number(row.roas_system)
  const hasSpend = row.has_meta_data && spend > 0

  // KPI right (1 angka besar)
  const kpiValue = hasSpend
    ? `${roas > 0 ? roas.toFixed(2) : '0.00'}x`
    : `${closeRate.toFixed(1)}%`
  const kpiLabel = hasSpend ? 'ROAS' : 'Close Rate'
  const kpiClass = hasSpend
    ? roas >= 2 ? 'text-emerald-600 dark:text-emerald-400'
      : roas >= 1 ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400'
    : closeRate >= 30 ? 'text-emerald-600 dark:text-emerald-400'
      : closeRate >= 10 ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400'

  // Variance Meta → CS Lead
  const varLead = Number(row.variance_lead_meta_cs)
  const showVarLead = row.has_meta_data && row.has_cs_data
  const varLeadEl = showVarLead && varLead !== 0
    ? varLead > 0
      ? { text: `+${formatNumber(varLead)}`, cls: 'text-emerald-600 dark:text-emerald-400', sub: 'organic' }
      : { text: `${formatNumber(varLead)}`, cls: 'text-red-600 dark:text-red-400', sub: 'Meta over' }
    : null

  // Close rate antara CS Lead → CS Close
  const showCloseArrow = row.has_cs_data && Number(row.cs_lead_count) > 0
  const closeRateEl = showCloseArrow
    ? {
      text: `${closeRate.toFixed(1)}%`,
      cls:
        closeRate >= 30 ? 'text-emerald-600 dark:text-emerald-400'
          : closeRate >= 10 ? 'text-amber-600 dark:text-amber-400'
            : 'text-red-600 dark:text-red-400',
    }
    : null

  // Variance CS Close → System Order
  const varClose = Number(row.variance_closing_cs_system)
  const showVarClose = row.has_cs_data && row.has_system_data
  const varCloseEl = showVarClose && varClose !== 0
    ? varClose > 0
      ? { text: `+${formatNumber(varClose)}`, cls: 'text-emerald-600 dark:text-emerald-400', sub: undefined as string | undefined }
      : { text: `${formatNumber(varClose)}`, cls: 'text-amber-600 dark:text-amber-400', sub: `${Math.abs(varClose)} backlog` }
    : null

  return (
    <Card>
      <CardContent className="pt-5 pb-5 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold leading-tight">
              {row.product_name || `#${row.product_id}`}
            </h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              {row.category_name && (
                <Badge variant="outline" className="text-[10px]">{row.category_name}</Badge>
              )}
              <StatusBadge status={status} />
              <div className="flex gap-1 ml-1">
                {row.has_meta_data && <span className="text-[9px] text-orange-600">●Meta</span>}
                {row.has_cs_data && <span className="text-[9px] text-blue-600">●CS</span>}
                {row.has_system_data && <span className="text-[9px] text-emerald-600">●Sys</span>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold leading-none ${kpiClass}`}>{kpiValue}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{kpiLabel}</div>
          </div>
        </div>

        {/* 3 mini metric cards */}
        <div className="grid grid-cols-3 gap-2">
          <MiniMetric label="Spend" value={hasSpend ? formatRupiah(spend) : '—'} />
          <MiniMetric label="Revenue" value={row.has_system_data ? formatRupiah(revenue) : '—'} />
          <MiniMetric label="Close Rate" value={row.has_cs_data && Number(row.cs_lead_count) > 0 ? `${closeRate.toFixed(1)}%` : '—'} />
        </div>

        {/* Funnel visual */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Funnel</div>
          <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
            <FunnelBox
              tone="meta"
              label="Meta Lead"
              value={Number(row.meta_lead_count)}
              hasData={row.has_meta_data}
            />
            <VarianceArrow
              primaryText={varLeadEl?.text ?? null}
              primaryClass={varLeadEl?.cls}
              subtitle={varLeadEl?.sub}
            />
            <FunnelBox
              tone="cs-lead"
              label="CS Lead"
              value={Number(row.cs_lead_count)}
              hasData={row.has_cs_data}
            />
            <VarianceArrow
              primaryText={closeRateEl?.text ?? null}
              primaryClass={closeRateEl?.cls}
            />
            <FunnelBox
              tone="cs-close"
              label="CS Close"
              value={Number(row.cs_closing_count)}
              hasData={row.has_cs_data}
            />
            <VarianceArrow
              primaryText={varCloseEl?.text ?? null}
              primaryClass={varCloseEl?.cls}
              subtitle={varCloseEl?.sub}
            />
            <FunnelBox
              tone="system"
              label="System Order"
              value={Number(row.system_orders_count)}
              hasData={row.has_system_data}
            />
          </div>
        </div>

        {/* Insight box */}
        <InsightBox status={status} keyword={insight.keyword} message={insight.message} />
      </CardContent>
    </Card>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  )
}
