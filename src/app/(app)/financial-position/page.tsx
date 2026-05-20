'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Wallet, Truck, Coins, RefreshCw, AlertTriangle, ArrowRight,
  Building2, Calendar, ExternalLink, Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah, formatDate, formatDateTime } from '@/lib/format'
import { SupplierPayableSheet } from './_components/supplier-payable-sheet'

const supabase = createClient()

interface FinancialPosition {
  saldo_spx: number
  saldo_spx_updated_at: string | null
  in_transit_cod: number
  in_transit_orders: number
  hpp_supplier_owed: number
  hpp_supplier_orders: number
  hpp_supplier_count: number
}

export default function FinancialPositionPage() {
  const { role } = useAuth()
  const [position, setPosition] = useState<FinancialPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const { data, error } = await supabase.rpc('get_financial_position')
      if (error) throw error
      if (data && data[0]) setPosition(data[0] as FinancialPosition)
    } catch (err) {
      console.warn('get_financial_position failed:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Page-level gate (RLS already enforces but UI feedback faster)
  const allowed = role === 'owner' || role === 'admin' || role === 'akunting'
  if (!allowed && role) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Wallet} title="Posisi Keuangan" />
        <Card className="max-w-md mx-auto mt-8">
          <CardContent className="pt-6 text-center space-y-2">
            <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
            <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
            <p className="text-sm text-muted-foreground">Hanya owner, admin, atau akunting yang bisa lihat posisi keuangan.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const totalAssets = position ? Number(position.saldo_spx) + Number(position.in_transit_cod) : 0
  const netPosition = position ? totalAssets - Number(position.hpp_supplier_owed) : 0

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="Posisi Keuangan"
        description="Snapshot &quot;duit gw ada di mana&quot; — saldo SPX, in-transit COD, HPP terutang ke supplier."
        actions={
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {/* Net position banner */}
      <Card className="bg-gradient-to-r from-violet-500/10 via-indigo-500/10 to-violet-500/10 border-violet-500/30">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Posisi bersih (assets − HPP terutang)</div>
              <div className={`text-3xl font-bold tabular-nums ${netPosition >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {loading ? '...' : formatRupiah(netPosition)}
              </div>
            </div>
            <div className="text-right text-xs space-y-0.5">
              <div className="text-muted-foreground">Total assets: <span className="text-foreground font-semibold tabular-nums">{loading ? '...' : formatRupiah(totalAssets)}</span></div>
              <div className="text-muted-foreground">HPP terutang: <span className="text-orange-600 font-semibold tabular-nums">{loading ? '...' : formatRupiah(position?.hpp_supplier_owed || 0)}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3 Bucket cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Saldo SPX */}
        <Card className="border-emerald-500/30">
          <CardContent className="pt-5 pb-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Saldo SPX</div>
                  <div className="text-[10px] text-muted-foreground">Yang bisa di-withdraw</div>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">Asset</Badge>
            </div>
            <div className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {loading ? '...' : formatRupiah(position?.saldo_spx || 0)}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {position?.saldo_spx_updated_at
                ? `Update terakhir: ${formatDateTime(position.saldo_spx_updated_at)}`
                : 'Belum ada withdrawal history'}
            </div>
            <Link href="/reconciliation/spx-cashflow" className="text-xs text-emerald-600 hover:underline flex items-center gap-1 mt-1">
              Detail cashflow SPX <ExternalLink className="w-3 h-3" />
            </Link>
          </CardContent>
        </Card>

        {/* In-transit COD */}
        <Card className="border-blue-500/30">
          <CardContent className="pt-5 pb-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Truck className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">In-transit COD</div>
                  <div className="text-[10px] text-muted-foreground">Cetak resi, belum settle</div>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-500/30">Asset (lock)</Badge>
            </div>
            <div className="text-2xl font-bold tabular-nums text-blue-700 dark:text-blue-400">
              {loading ? '...' : formatRupiah(position?.in_transit_cod || 0)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {position?.in_transit_orders || 0} order status <code>SIAP_KIRIM</code> / <code>DIKIRIM</code>
            </div>
            <Link href="/orders/list?status=SIAP_KIRIM" className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1">
              Detail order in-transit <ExternalLink className="w-3 h-3" />
            </Link>
          </CardContent>
        </Card>

        {/* HPP terutang supplier */}
        <Card className="border-orange-500/30">
          <CardContent className="pt-5 pb-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Coins className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">HPP Terutang</div>
                  <div className="text-[10px] text-muted-foreground">Ke supplier (dropship)</div>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] text-orange-600 border-orange-500/30">Liability</Badge>
            </div>
            <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-400">
              {loading ? '...' : formatRupiah(position?.hpp_supplier_owed || 0)}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-2">
              <Building2 className="w-3 h-3" />
              {position?.hpp_supplier_count || 0} supplier · {position?.hpp_supplier_orders || 0} order pending
            </div>
            <button
              onClick={() => setSupplierSheetOpen(true)}
              className="text-xs text-orange-600 hover:underline flex items-center gap-1 mt-1"
            >
              Detail per supplier <ArrowRight className="w-3 h-3" />
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Info panel */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4 pb-4 text-xs text-muted-foreground space-y-1.5">
          <div className="font-semibold text-foreground mb-1">Cara baca:</div>
          <div>• <strong>Posisi bersih</strong> = Saldo SPX + In-transit COD − HPP terutang ke supplier. Estimasi cash position kalau semua COD settle hari ini.</div>
          <div>• <strong>Saldo SPX</strong> dari withdrawal terakhir (Phase 8I-v2). Update tiap kali Barry rekonsil cashflow SPX harian.</div>
          <div>• <strong>In-transit COD</strong> nilai gross. Ongkir + biaya kurir belum dikurangi (lihat /reconciliation/spx-cashflow untuk net).</div>
          <div>• <strong>HPP terutang</strong> snapshot per order × supplier saat status → DIKIRIM. Mark as paid lewat &quot;Detail per supplier&quot;.</div>
        </CardContent>
      </Card>

      <SupplierPayableSheet
        open={supplierSheetOpen}
        onOpenChange={setSupplierSheetOpen}
        onChanged={() => load(true)}
      />
    </div>
  )
}
