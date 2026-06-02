'use client'
// =============================================================
// Posisi Keuangan — peta cashflow COD "duit gw ada di mana".
// Aset COD: di perjalanan (pipeline) + di SPX (DITERIMA, belum ditarik).
// Utang: HPP supplier + ongkir SPX + komisi tim.
// Posisi Bersih = Total Aset − Total Utang. Data: RPC get_financial_position.
// =============================================================
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Wallet, Truck, Banknote, Coins, Receipt, Users,
  RefreshCw, AlertTriangle, ArrowRight, ExternalLink, Loader2, Building2,
} from 'lucide-react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah } from '@/lib/format'
import { SupplierPayableSheet } from './_components/supplier-payable-sheet'

const supabase = createClient()

interface FinancialPosition {
  in_transit_cod: number
  in_transit_orders: number
  cod_at_spx: number
  cod_at_spx_orders: number
  total_withdrawn: number
  withdrawal_count: number
  last_withdrawal_at: string | null
  hpp_supplier_owed: number
  hpp_supplier_orders: number
  hpp_supplier_count: number
  ongkir_spx_owed: number
  ongkir_spx_orders: number
  komisi_owed: number
  komisi_count: number
}

const n = (v: unknown) => Number(v) || 0

// Sub-brief #17 — posisi cair/belum-cair + aging (RPC get_payout_position).
interface PayoutPosition {
  cair_total: number; cair_count: number; uncair_total: number; uncair_count: number
  aging_0_7_count: number; aging_0_7_amount: number
  aging_8_14_count: number; aging_8_14_amount: number
  aging_15plus_count: number; aging_15plus_amount: number
  komisi_paid: number; komisi_earned: number
}

function AgingBucket({ label, tone, count, amount }: { label: string; tone: string; count: number; amount: number }) {
  return (
    <div className="rounded border bg-card p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${tone}`}>{formatRupiah(amount)}</div>
      <div className="text-[10px] text-muted-foreground">{count} order</div>
    </div>
  )
}

type Tone = 'blue' | 'emerald' | 'orange' | 'amber' | 'rose'

const TONE: Record<Tone, { border: string; iconBg: string; icon: string; amount: string }> = {
  blue:    { border: 'border-blue-500/30',    iconBg: 'bg-blue-500/10',    icon: 'text-blue-600',    amount: 'text-blue-700 dark:text-blue-400' },
  emerald: { border: 'border-emerald-500/30', iconBg: 'bg-emerald-500/10', icon: 'text-emerald-600', amount: 'text-emerald-700 dark:text-emerald-400' },
  orange:  { border: 'border-orange-500/30',  iconBg: 'bg-orange-500/10',  icon: 'text-orange-600',  amount: 'text-orange-700 dark:text-orange-400' },
  amber:   { border: 'border-amber-500/30',   iconBg: 'bg-amber-500/10',   icon: 'text-amber-600',   amount: 'text-amber-700 dark:text-amber-400' },
  rose:    { border: 'border-rose-500/30',    iconBg: 'bg-rose-500/10',    icon: 'text-rose-600',    amount: 'text-rose-700 dark:text-rose-400' },
}

