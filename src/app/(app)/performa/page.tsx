'use client'
// =============================================================
// Performa Bisnis (#2 blueprint) — 3 tab analitik keputusan:
//   • Campaign Net-Profit  — CPR/CPA/CPA Final/ROAS/ROI/Laba Bersih/Return → campaign winning
//   • CS Scorecard         — closing/retur/laba kontribusi per CS
//   • Produk × Platform    — produk nghasilin berapa, platform terbaik, retur
// Owner/admin only (angka revenue/laba sensitif).
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { PageHeader } from '@/components/ui/page-header'
import { BarChart3, Loader2, RefreshCw, AlertTriangle } from 'lucide-react'
import { formatRupiah } from '@/lib/format'

const supabase = createClient()
const n = (v: unknown) => Number(v) || 0
const money = (v: number) => <span className={`tabular-nums ${v < 0 ? 'text-rose-600 font-semibold' : v > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>{formatRupiah(v)}</span>
const ret = (v: number) => <span className={`tabular-nums ${v >= 20 ? 'text-rose-600 font-semibold' : v >= 10 ? 'text-amber-600' : ''}`}>{v}%</span>

type Tab = 'campaign' | 'cs' | 'produk'

export default function PerformaPage() {
  const { role, loading: authLoading } = useAuth()
  const canView = role === 'owner' || role === 'admin'
  const [tab, setTab] = useState<Tab>('campaign')
  const [range, setRange] = useState<DateRange>(thisMonth)
  const [allTime, setAllTime] = useState(true)
  const [loading, setLoading] = useState(true)
  const [camp, setCamp] = useState<Record<string, unknown>[]>([])
  const [cs, setCs] = useState<Record<string, unknown>[]>([])
  const [prod, setProd] = useState<Record<string, unknown>[]>([])

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    const p_from = allTime ? null : range.from
    const p_to = allTime ? null : range.to
    try {
      const [c, s, p] = await Promise.all([
        supabase.rpc('analytics_campaign_profit', { p_from, p_to }),
        supabase.rpc('analytics_cs_scorecard', { p_from, p_to }),
        supabase.rpc('analytics_produk_platform', { p_from, p_to }),
      ])
      setCamp((c.data || []) as Record<string, unknown>[])
      setCs((s.data || []) as Record<string, unknown>[])
      setProd((p.data || []) as Record<string, unknown>[])
    } catch (err) { console.warn('performa load:', err) } finally { setLoading(false) }
  }, [canView, allTime, range.from, range.to])
  useEffect(() => { if (!authLoading) void load() }, [authLoading, load])

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>
  if (!canView) return (
    <Card className="max-w-md mx-auto mt-8"><CardContent className="pt-6 text-center space-y-2">
      <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
      <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
      <p className="text-sm text-muted-foreground">Performa Bisnis hanya untuk owner & admin.</p>
    </CardContent></Card>
  )

  return (
    <div className="space-y-4">
      <PageHeader icon={BarChart3} title="Performa Bisnis"
        description="Keputusan berbasis data: campaign mana untung, CS mana perform, produk × platform terbaik. Winning = LABA BERSIH, bukan CPR termurah." />

      <Card><CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {([['campaign', 'Campaign'], ['cs', 'CS Scorecard'], ['produk', 'Produk × Platform']] as [Tab, string][]).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 h-8 text-sm rounded ${tab === k ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>{lbl}</button>
          ))}
        </div>
        <Button variant={allTime ? 'default' : 'outline'} size="sm" onClick={() => setAllTime(true)}>Semua</Button>
        <div className={allTime ? 'opacity-60' : ''}><DateRangePicker value={range} onChange={v => { setRange(v); setAllTime(false) }} /></div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="ml-auto"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
      </CardContent></Card>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          : tab === 'campaign' ? (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Campaign</TableHead><TableHead>Kode</TableHead><TableHead>Advertiser</TableHead>
                <TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Lead</TableHead>
                <TableHead className="text-right">Order</TableHead><TableHead className="text-right">Sampai</TableHead>
                <TableHead className="text-right">Retur%</TableHead><TableHead className="text-right">CPR</TableHead>
                <TableHead className="text-right">CPA</TableHead><TableHead className="text-right">CPA Final</TableHead>
                <TableHead className="text-right">ROAS</TableHead><TableHead className="text-right">ROI</TableHead>
                <TableHead className="text-right">Laba Bersih</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {camp.length === 0 ? <TableRow><TableCell colSpan={14} className="py-10 text-center text-sm text-muted-foreground">Belum ada data campaign.</TableCell></TableRow>
                : camp.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs max-w-[180px] truncate" title={String(r.campaign_name)}>{String(r.campaign_name)}</TableCell>
                    <TableCell className="font-mono text-[10px] whitespace-nowrap">{String(r.platform)}.{String(r.akun)}.{String(r.marker)}</TableCell>
                    <TableCell className="text-xs">{r.advertiser_name ? String(r.advertiser_name) : '—'}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatRupiah(n(r.spend))}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.leads) || '—'}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-medium">{n(r.total_order)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.delivered)}</TableCell>
                    <TableCell className="text-right text-xs">{ret(n(r.return_rate))}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.cpr) ? formatRupiah(n(r.cpr)) : '—'}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.cpa) ? formatRupiah(n(r.cpa)) : '—'}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.cpa_final) ? formatRupiah(n(r.cpa_final)) : '—'}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.roas) ? n(r.roas).toFixed(2) + 'x' : '—'}</TableCell>
                    <TableCell className="text-right text-xs"><span className={n(r.roi) < 0 ? 'text-rose-600 font-semibold' : n(r.roi) > 0 ? 'text-emerald-600' : ''}>{n(r.spend) ? n(r.roi) + '%' : '—'}</span></TableCell>
                    <TableCell className="text-right text-xs">{money(n(r.net_profit))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : tab === 'cs' ? (
            <Table>
              <TableHeader><TableRow>
                <TableHead>CS</TableHead><TableHead className="text-right">Order</TableHead>
                <TableHead className="text-right">Sampai</TableHead><TableHead className="text-right">Retur</TableHead>
                <TableHead className="text-right">Retur%</TableHead><TableHead className="text-right">Penjualan</TableHead>
                <TableHead className="text-right">Omset</TableHead><TableHead className="text-right">Gross Profit</TableHead>
                <TableHead className="text-right">GP Realisasi</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {cs.length === 0 ? <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">Belum ada data.</TableCell></TableRow>
                : cs.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{String(r.cs_name)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.total_order)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.delivered)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.retur)}</TableCell>
                    <TableCell className="text-right text-xs">{ret(n(r.return_rate))}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatRupiah(n(r.penjualan))}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatRupiah(n(r.omset))}</TableCell>
                    <TableCell className="text-right text-xs">{money(n(r.gross_profit))}</TableCell>
                    <TableCell className="text-right text-xs">{money(n(r.gross_profit_real))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Produk</TableHead><TableHead>Platform</TableHead>
                <TableHead className="text-right">Order</TableHead><TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Sampai</TableHead><TableHead className="text-right">Retur</TableHead>
                <TableHead className="text-right">Retur%</TableHead><TableHead className="text-right">Penjualan</TableHead>
                <TableHead className="text-right">Omset</TableHead><TableHead className="text-right">Gross Profit</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {prod.length === 0 ? <TableRow><TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">Belum ada data.</TableCell></TableRow>
                : prod.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{String(r.product_name)}</TableCell>
                    <TableCell className="text-xs">{String(r.platform)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.total_order)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.qty)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.delivered)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{n(r.retur)}</TableCell>
                    <TableCell className="text-right text-xs">{ret(n(r.return_rate))}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatRupiah(n(r.penjualan))}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatRupiah(n(r.omset))}</TableCell>
                    <TableCell className="text-right text-xs">{money(n(r.gross_profit))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Winning = <b>Laba Bersih</b> tertinggi (bukan CPR termurah). ROI = (Gross Profit − Iklan) ÷ Iklan. "tanpa platform" = order lama belum ber-kode atribusi.</p>
    </div>
  )
}
