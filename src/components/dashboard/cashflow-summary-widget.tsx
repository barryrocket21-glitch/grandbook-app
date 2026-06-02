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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const { data: rows, error } = await supabase.rpc('get_cashflow_summary')
      if (error) throw error
      const first = Array.isArray(rows) ? rows[0] : rows
      setData(first as CashflowSummary | null)
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
      <Card className="bg-gradient-to-br from-violet-500/5 to-blue-500/5 border-violet-500/20">
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
    <Card className="bg-gradient-to-br from-violet-500/5 to-blue-500/5 border-violet-500/20">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-violet-500" />
            <h3 className="text-sm font-semibold">Saldo SPX &amp; Cashflow</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={refreshing} className="h-7 px-2">
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {hasSaldo && (
          <Metric
            icon={<Wallet className="w-3.5 h-3.5 text-violet-500" />}
            label="Saldo terakhir (bank_withdrawals)"
            value={formatRupiah(Number(data!.saldo_terakhir))}
            valueClass="text-violet-600"
          />
        )}

        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
            <b>Cashflow cair belum tersedia.</b> COD masuk / ditarik / belum cair nunggu <b>rekonsiliasi payout SPX</b> (sub-brief). Angka cair gak ditampilin dulu biar gak misleading.
          </div>
        </div>
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
