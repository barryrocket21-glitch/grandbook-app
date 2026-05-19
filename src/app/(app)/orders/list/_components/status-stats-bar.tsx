'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { STATUS_LABEL, STATUS_BADGE_COLOR } from '@/lib/schemas/settings'
import { cn } from '@/lib/utils'
import type { OrderStatus, OrderStatusStat } from '@/lib/types'

/**
 * Phase 8I-Followup Part 3 — Statistics bar di atas /orders/list.
 *
 * Card-style breakdown per status dengan count + percentage. Clickable untuk
 * set filter status (klik card → onStatusClick(status)). Klik "Total" → null
 * (clear filter status). Active state: ring violet untuk card yang lagi
 * di-filter.
 *
 * Stats source: RPC `get_orders_status_stats(p_from, p_to, p_search)` —
 * compute server-side berdasarkan filter date/search yang sama dengan
 * tabel, jadi stats reflect "scope yang user lihat" bukan whole org.
 *
 * Phase 8I-Followup Part 3.5 — Stacked horizontal bar di bawah cards row:
 * 1 bar dibagi proporsional per status (flex-basis), hover segment → tooltip
 * count + percentage, click segment → filter sama kayak card. Label visible
 * kalau pct >= 8%, hidden kalau lebih kecil supaya ga overflow.
 *
 * FAKE status hidden by default (low priority, jarang dipakai). Owner
 * masih bisa lihat lewat status filter dropdown manual.
 */

interface StatusStatsBarProps {
  stats: OrderStatusStat[]
  totalCount: number
  activeStatus: OrderStatus | 'ALL' | null
  onStatusClick: (status: OrderStatus | 'ALL') => void
  loading?: boolean
  /** Default true. Set false untuk hide stacked bar visualization. */
  showBar?: boolean
}

const HIDDEN_BY_DEFAULT: ReadonlySet<OrderStatus> = new Set(['FAKE'])

// Phase 8I-Followup Part 3.5 — solid Tailwind bg per status untuk stacked bar.
// Pakai shade 500 (lebih saturated dari card bg-*/10) supaya kontras text white.
const STATUS_BAR_BG: Record<OrderStatus, string> = {
  DITERIMA:   'bg-emerald-500',
  DIKIRIM:    'bg-purple-500',
  SIAP_KIRIM: 'bg-yellow-500',
  PROBLEM:    'bg-amber-500',
  RETUR:      'bg-orange-500',
  CANCEL:     'bg-zinc-400',
  BARU:       'bg-blue-500',
  FAKE:       'bg-red-500',
}

export function StatusStatsBar({
  stats,
  totalCount,
  activeStatus,
  onStatusClick,
  loading,
  showBar = true,
}: StatusStatsBarProps) {
  const totalActive = !activeStatus || activeStatus === 'ALL'

  const visibleStats = stats
    .filter((s) => !HIDDEN_BY_DEFAULT.has(s.status as OrderStatus))
    .filter((s) => Number(s.cnt) > 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-stretch gap-2">
        {/* Total card — always first */}
        <StatCard
          label="Total"
          cnt={totalCount}
          pct={null}
          color="bg-violet-500/10 text-violet-600 border-violet-500/30"
          active={totalActive}
          loading={loading}
          onClick={() => onStatusClick('ALL')}
        />

        {visibleStats.map((s) => {
          const st = s.status as OrderStatus
          return (
            <StatCard
              key={st}
              label={STATUS_LABEL[st] || st}
              cnt={Number(s.cnt)}
              pct={Number(s.pct)}
              color={STATUS_BADGE_COLOR[st] || 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'}
              active={!totalActive && activeStatus === st}
              loading={loading}
              onClick={() => onStatusClick(st)}
            />
          )
        })}
      </div>

      {/* Phase 8I-Followup Part 3.5 — Stacked horizontal bar visualization */}
      {showBar && visibleStats.length > 0 && (
        <div className="flex h-4 w-full overflow-hidden rounded-md border border-border bg-muted">
          {visibleStats.map((s) => {
            const st = s.status as OrderStatus
            const pct = Number(s.pct)
            const cnt = Number(s.cnt)
            const isActive = !totalActive && activeStatus === st
            return (
              <Tooltip key={st}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => onStatusClick(isActive ? 'ALL' : st)}
                      disabled={loading}
                      className={cn(
                        'flex items-center justify-center transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                        STATUS_BAR_BG[st] || 'bg-zinc-400',
                        isActive && 'ring-2 ring-inset ring-violet-700',
                        loading && 'animate-pulse cursor-wait',
                      )}
                      style={{ flexBasis: `${pct}%`, minWidth: '8px' }}
                      aria-label={`${STATUS_LABEL[st] || st}: ${cnt} order (${pct.toFixed(1)}%)`}
                    />
                  }
                />
                <TooltipContent>
                  <div className="text-xs">
                    <div className="font-medium">{STATUS_LABEL[st] || st}</div>
                    <div className="text-muted-foreground">
                      {cnt.toLocaleString('id-ID')} order · {pct.toFixed(1)}%
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  cnt,
  pct,
  color,
  active,
  loading,
  onClick,
}: {
  label: string
  cnt: number
  pct: number | null
  color: string
  active: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`group flex flex-col items-start min-w-[110px] rounded-md border px-3 py-2 transition-all
        ${color}
        ${active ? 'ring-2 ring-offset-1 ring-current shadow-sm' : 'opacity-90 hover:opacity-100 hover:shadow-sm'}
        ${loading ? 'animate-pulse cursor-wait' : 'cursor-pointer'}`}
    >
      <div className="flex items-baseline gap-1.5 w-full">
        <span className="text-xl font-bold tabular-nums leading-none">{cnt.toLocaleString('id-ID')}</span>
        {pct !== null && (
          <span className="text-[10px] text-current/70 tabular-nums">({pct.toFixed(1)}%)</span>
        )}
      </div>
      <div className="text-[10px] mt-1 uppercase tracking-wide font-medium text-current/80">{label}</div>
    </button>
  )
}
