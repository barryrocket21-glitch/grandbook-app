'use client'

import { STATUS_LABEL, STATUS_BADGE_COLOR } from '@/lib/schemas/settings'
import type { OrderStatus } from '@/lib/types'

export type DraftStatus = 'BARU' | 'SIAP_KIRIM' | 'PROBLEM' | 'CANCEL'

export interface DraftStatusStat {
  status: DraftStatus
  cnt: number
  pct: number
}

interface DraftStatusStatsBarProps {
  stats: DraftStatusStat[]
  totalCount: number
  activeStatus: DraftStatus | 'ALL' | null
  onStatusClick: (status: DraftStatus | 'ALL') => void
  loading?: boolean
  /**
   * Brief #7 — jumlah order yang alamatnya belum ke-resolve (wilayah_id NULL).
   * Dipajang di kartu SIAP_KIRIM biar gak kebaca "100% beres" padahal sebagian
   * belum siap export. Status = tahap kerja; ini = kesiapan export (beda hal).
   */
  notReady?: number
}

const DRAFT_STATUSES: DraftStatus[] = ['BARU', 'SIAP_KIRIM', 'PROBLEM', 'CANCEL']

export function DraftStatusStatsBar({
  stats,
  totalCount,
  activeStatus,
  onStatusClick,
  loading,
  notReady = 0,
}: DraftStatusStatsBarProps) {
  const totalActive = !activeStatus || activeStatus === 'ALL'
  const statsByStatus = new Map(stats.map((s) => [s.status, s]))

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <StatCard
        label="Total"
        cnt={totalCount}
        pct={null}
        color="bg-violet-500/10 text-violet-600 border-violet-500/30"
        active={totalActive}
        loading={loading}
        onClick={() => onStatusClick('ALL')}
      />
      {DRAFT_STATUSES.map((st) => {
        const s = statsByStatus.get(st)
        const cnt = s ? Number(s.cnt) : 0
        const pct = s ? Number(s.pct) : 0
        return (
          <StatCard
            key={st}
            label={STATUS_LABEL[st as OrderStatus] || st}
            cnt={cnt}
            pct={pct}
            color={STATUS_BADGE_COLOR[st as OrderStatus] || 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'}
            active={!totalActive && activeStatus === st}
            loading={loading}
            onClick={() => onStatusClick(st)}
            warn={st === 'SIAP_KIRIM' && notReady > 0 ? notReady : undefined}
          />
        )
      })}
    </div>
  )
}

function StatCard({
  label, cnt, pct, color, active, loading, onClick, warn,
}: {
  label: string
  cnt: number
  pct: number | null
  color: string
  active: boolean
  loading?: boolean
  onClick: () => void
  warn?: number
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
        {/* pct disembunyiin kalau ada warn — biar gak kebaca "100% beres" */}
        {pct !== null && cnt > 0 && warn === undefined && (
          <span className="text-[10px] text-current/70 tabular-nums">({pct.toFixed(1)}%)</span>
        )}
      </div>
      <div className="text-[10px] mt-1 uppercase tracking-wide font-medium text-current/80">{label}</div>
      {warn !== undefined && (
        <div className="mt-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold bg-orange-500/15 text-orange-700 dark:text-orange-300 normal-case tracking-normal">
          ⚠️ {warn.toLocaleString('id-ID')} belum siap export
        </div>
      )}
    </button>
  )
}
