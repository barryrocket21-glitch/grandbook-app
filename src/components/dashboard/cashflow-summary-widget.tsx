'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, Wallet, AlertCircle } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import type { CashflowSummary } from '@/lib/types'

const supabase = createClient()

/**
 * Phase 8I-v2 — Dashboard widget: Saldo SPX & Cashflow Bulan Ini.
 *
 * Data via RPC `get_cashflow_summary()` (silent fail kalau migration 048 belum apply).
 * Refresh on mount + manual button.
 */
export function CashflowSummaryWidget() {
  const [data, setData] = useState<CashflowSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [payout, setPayout] = useState<{ cair_total: number; cair_count: number; uncair_total: number; uncair_count: number } | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [{ data: rows, error }, { data: pay }] = await Promise.all([
        supabase.rpc('get_cashflow_summary'),
        supabase.rpc('get_payout_position'),
      ])
      if (error) throw error
      const first = Array.isArray(rows) ? rows[0] : rows
      setData(first as CashflowSummary | null)
      setPayout((Array.isArray(pay) ? pay[0] : pay) ?? null)
    } catch (err) {
      console.warn('get_cashflow_summary failed:', err)
      setData(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-zinc-500/5 to-zinc-500/5 border-zinc-500/20">
        <CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground">Memuat saldo SPX...</div>
        </CardContent>
      </Card>
    )
  }
  // Brief #16 PART 3 — angka cair/payout belum bisa dihitung sampai sub-brief
  // rekonsiliasi payout SPX jalan. JANGAN nampilin 0 misleading seakan udah cair.
  // Saldo real (bank_withdrawals) tetap ditampilin kalau ada; sisanya placeholder.
  const hasSaldo = !!data && data.saldo_terakhir != null

  return (
    <Card className="bg-gradient-to-br from-zinc-500/5 to-zinc-500/5 border-zinc-500/20">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold">Saldo SPX &amp; Cashflow</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={refreshing} className="h-7 px-2">
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Sub-brief #17 — angka cair real dari payout recon */}
        <div className="grid grid-cols-3 gap-3">
          <Metric icon={<Wallet className="w-3.5 h-3.5 text-emerald-500" />} label="COD sudah cair"
            value={formatRupiah(Number(payout?.cair_total ?? 0))} valueClass="text-emerald-600" />
          <Metric icon={<AlertCircle className="w-3.5 h-3.5 text-amber-500" />} label="Belum cair (delivered)"
            value={formatRupiah(Number(payout?.uncair_total ?? 0))} valueClass="text-amber-600" />
          <Metric icon={<Wallet className="w-3.5 h-3.5 text-zinc-500" />} label="Saldo terakhir"
            value={hasSaldo ? formatRupiah(Number(data!.saldo_terakhir)) : '—'} valueClass="text-zinc-600" />
        </div>
        <p className="text-[10px] text-muted-foreground">{Number(payout?.uncair_count ?? 0)} order delivered belum cair · update via <a href="/reconciliation/ekspedisi" className="text-zinc-500 hover:underline">Rekonsiliasi Ekspedisi</a>.</p>
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
