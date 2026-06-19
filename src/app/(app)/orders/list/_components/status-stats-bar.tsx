'use client'

import { STATUS_LABEL, STATUS_BADGE_COLOR } from '@/lib/schemas/settings'
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
 * Phase 8I-Followup Part 4F — Stacked horizontal bar (Part 3.5) REVERTED.
 * Visual redundant dengan color-coded cards, ga menambah informasi.
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
}

const HIDDEN_BY_DEFAULT: ReadonlySet<OrderStatus> = new Set(['FAKE'])

export function StatusStatsBar({
  stats,
  totalCount,
  activeStatus,
  onStatusClick,
  loading,
}: StatusStatsBarProps) {
  const totalActive = !activeStatus || activeStatus === 'ALL'

  const visibleStats = stats
    .filter((s) => !HIDDEN_BY_DEFAULT.has(s.status as OrderStatus))
    .filter((s) => Number(s.cnt) > 0)

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {/* Total card — always first */}
      <StatCard
        label="Total"
        cnt={totalCount}
        pct={null}
        color="bg-zinc-500/10 text-zinc-600 border-zinc-500/30"
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
