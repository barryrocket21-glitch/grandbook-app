'use client'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, Wallet, AlertCircle } from 'lucide-react'
import { formatRupiah } from '@/lib/format'

import { useAuth } from '@/components/providers/auth-provider'
import { useDashboardRead } from '@/lib/dashboard/use-dashboard-read'
import { readCashflow } from '@/lib/dashboard/read'

const supabase = createClient()
const loadCashflow = (signal: AbortSignal) => readCashflow(supabase, signal)

/**
 * Phase 8I-v2 — Dashboard widget: Saldo SPX & Cashflow Bulan Ini.
 *
 * Data via RPC `get_cashflow_summary()` (explicit error and retry on unavailable reads).
 * Refresh on mount + manual button.
 */
export function CashflowSummaryWidget() {
  const { user, profile, role, loading: authLoading } = useAuth()
  const key = !authLoading && user?.id === profile?.id && (role === 'owner' || role === 'admin' || role === 'akunting')
    ? user!.id + ':' + profile?.organization_id + ':' + role : null
  const { data, loading, error, refresh } = useDashboardRead(key, loadCashflow)
  const refreshing = loading
  if (key === null) return null

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-zinc-500/5 to-zinc-500/5 border-zinc-500/20">
        <CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground">Memuat saldo SPX...</div>
        </CardContent>
      </Card>
    )
  }
  if (error || !data) {
    return <Card role="alert"><CardContent className="pt-4 pb-4 space-y-2">
      <p className="text-sm">Data saldo dan pencairan belum terbaca lengkap.</p>
      <Button variant="outline" size="sm" onClick={() => void refresh()}>Coba lagi</Button>
    </CardContent></Card>
  }
  // Stored payout position is separate from the latest recorded withdrawal balance.
  const payout = data.payout
  const hasSaldo = !!data && data.saldo_terakhir != null

  return (
    <Card className="bg-gradient-to-br from-zinc-500/5 to-zinc-500/5 border-zinc-500/20">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold">Saldo SPX &amp; Cashflow</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing} className="h-7 px-2">
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Sub-brief #17 — angka cair real dari payout recon */}
        <div className="grid grid-cols-3 gap-3">
          <Metric icon={<Wallet className="w-3.5 h-3.5 text-emerald-500" />} label="COD tercatat cair"
            value={payout ? formatRupiah(Number(payout.cair_total)) : '—'} valueClass="text-emerald-600" />
          <Metric icon={<AlertCircle className="w-3.5 h-3.5 text-amber-500" />} label="Belum cair (delivered)"
            value={payout ? formatRupiah(Number(payout.uncair_total)) : '—'} valueClass="text-amber-600" />
          <Metric icon={<Wallet className="w-3.5 h-3.5 text-zinc-500" />} label="Saldo saat penarikan terakhir"
            value={hasSaldo ? formatRupiah(Number(data!.saldo_terakhir)) : '—'} valueClass="text-zinc-600" />
        </div>
        {payout && <p className="text-[10px] text-muted-foreground">{Number(payout?.uncair_count ?? 0)} order delivered belum cair · termasuk pencairan draft tercatat; bukan verifikasi saldo bank · update via <a href="/reconciliation/spx-cashflow" className="text-zinc-500 hover:underline">Rekonsiliasi Ekspedisi</a>.</p>}
        {!payout && <p className="text-xs text-muted-foreground">Data pencairan belum tersedia.</p>}
      </CardContent>
    </Card>
  )
}

function Metric({
  icon, label, value, valueClass,
}: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-sm font-bold tabular-nums mt-1 ${valueClass || ''}`}>{value}</div>
    </div>
  )
}
