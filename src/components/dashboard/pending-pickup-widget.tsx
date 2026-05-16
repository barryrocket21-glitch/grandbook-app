'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Truck, ChevronRight, RefreshCw } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import type { PendingPickupSummary } from '@/lib/types'

const supabase = createClient()

const DAYS_THRESHOLD = 3
const REFRESH_INTERVAL_MS = 120_000 // 2 menit (sesuai brief)

/**
 * Phase 8B — Dashboard widget: ringkasan order yang resi-nya sudah dicetak
 * tapi belum di-pickup ekspedisi lewat threshold N hari.
 *
 * Visibility owner+admin (di-gate di caller dashboard page).
 * Refresh: on mount + tiap 2 menit + on window focus.
 */
export function PendingPickupWidget() {
  const [data, setData] = useState<PendingPickupSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const { data: rows, error } = await supabase.rpc('pending_pickup_summary', {
        p_days_threshold: DAYS_THRESHOLD,
      })
      if (error) throw error
      const first = Array.isArray(rows) ? rows[0] : rows
      setData(first ? {
        total_count: Number(first.total_count) || 0,
        total_value: Number(first.total_value) || 0,
        oldest_days_pending: Number(first.oldest_days_pending) || 0,
        by_channel: (first.by_channel as Record<string, { count: number; value: number }>) || {},
      } : null)
    } catch (err) {
      // Migration 034 belum di-apply → silently skip widget (jangan break dashboard)
      console.warn('pending_pickup_summary failed:', err)
      setData(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(() => load(true), REFRESH_INTERVAL_MS)
    const onFocus = () => load(true)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  if (loading) {
    return (
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="pt-4 pb-4">
          <div className="h-20 bg-muted/30 animate-pulse rounded" />
        </CardContent>
      </Card>
    )
  }

  // RPC error atau data null → tidak render widget (silent fail)
  if (!data) return null

  const count = data.total_count
  const totalValue = data.total_value
  const oldest = data.oldest_days_pending
  const byChannel = Object.entries(data.by_channel)

  const severityColor =
    count === 0
      ? 'border-emerald-500/20 bg-emerald-500/5'
      : oldest > 7
        ? 'border-red-500/30 bg-red-500/10'
        : 'border-amber-500/20 bg-amber-500/5'

  return (
    <Card className={severityColor}>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-base flex items-center gap-2">
            {count === 0 ? (
              <Truck className="w-4 h-4 text-emerald-500" />
            ) : (
              <AlertTriangle className={`w-4 h-4 ${oldest > 7 ? 'text-red-500' : 'text-amber-500'}`} />
            )}
            Resi Pending Pickup
            <span className="text-[10px] text-muted-foreground font-normal">
              (&gt; {DAYS_THRESHOLD} hari)
            </span>
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing}
            title="Refresh"
            className="h-7 px-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {count === 0 ? (
          <p className="text-sm text-muted-foreground">
            ✅ Tidak ada resi stuck. Semua order SIAP_KIRIM masih dalam threshold.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Order stuck" value={String(count)} />
              <Metric label="Total nilai" value={formatRupiah(totalValue)} />
              <Metric label="Paling lama" value={`${oldest.toFixed(1)} hari`} />
            </div>

            {byChannel.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-border/40">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Per Channel
                </p>
                <div className="space-y-1">
                  {byChannel.map(([channel, info]) => (
                    <div key={channel} className="flex items-center justify-between text-xs">
                      <Badge variant="outline" className="font-mono">{channel}</Badge>
                      <span className="text-muted-foreground">
                        {info.count} order · {formatRupiah(info.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Link href="/orders/list?stuck_pickup=true">
              <Button size="sm" variant="outline" className="w-full">
                Lihat Detail
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}
