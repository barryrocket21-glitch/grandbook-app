'use client'
// =============================================================
// Laporan Laba Rugi bulanan (Step 3 pembukuan).
// P&L cascade: Total Penjualan → Omset → Gross Profit → Laba Bersih.
// Dua kolom:
//   - REALISASI = laporan resmi accrual basis (untuk pajak/audit).
//     Hanya hitung yang terwujud: Diterima penuh, Retur = rugi ongkir,
//     Cancel/Fake = 0, masih jalan = belum dihitung.
//   - PROYEKSI = forecast kalau semua order sukses. Buat planning,
//     BUKAN laporan formal.
// Internal field names (est_*, act_*) di-keep untuk backward compat dengan
// RPC laba_rugi_summary — cuma label UI yang di-rename.
// =============================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { Loader2, RefreshCw, Scale, AlertTriangle, Info } from 'lucide-react'
import { formatRupiah, formatNumber } from '@/lib/format'
import { getErrorMessage } from '@/lib/errors'

const supabase = createClient()

interface LabaRugi {
  order_count: number
  diterima_count: number
  retur_count: number
  batal_count: number
  inflight_count: number
  retur_pct: number
  est_penjualan: number
  est_selisih_ongkir: number
  est_fee_admin: number
  est_omset: number
  est_hpp: number
  est_fee_cs: number
  est_gross_profit: number
  act_penjualan: number
  act_selisih_ongkir: number
  act_fee_admin: number
  act_omset: number
  act_hpp: number
  act_fee_cs: number
  act_gross_profit: number
  total_ad_spend: number
  total_opex: number
  laba_bersih_est: number
  laba_bersih_act: number
}

const n = (v: unknown) => Number(v) || 0

