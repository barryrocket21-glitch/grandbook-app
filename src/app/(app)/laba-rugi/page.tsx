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
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { Loader2, RefreshCw, Scale, AlertTriangle, Info } from 'lucide-react'
import { formatRupiah } from '@/lib/format'

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

  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  const load = useCallback(async () => {
    if (!canView || !rangeReady) return
    setLoading(true)
    try {
      const { data: rows, error } = await supabase.rpc('laba_rugi_summary', {
        p_from: range.from,
        p_to: range.to,
      })
      if (error) throw error
      setData((rows?.[0] ?? null) as LabaRugi | null)
    } catch (err) {
      console.warn('laba_rugi_summary failed:', err)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [canView, rangeReady, range.from, range.to])

  useEffect(() => { if (!authLoading) void load() }, [authLoading, load])

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
  const labaPositive = labaAct >= 0
  const noPeriodCost = data ? n(data.total_ad_spend) === 0 && n(data.total_opex) === 0 : false

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Scale}
        title="Laporan Laba Rugi"
        description="Gross Profit semua order − Biaya Iklan − Biaya Operasional = Laba Bersih."
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        }
      />

      {loading ? (
        <Card><CardContent className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></CardContent></Card>
      ) : !data ? (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">Gagal memuat data.</CardContent></Card>
      ) : (
        <>
          {/* Info banner — Realisasi vs Proyeksi (penting biar nggak ke-tukar konsepnya) */}
          <div className="text-xs bg-zinc-500/5 border border-zinc-500/20 rounded-lg p-3 flex gap-2 items-start">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-zinc-600" />
            <div className="space-y-1 text-muted-foreground">
              <div><strong className="text-foreground">Realisasi</strong> = laporan resmi (accrual basis, untuk pajak/audit). Cuma hitung yang udah terwujud: order Diterima penuh, Retur = rugi ongkir, lainnya 0.</div>
              <div><strong className="text-foreground">Proyeksi</strong> = forecast kalau semua order sukses. Buat planning &mdash; <em>BUKAN</em> laporan keuangan formal.</div>
            </div>
          </div>

          {/* Headline — Laba Bersih */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={`rounded-xl p-5 ring-1 ${labaPositive ? 'bg-emerald-500/10 ring-emerald-500/30' : 'bg-red-500/10 ring-red-500/30'}`}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Laba Bersih — Realisasi</div>
              <div className={`text-3xl font-bold mt-1 ${labaPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatRupiah(labaAct)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Dari {data.diterima_count} order Diterima (yang udah sampai)
              </div>
            </div>
            <div className="rounded-xl p-5 ring-1 bg-zinc-500/10 ring-zinc-500/30">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Laba Bersih — Proyeksi</div>
              <div className="text-3xl font-bold mt-1 text-zinc-600">{formatRupiah(n(data.laba_bersih_est))}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Forecast {data.order_count} order (kalau semua sukses sampai)
              </div>
            </div>
          </div>

          {/* Order breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label="Total Order" value={String(data.order_count)} tone="blue" />
            <Stat label="Diterima" value={String(data.diterima_count)} tone="emerald" />
            <Stat label="Retur" value={String(data.retur_count)} sub={`${n(data.retur_pct)}%`} tone="red" />
            <Stat label="Batal" value={String(data.batal_count)} tone="zinc" />
            <Stat label="Masih Jalan" value={String(data.inflight_count)} tone="amber" />
          </div>

          {/* P&L cascade */}
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
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
                  <PnlRow label="LABA BERSIH" est={n(data.laba_bersih_est)} act={n(data.laba_bersih_act)} kind="grand" />
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="text-[11px] text-muted-foreground space-y-1">
            <p>
              <strong>Proyeksi</strong> = forecast semua {data.order_count} order (seolah semua sukses sampai). Buat planning, bukan laporan resmi.{' '}
              <strong>Realisasi</strong> = laporan accrual basis: order Diterima dihitung penuh, Retur = rugi ongkir,
              Cancel/Fake = 0, order yang masih jalan belum dihitung. Inilah yang sah jadi Laporan Laba Rugi formal.
            </p>
            {noPeriodCost && (
              <p className="text-amber-600">
                ⚠️ Biaya Iklan &amp; Operasional masih Rp0 — input dulu di <strong>Marketing → Ad Spend</strong> dan{' '}
                <strong>Keuangan → Biaya Operasional</strong> biar Laba Bersih akurat.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: {
  label: string
  value: string
  sub?: string
  tone: 'blue' | 'emerald' | 'red' | 'amber' | 'zinc'
}) {
  const toneMap: Record<string, string> = {
    blue: 'text-zinc-600',
    emerald: 'text-emerald-600',
    red: 'text-red-600',
    amber: 'text-amber-600',
    zinc: 'text-zinc-500',
  }
  return (
    <div className="rounded-lg border p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${toneMap[tone]}`}>
        {value}
        {sub && <span className="text-xs font-normal text-muted-foreground ml-1">{sub}</span>}
      </div>
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
      <td className={`px-4 py-2 text-right ${valCls(est)}`}>{formatRupiah(est)}</td>
      <td className={`px-4 py-2 text-right ${valCls(act)}`}>{formatRupiah(act)}</td>
    </tr>
  )
}