export default function FinancialPositionPage() {
  const { role } = useAuth()
  const [position, setPosition] = useState<FinancialPosition | null>(null)
  const [payout, setPayout] = useState<PayoutPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const [{ data, error }, { data: pay }] = await Promise.all([
        supabase.rpc('get_financial_position'),
        supabase.rpc('get_payout_position'),
      ])
      if (error) throw error
      setPosition((data?.[0] ?? null) as FinancialPosition | null)
      setPayout((pay?.[0] ?? null) as PayoutPosition | null)
    } catch (err) {
      console.warn('get_financial_position failed:', err)
      setPosition(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const allowed = role === 'owner' || role === 'admin' || role === 'akunting'
  if (role && !allowed) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Wallet} title="Posisi Keuangan" />
        <Card className="max-w-md mx-auto mt-8">
          <CardContent className="pt-6 text-center space-y-2">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
            <p className="text-sm text-muted-foreground">
              Hanya owner, admin, atau akunting yang bisa lihat posisi keuangan.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const p = position
  const totalAset = p ? n(p.in_transit_cod) + n(p.cod_at_spx) : 0
  const totalUtang = p ? n(p.hpp_supplier_owed) + n(p.ongkir_spx_owed) + n(p.komisi_owed) : 0
  const posisiBersih = totalAset - totalUtang
  const positif = posisiBersih >= 0

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="Posisi Keuangan"
        description="Peta duit COD — di perjalanan, di SPX, vs utang ke supplier &amp; ekspedisi."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {loading ? (
        <Card><CardContent className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></CardContent></Card>
      ) : !p ? (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">Gagal memuat posisi keuangan.</CardContent></Card>
      ) : (
        <>
          {/* Sub-brief #17 — Pencairan COD (cair vs belum cair) + aging */}
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="pt-5 pb-5 space-y-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Pencairan COD (dari payout SPX)</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground">Sudah Cair</div>
                  <div className="text-xl font-bold tabular-nums text-emerald-600">{formatRupiah(n(payout?.cair_total))}</div>
                  <div className="text-[10px] text-muted-foreground">{n(payout?.cair_count)} order</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Belum Cair (delivered)</div>
                  <div className="text-xl font-bold tabular-nums text-amber-600">{formatRupiah(n(payout?.uncair_total))}</div>
                  <div className="text-[10px] text-muted-foreground">{n(payout?.uncair_count)} order</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Komisi Dibayar (PAID)</div>
                  <div className="text-xl font-bold tabular-nums text-emerald-600">{formatRupiah(n(payout?.komisi_paid))}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Komisi Terutang (EARNED)</div>
                  <div className="text-xl font-bold tabular-nums text-orange-600">{formatRupiah(n(payout?.komisi_earned))}</div>
                </div>
              </div>
              {/* Aging belum-cair */}
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1.5">Aging belum cair (umur sejak delivered) — duit nyangkut/berisiko</div>
                <div className="grid grid-cols-3 gap-2">
                  <AgingBucket label="0–7 hari" tone="text-emerald-600" count={n(payout?.aging_0_7_count)} amount={n(payout?.aging_0_7_amount)} />
                  <AgingBucket label="8–14 hari" tone="text-amber-600" count={n(payout?.aging_8_14_count)} amount={n(payout?.aging_8_14_amount)} />
                  <AgingBucket label="15+ hari" tone="text-rose-600" count={n(payout?.aging_15plus_count)} amount={n(payout?.aging_15plus_amount)} />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Upload payout di <a href="/reconciliation/ekspedisi" className="text-violet-500 hover:underline">Rekonsiliasi Ekspedisi</a> buat update pencairan.</p>
            </CardContent>
          </Card>

          {/* Headline — Posisi Bersih */}
          <Card className="border-violet-500/30 bg-gradient-to-r from-violet-500/10 via-indigo-500/10 to-violet-500/10">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-baseline justify-between flex-wrap gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Posisi Bersih</div>
                  <div className={`text-3xl font-bold tabular-nums ${positif ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatRupiah(posisiBersih)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">Total Aset COD − Total Utang</div>
                </div>
                <div className="text-right text-xs space-y-1">
                  <div className="text-muted-foreground">Total Aset: <span className="text-emerald-600 font-semibold tabular-nums">{formatRupiah(totalAset)}</span></div>
                  <div className="text-muted-foreground">Total Utang: <span className="text-orange-600 font-semibold tabular-nums">{formatRupiah(totalUtang)}</span></div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ASET */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Aset — duit COD kamu di sini
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <BucketCard
                icon={Truck} tone="blue"
                label="COD di Perjalanan" sub="Resi jalan, belum sampai"
                amount={n(p.in_transit_cod)}
                footer={
                  <>
                    <div className="text-[11px] text-muted-foreground">
                      {p.in_transit_orders} order SIAP_KIRIM / DIKIRIM · belum pasti (ada risiko retur)
                    </div>
                    <Link href="/orders/list?status=DIKIRIM" className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1">
                      Lihat order in-transit <ExternalLink className="w-3 h-3" />
                    </Link>
                  </>
                }
              />
              <BucketCard
                icon={Banknote} tone="emerald"
                label="COD di SPX" sub="Sudah sampai, belum ditarik"
                amount={n(p.cod_at_spx)}
                footer={
                  <>
                    <div className="text-[11px] text-muted-foreground">
                      {p.cod_at_spx_orders} order DITERIMA · COD ngendon di akun SPX
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.withdrawal_count > 0
                        ? `Sudah ditarik ${formatRupiah(n(p.total_withdrawn))} (${p.withdrawal_count}×)`
                        : 'Belum ada penarikan dicatat'}
                    </div>
                    <Link href="/reconciliation/spx-cashflow" className="text-xs text-emerald-600 hover:underline flex items-center gap-1 mt-1">
                      Kelola penarikan SPX <ExternalLink className="w-3 h-3" />
                    </Link>
                  </>
                }
              />
            </div>
          </div>

          {/* UTANG */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Utang — yang harus dibayar
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <BucketCard
                icon={Coins} tone="orange"
                label="HPP ke Supplier" sub="Modal barang dropship"
                amount={n(p.hpp_supplier_owed)}
                footer={
                  <>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                      <Building2 className="w-3 h-3" />
                      {p.hpp_supplier_orders} order · {p.hpp_supplier_count} supplier
                    </div>
                    <button onClick={() => setSupplierSheetOpen(true)} className="text-xs text-orange-600 hover:underline flex items-center gap-1 mt-1">
                      Detail per supplier <ArrowRight className="w-3 h-3" />
                    </button>
                  </>
                }
              />
              <BucketCard
                icon={Receipt} tone="amber"
                label="Ongkir SPX" sub="Tagihan ekspedisi (estimasi)"
                amount={n(p.ongkir_spx_owed)}
                footer={
                  <>
                    <div className="text-[11px] text-muted-foreground">
                      Estimasi {p.ongkir_spx_orders} order · SPX tagih bulanan
                    </div>
                    <Link href="/reconciliation/spx" className="text-xs text-amber-600 hover:underline flex items-center gap-1 mt-1">
                      Cek rekonsil SPX <ExternalLink className="w-3 h-3" />
                    </Link>
                  </>
                }
              />
              <BucketCard
                icon={Users} tone="rose"
                label="Komisi Tim" sub="CS &amp; advertiser belum cair"
                amount={n(p.komisi_owed)}
                footer={
                  <>
                    <div className="text-[11px] text-muted-foreground">
                      {p.komisi_count} komisi status EARNED
                    </div>
                    <Link href="/commissions/manage" className="text-xs text-rose-600 hover:underline flex items-center gap-1 mt-1">
                      Kelola komisi <ExternalLink className="w-3 h-3" />
                    </Link>
                  </>
                }
              />
            </div>
          </div>

          {/* Info panel */}
          <Card className="bg-muted/30">
            <CardContent className="pt-4 pb-4 text-xs text-muted-foreground space-y-1.5">
              <div className="font-semibold text-foreground mb-1">Cara baca:</div>
              <div>• <strong>COD di Perjalanan</strong> — order sudah dikirim tapi belum sampai. Belum jadi uang; sebagian bisa retur.</div>
              <div>• <strong>COD di SPX</strong> — order DITERIMA, uang COD sudah dipegang SPX, tinggal ditarik ke rekening. Catat penarikan di SPX Cashflow biar angkanya turun.</div>
              <div>• <strong>HPP ke Supplier</strong> — modal barang yang belum dibayar ke supplier. Tandai lunas lewat &quot;Detail per supplier&quot;.</div>
              <div>• <strong>Ongkir SPX</strong> — estimasi ongkir + fee COD + PPN untuk order yang sudah jalan. SPX tagih bulanan.</div>
              <div>• <strong>Posisi Bersih</strong> = (COD di Perjalanan + COD di SPX) − (HPP + Ongkir SPX + Komisi). Estimasi posisi kas kalau semua beres.</div>
            </CardContent>
          </Card>
        </>
      )}

      <SupplierPayableSheet
        open={supplierSheetOpen}
        onOpenChange={setSupplierSheetOpen}
        onChanged={() => void load(true)}
      />
    </div>
  )
}

function BucketCard({ icon: Icon, tone, label, sub, amount, footer }: {
  icon: typeof Wallet
  tone: Tone
  label: string
  sub: string
  amount: number
  footer: ReactNode
}) {
  const t = TONE[tone]
  return (
    <Card className={t.border}>
      <CardContent className="pt-5 pb-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg ${t.iconBg}`}>
            <Icon className={`w-4 h-4 ${t.icon}`} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-[10px] text-muted-foreground">{sub}</div>
          </div>
        </div>
        <div className={`text-2xl font-bold tabular-nums ${t.amount}`}>{formatRupiah(amount)}</div>
        <div className="space-y-0.5">{footer}</div>
      </CardContent>
    </Card>
  )
}