export default function LabaRugiPage() {
  const { role, loading: authLoading } = useAuth()
  const canView = role === 'owner' || role === 'admin' || role === 'akunting'

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [data, setData] = useState<LabaRugi | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => { setRange(thisMonth()); setRangeReady(true) }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const load = useCallback(async () => {
    if (!canView || !rangeReady) return
    const id = ++requestId.current
    setLoading(true)
    setErrorMessage(null)
    try {
      const { data: rows, error } = await supabase.rpc('laba_rugi_summary', {
        p_from: range.from,
        p_to: range.to,
      })
      if (error) throw error
      if (id !== requestId.current) return
      if (!Array.isArray(rows) || !rows[0]) throw new Error('Laporan belum tersedia. Silakan coba lagi.')
      setData(rows[0] as LabaRugi)
    } catch (err) {
      if (id !== requestId.current) return
      console.warn('laba_rugi_summary failed:', err)
      setData(null)
      const timedOut = err != null && typeof err === 'object' && 'code' in err && err.code === '57014'
      setErrorMessage(timedOut ? 'Laporan membutuhkan waktu terlalu lama. Coba muat ulang atau pilih periode yang lebih singkat.' : getErrorMessage(err))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [canView, rangeReady, range.from, range.to])

  useEffect(() => {
    const timer = window.setTimeout(() => { if (!authLoading) void load() }, 0)
    return () => { window.clearTimeout(timer); requestId.current += 1 }
  }, [authLoading, load])

  if (authLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>
  }
  if (!canView) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">
            Laporan Laba Rugi hanya untuk owner, admin, atau akunting.
          </p>
        </CardContent>
      </Card>
    )
  }

  const labaAct = data ? n(data.laba_bersih_act) : 0
  const noPeriodCost = data ? n(data.total_ad_spend) === 0 && n(data.total_opex) === 0 : false

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={Scale}
        title="Laporan Laba Rugi"
        description="Ringkasan pendapatan, HPP, dan biaya yang tercatat untuk periode pilihan."
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button variant="outline" size="sm" aria-label="Muat ulang Laba Rugi" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        }
      />

      {loading ? (
        <Card><CardContent role="status" aria-label="Memuat laporan Laba Rugi" className="p-12 text-center"><Loader2 aria-hidden="true" className="size-6 animate-spin mx-auto" /></CardContent></Card>
      ) : !data ? (
        <Card role="alert">
          <CardHeader>
            <CardTitle>Laporan belum berhasil dimuat</CardTitle>
            <CardDescription>{errorMessage || 'Silakan muat ulang laporan.'}</CardDescription>
          </CardHeader>
          <CardContent><Button variant="outline" onClick={() => void load()}>Coba lagi</Button></CardContent>
        </Card>
      ) : (
        <>
          {/* Info banner — Realisasi vs Proyeksi (penting biar nggak ke-tukar konsepnya) */}
          <div className="text-xs bg-zinc-500/5 border border-zinc-500/20 rounded-lg p-3 flex gap-2 items-start">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-zinc-600" />
            <div className="space-y-1 text-muted-foreground">
              <div><strong className="text-foreground">Realisasi</strong> menghitung order diterima dan kerugian ongkir retur dari data yang tersedia. Lengkapi biaya dan rekonsiliasi sebelum memakai hasilnya sebagai laba bersih final.</div>
              <div><strong className="text-foreground">Proyeksi</strong> = forecast kalau semua order sukses. Buat planning &mdash; <em>BUKAN</em> laporan keuangan formal.</div>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard label="Laba setelah biaya tercatat · Realisasi" value={formatRupiah(labaAct)} sub={`${formatNumber(n(data.diterima_count))} order diterima`} tone={labaAct < 0 ? 'red' : 'default'} size="lg" />
            <StatCard label="Laba setelah biaya tercatat · Proyeksi" value={formatRupiah(n(data.laba_bersih_est))} sub={`${formatNumber(n(data.order_count))} order, jika semua berhasil diterima`} size="lg" />
          </div>

          {/* Order breakdown */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
            <StatCard label="Total Order" value={n(data.order_count)} tone="zinc" />
            <StatCard label="Diterima" value={n(data.diterima_count)} tone="emerald" />
            <StatCard label="Retur" value={n(data.retur_count)} sub={`${formatNumber(n(data.retur_pct), 2)}%`} tone="red" />
            <StatCard label="Batal" value={n(data.batal_count)} tone="zinc" />
            <StatCard label="Masih Jalan" value={n(data.inflight_count)} tone="amber" />
          </div>

          {/* P&L cascade */}
          <Card>
            <CardContent className="min-w-0 max-w-full overflow-x-auto p-0" role="region" aria-label="Rincian laporan Laba Rugi" tabIndex={0}>
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-medium px-4 py-2.5">Komponen</th>
                    <th className="text-right font-medium px-4 py-2.5 w-44">Proyeksi</th>
                    <th className="text-right font-medium px-4 py-2.5 w-44">Realisasi</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <PnlRow label="Penjualan (harga barang)" est={n(data.est_penjualan)} act={n(data.act_penjualan)} />
                  <PnlRow label="(+) Selisih Ongkir (untung ongkir: cashback + markup/diskon)" est={n(data.est_selisih_ongkir)} act={n(data.act_selisih_ongkir)} />
                  <PnlRow label="Biaya Admin (Fee COD + PPN)" est={n(data.est_fee_admin)} act={n(data.act_fee_admin)} kind="minus" />
                  <PnlRow label="Omset" est={n(data.est_omset)} act={n(data.act_omset)} kind="subtotal" />
                  <PnlRow label="HPP (modal barang)" est={n(data.est_hpp)} act={n(data.act_hpp)} kind="minus" />
                  <PnlRow label="Fee CS" est={n(data.est_fee_cs)} act={n(data.act_fee_cs)} kind="minus" />
                  <PnlRow label="Gross Profit" est={n(data.est_gross_profit)} act={n(data.act_gross_profit)} kind="subtotal" />
                  <PnlRow label="Biaya Iklan" est={n(data.total_ad_spend)} act={n(data.total_ad_spend)} kind="minus" />
                  <PnlRow label="Biaya Operasional" est={n(data.total_opex)} act={n(data.total_opex)} kind="minus" />
                  <PnlRow label="Laba setelah biaya tercatat" est={n(data.laba_bersih_est)} act={n(data.laba_bersih_act)} kind="grand" />
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="text-[11px] text-muted-foreground space-y-1">
            <p>
              <strong>Proyeksi</strong> = forecast semua {formatNumber(n(data.order_count))} order (seolah semua sukses sampai). Buat planning, bukan laporan resmi.{' '}
              <strong>Realisasi</strong> = laporan accrual basis: order Diterima dihitung penuh, Retur = rugi ongkir,
              Cancel/Fake = 0, order yang masih jalan belum dihitung. Hasil mengikuti kelengkapan biaya yang sudah dicatat.
            </p>
            {noPeriodCost && (
              <p className="text-amber-600">
                ⚠️ Biaya Iklan &amp; Operasional masih Rp0 — input dulu di <strong>Iklan &amp; Campaign → Input Spend Iklan</strong> dan{' '}
                <strong>Pembukuan → Biaya &amp; Gaji</strong> biar Laba Bersih akurat.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}


function PnlRow({ label, est, act, kind }: {
  label: string
  est: number
  act: number
  kind?: 'minus' | 'subtotal' | 'grand'
}) {
  const isGrand = kind === 'grand'
  const isSub = kind === 'subtotal'
  const isMinus = kind === 'minus'

  const rowCls = isGrand
    ? 'border-t-2 border-foreground/25'
    : isSub
      ? 'border-t border-border bg-muted/40'
      : 'border-t border-border/40'

  const valCls = (v: number) => {
    if (isGrand) return `font-bold text-[15px] ${v >= 0 ? 'text-emerald-600' : 'text-red-600'}`
    if (isSub) return 'font-semibold'
    return ''
  }

  return (
    <tr className={rowCls}>
      <td className={`px-4 py-2 ${isGrand ? 'font-bold text-[15px]' : isSub ? 'font-semibold' : ''}`}>
        {isMinus ? '(−) ' : ''}{label}
      </td>
      <td className={`px-4 py-2 text-right whitespace-nowrap ${valCls(est)}`}>{formatRupiah(est)}</td>
      <td className={`px-4 py-2 text-right whitespace-nowrap ${valCls(act)}`}>{formatRupiah(act)}</td>
    </tr>
  )
}
