'use client'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Truck, ChevronRight, RefreshCw } from 'lucide-react'
import { formatRupiah } from '@/lib/format'

import { useAuth } from '@/components/providers/auth-provider'
import { useDashboardRead } from '@/lib/dashboard/use-dashboard-read'
import { readPickup } from '@/lib/dashboard/read'

const supabase = createClient()
const loadPickup = (signal: AbortSignal) => readPickup(supabase, signal)

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
  const { user, profile, role, loading: authLoading } = useAuth()
  const key = !authLoading && user?.id === profile?.id && (role === 'owner' || role === 'admin')
    ? user!.id + ':' + profile?.organization_id + ':' + role : null
  const { data, loading, error, refresh } = useDashboardRead(key, loadPickup, REFRESH_INTERVAL_MS)
  const refreshing = loading
  if (key === null) return null

  if (loading) {
    return (
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="pt-4 pb-4">
          <div className="h-20 bg-muted/30 animate-pulse rounded" />
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return <Card role="alert"><CardContent className="pt-4 pb-4 space-y-2">
      <p className="text-sm">Data pickup belum terbaca lengkap.</p>
      <Button variant="outline" size="sm" onClick={() => void refresh()}>Coba lagi</Button>
    </CardContent></Card>
  }

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
            onClick={() => void refresh()}
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
            <div className="grid grid-cols-1 gap-3">
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
                    <div key={channel} className="flex flex-wrap items-center justify-between gap-2 text-xs">
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
