'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Banknote, RefreshCw, Wallet, TrendingDown, TrendingUp, AlertCircle } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
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
  if (!data) return null

  return (
    <Card className="bg-gradient-to-br from-violet-500/5 to-blue-500/5 border-violet-500/20">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-violet-500" />
            <h3 className="text-sm font-semibold">Saldo SPX &amp; Cashflow Bulan Ini</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={refreshing} className="h-7 px-2">
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Metric
            icon={<Wallet className="w-3.5 h-3.5 text-violet-500" />}
            label="Saldo terakhir"
            value={data.saldo_terakhir != null ? formatRupiah(Number(data.saldo_terakhir)) : '—'}
            valueClass="text-violet-600"
          />
          <Metric
            icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
            label="COD masuk bln ini"
            value={formatRupiah(Number(data.total_cod_bulan_ini))}
            valueClass="text-emerald-600"
          />
          <Metric
            icon={<TrendingDown className="w-3.5 h-3.5 text-blue-500" />}
            label="Ditarik bln ini"
            value={formatRupiah(Number(data.total_penarikan_bulan_ini))}
            valueClass="text-blue-600"
          />
        </div>

        <div className="border-t pt-2 space-y-1.5 text-xs">
          {data.last_withdrawal_date && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Banknote className="w-3 h-3" />
                <span>Penarikan terakhir</span>
              </div>
              <div className="font-medium tabular-nums">
                {(() => {
                  try { return format(parseISO(data.last_withdrawal_date), 'dd MMM', { locale: localeId }) }
                  catch { return data.last_withdrawal_date }
                })()}
                <span className="text-muted-foreground ml-1">·</span>
                <span className="ml-1">{formatRupiah(Number(data.last_withdrawal_amount || 0))}</span>
              </div>
            </div>
          )}
          {data.unsettled_count > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-amber-600">
                <AlertCircle className="w-3 h-3" />
                <span>Order belum cair</span>
              </div>
              <div className="font-medium tabular-nums">
                <span className="text-amber-600">{data.unsettled_count}</span>
                <span className="text-muted-foreground ml-1">order ·</span>
                <span className="ml-1">{formatRupiah(Number(data.unsettled_amount))}</span>
              </div>
            </div>
          )}
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
