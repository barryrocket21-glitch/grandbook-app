'use client'
// =============================================================
// FunnelInsightCards — top section quick-insight 3 cards
// di /analytics tab Funnel. Surfaces:
//   1. Top Performer (highest close rate, min 10 lead)
//   2. Need Attention (lowest ROAS dengan spend > 0)
//   3. Net Profit Periode (revenue total − spend total)
// =============================================================
import { Trophy, AlertTriangle, Coins } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatRupiah } from '@/lib/format'
import type { FunnelPerProductRow } from '@/lib/supabase/queries/analytics'

interface Props {
  rows: FunnelPerProductRow[]
}

export function FunnelInsightCards({ rows }: Props) {
  // Top Performer: highest close_rate_cs, filter min 10 lead untuk hilangkan noise
  const topPerformer = rows
    .filter(r => r.has_cs_data && Number(r.cs_lead_count) >= 10)
    .sort((a, b) => Number(b.close_rate_cs) - Number(a.close_rate_cs))[0]

  // Need Attention: lowest roas dengan spend > 0
  const needAttention = rows
    .filter(r => r.has_meta_data && Number(r.total_spend) > 0 && Number(r.roas_system) > 0)
    .sort((a, b) => Number(a.roas_system) - Number(b.roas_system))[0]

  // Net Profit: total revenue − total spend (simple, agregat semua produk)
  const totalRevenue = rows.reduce((s, r) => s + Number(r.system_revenue), 0)
  const totalSpend = rows.reduce((s, r) => s + Number(r.total_spend), 0)
  const netProfit = totalRevenue - totalSpend

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Top Performer */}
      <Card className="border-emerald-500/30">
        <CardContent className="pt-4 pb-4 flex items-start gap-3">
          <div className="p-2 bg-emerald-500/15 rounded-lg ring-1 ring-emerald-500/20 shrink-0">
            <Trophy className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Top Performer
            </p>
            {topPerformer ? (
              <>
                <p className="text-sm font-semibold truncate mt-0.5" title={topPerformer.product_name || ''}>
                  {topPerformer.product_name || `#${topPerformer.product_id}`}
                </p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 leading-none mt-1">
                  {Number(topPerformer.close_rate_cs).toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  close rate · {topPerformer.cs_closing_count}/{topPerformer.cs_lead_count} lead
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic mt-1">
                Belum ada produk dengan ≥10 lead di periode ini.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Need Attention */}
      <Card className="border-amber-500/30">
        <CardContent className="pt-4 pb-4 flex items-start gap-3">
          <div className="p-2 bg-amber-500/15 rounded-lg ring-1 ring-amber-500/20 shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Need Attention
            </p>
            {needAttention ? (
              <>
                <p className="text-sm font-semibold truncate mt-0.5" title={needAttention.product_name || ''}>
                  {needAttention.product_name || `#${needAttention.product_id}`}
                </p>
                <p className={`text-2xl font-bold leading-none mt-1 ${Number(needAttention.roas_system) < 1 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {Number(needAttention.roas_system).toFixed(2)}x
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  ROAS terendah · spend {formatRupiah(Number(needAttention.total_spend))}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic mt-1">
                Belum ada campaign dengan spend di periode ini.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Net Profit */}
      <Card className={netProfit >= 0 ? 'border-violet-500/30' : 'border-red-500/30'}>
        <CardContent className="pt-4 pb-4 flex items-start gap-3">
          <div className={`p-2 rounded-lg shrink-0 ring-1 ${netProfit >= 0 ? 'bg-violet-500/15 ring-violet-500/20' : 'bg-red-500/15 ring-red-500/20'}`}>
            <Coins className={`w-5 h-5 ${netProfit >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-red-600 dark:text-red-400'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Net Profit Periode
            </p>
            <p className={`text-2xl font-bold leading-none mt-2 ${netProfit >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatRupiah(netProfit)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              revenue {formatRupiah(totalRevenue)} − spend {formatRupiah(totalSpend)}
            </p>
            <p className="text-[9px] text-muted-foreground italic mt-0.5">
              simplified — belum include HPP/komisi/op expenses
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
