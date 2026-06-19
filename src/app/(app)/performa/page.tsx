'use client'
// =============================================================
// Performa Bisnis (#2 blueprint) — 3 tab analitik keputusan:
//   • Campaign Net-Profit  — CPR/CPA/CPA Final/ROAS/ROI/Laba Bersih/Return → campaign winning
//   • CS Scorecard         — closing/retur/laba kontribusi per CS
//   • Produk × Platform    — produk nghasilin berapa, platform terbaik, retur
// Owner/admin only (angka revenue/laba sensitif).
// =============================================================
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
const money = (v: number) => <span className={`tabular-nums ${v < 0 ? 'text-red-600 font-semibold' : v > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>{formatRupiah(v)}</span>
const ret = (v: number) => <span className={`tabular-nums ${v >= 20 ? 'text-red-600 font-semibold' : v >= 10 ? 'text-amber-600' : ''}`}>{v}%</span>

// rupiah ringkas buat sel matriks (2.1jt / -600rb)
const rpShort = (v: number): string => {
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}jt`
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)}rb`
  return `${s}${Math.round(a)}`
}
type ProdMetric = 'net' | 'roi' | 'retur' | 'order'
const cellVal = (r: Record<string, unknown> | undefined, m: ProdMetric) => {
  const dot = <span className="text-muted-foreground/30">·</span>
  if (!r) return dot
  if (m === 'roi') { if (r.roi == null) return dot; const v = n(r.roi); return <span className={v > 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{v.toFixed(0)}%</span> }
  if (m === 'retur') { if (n(r.delivered) + n(r.retur) === 0) return dot; const rr = n(r.return_rate); return <span className={rr >= 20 ? 'text-red-600 font-semibold' : rr >= 10 ? 'text-amber-600' : ''}>{rr}%</span> }
  if (m === 'order') { const o = n(r.total_order); return o > 0 ? <span>{o}</span> : dot }
  const v = n(r.net_profit); return <span className={v > 0 ? 'text-emerald-600 font-medium' : v < 0 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>{rpShort(v)}</span>
}
interface PTotal { net: number; spend: number; order: number; deliv: number; ret: number }
const totalCell = (t: PTotal, m: ProdMetric) => {
  if (m === 'roi') { if (t.spend <= 0) return <span className="text-muted-foreground/30">·</span>; const v = (t.net / t.spend) * 100; return <span className={v > 0 ? 'text-emerald-600' : 'text-red-600'}>{v.toFixed(0)}%</span> }
  if (m === 'retur') { const d = t.deliv + t.ret; if (d === 0) return <span className="text-muted-foreground/30">·</span>; const rr = Math.round((t.ret / d) * 100); return <span className={rr >= 20 ? 'text-red-600' : ''}>{rr}%</span> }
  if (m === 'order') return <span>{t.order}</span>
  return <span className={t.net > 0 ? 'text-emerald-600' : t.net < 0 ? 'text-red-600' : ''}>{rpShort(t.net)}</span>
}

// Header tabel + tooltip hover (underline titik = ada keterangan)
const TH = ({ children, tip, className }: { children: ReactNode; tip?: string; className?: string }) => (
  <TableHead className={className} title={tip}>
    {tip ? <span className="underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 cursor-help">{children}</span> : children}
  </TableHead>
)

type Tab = 'campaign' | 'cs' | 'produk'

export default function PerformaPage() {
  const { role, loading: authLoading } = useAuth()
  const canView = role === 'owner' || role === 'admin' || role === 'advertiser'
  const advOnly = role === 'advertiser' // advertiser cuma lihat tab Campaign
  const [tab, setTab] = useState<Tab>('campaign')
  const [range, setRange] = useState<DateRange>(thisMonth)
  const [allTime, setAllTime] = useState(true)
  const [loading, setLoading] = useState(true)
  const [camp, setCamp] = useState<Record<string, unknown>[]>([])
  const [cs, setCs] = useState<Record<string, unknown>[]>([])
  const [prod, setProd] = useState<Record<string, unknown>[]>([])
  const [err, setErr] = useState(false)
  const [prodMetric, setProdMetric] = useState<ProdMetric>('net')

  // Aggregat total campaign untuk summary bar
  const campTotals = useMemo(() => {
    let spend = 0, net = 0, orders = 0, delivered = 0
    for (const r of camp) { spend += n(r.spend); net += n(r.net_profit); orders += n(r.total_order); delivered += n(r.delivered) }
    return { spend, net, orders, delivered }
  }, [camp])

  // Pivot prod (flat produk×platform) -> matriks: rows=produk, cols=platform
  const matrix = useMemo(() => {
    const PLATS = ['META', 'GOOGLE', 'TIKTOK', 'SNACK']
    const platSet = new Set<string>()
    const pm = new Map<string, { name: string; cells: Record<string, Record<string, unknown>>; total: PTotal }>()
    for (const r of prod) {
      const name = String(r.product_name), plat = String(r.platform)
      platSet.add(plat)
      if (!pm.has(name)) pm.set(name, { name, cells: {}, total: { net: 0, spend: 0, order: 0, deliv: 0, ret: 0 } })
      const row = pm.get(name)!
      row.cells[plat] = r
      row.total.net += n(r.net_profit); row.total.spend += n(r.ad_spend)
      row.total.order += n(r.total_order); row.total.deliv += n(r.delivered); row.total.ret += n(r.retur)
    }
    const cols = [...PLATS.filter(p => platSet.has(p)), ...[...platSet].filter(p => !PLATS.includes(p)).sort()]
    const rows = [...pm.values()].sort((a, b) => b.total.net - a.total.net)
    return { cols, rows }
  }, [prod])

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true); setErr(false)
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
    } catch (e) { console.warn('performa load:', e); setErr(true) } finally { setLoading(false) }
  }, [canView, allTime, range.from, range.to])
  useEffect(() => { if (!authLoading) void load() }, [authLoading, load])

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>
  if (!canView) return (
    <Card className="max-w-md mx-auto mt-8"><CardContent className="pt-6 text-center space-y-2">
      <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
      <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
      <p className="text-sm text-muted-foreground">Performa Bisnis untuk owner, admin & advertiser.</p>
    </CardContent></Card>
  )

  return (
    <div className="space-y-4">
      <PageHeader icon={BarChart3} title="Performa Bisnis"
        description="Keputusan berbasis data: campaign mana untung, CS mana perform, produk × platform terbaik. Winning = LABA BERSIH, bukan CPR termurah." />

      <Card><CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {((advOnly ? [['campaign', 'Campaign']] : [['campaign', 'Campaign'], ['cs', 'CS Scorecard'], ['produk', 'Produk × Platform']]) as [Tab, string][]).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 h-8 text-sm rounded ${tab === k ? 'bg-zinc-500 text-white' : 'text-muted-foreground'}`}>{lbl}</button>
          ))}
        </div>
        <Button variant={allTime ? 'default' : 'outline'} size="sm" onClick={() => setAllTime(true)}>Semua</Button>
        <div className={allTime ? 'opacity-60' : ''}><DateRangePicker value={range} onChange={v => { setRange(v); setAllTime(false) }} /></div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="ml-auto"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
      </CardContent></Card>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          : err ? <div className="py-10 text-center text-sm text-red-600">⚠️ Gagal memuat data — klik Refresh atau cek koneksi.</div>
          : tab === 'campaign' ? (
            <>
              {/* Summary bar — aggregate semua campaign */}
              {camp.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 border-b text-sm bg-muted/30">
                  <span className="text-muted-foreground">{camp.length} campaign</span>
                  <span className="text-muted-foreground">Total Spend: <span className="font-semibold text-foreground tabular-nums">{formatRupiah(campTotals.spend)}</span></span>
                  <span className="text-muted-foreground">Total Order: <span className="font-semibold text-foreground">{campTotals.orders}</span></span>
                  <span className="text-muted-foreground">Sampai: <span className="font-semibold text-foreground">{campTotals.delivered}</span></span>
                  <span className="text-muted-foreground">Total Laba Bersih:
                    <span className={`ml-1 font-bold tabular-nums ${campTotals.net < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatRupiah(campTotals.net)}</span>
                  </span>
                  {campTotals.spend > 0 && (
                    <span className="text-muted-foreground">ROI: <span className={`font-semibold ${campTotals.net / campTotals.spend * 100 > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{((campTotals.net / campTotals.spend) * 100).toFixed(0)}%</span></span>
                  )}
                </div>
              )}
            <Table>
              <TableHeader><TableRow>
                <TH>Campaign</TH>
                <TH tip="Kode atribusi campaign: Platform.Akun.Marker (mis. F.A.1)">Kode</TH>
                <TH tip="Advertiser yang pegang akun iklan ini">Advertiser</TH>
                <TH className="text-right" tip="Total biaya iklan campaign ini di periode">Spend</TH>
                <TH className="text-right" tip="Jumlah lead dari iklan (yang dilaporkan di Input Harian)">Lead</TH>
                <TH className="text-right" tip="Order yang ter-atribusi ke campaign ini">Order</TH>
                <TH className="text-right" tip="Order yang sudah DITERIMA (sampai ke customer)">Sampai</TH>
                <TH className="text-right" tip="% retur dari order yang sudah final (DITERIMA + RETUR)">Retur%</TH>
                <TH className="text-right" tip="Cost per Result = Spend ÷ Lead (biaya per lead)">CPR</TH>
                <TH className="text-right" tip="Cost per Acquisition = Spend ÷ Order (biaya per order)">CPA</TH>
                <TH className="text-right" tip="Spend ÷ order DITERIMA (biaya per penjualan yang benar-benar sampai)">CPA Final</TH>
                <TH className="text-right" tip="Omset ÷ Spend. KOTOR — belum potong HPP/ongkir, bisa nipu kelihatan gede">ROAS</TH>
                <TH className="text-right" tip="Laba Bersih ÷ Spend × 100. Kebenaran: untung beneran per Rp iklan">ROI</TH>
                <TH className="text-right" tip="Laba Bersih = Gross Profit − Iklan. Gross Profit = Omset − HPP − Fee CS (omset udah termasuk ongkir & udah potong biaya admin COD)">Laba Bersih</TH>
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
                    <TableCell className="text-right text-xs"><span className={n(r.roi) < 0 ? 'text-red-600 font-semibold' : n(r.roi) > 0 ? 'text-emerald-600' : ''}>{n(r.spend) ? n(r.roi) + '%' : '—'}</span></TableCell>
                    <TableCell className="text-right text-xs">{money(n(r.net_profit))}</TableCell>
                  </TableRow>
                ))}
                {/* Total row */}
                {camp.length > 0 && (
                  <TableRow className="bg-muted/40 font-semibold border-t-2 border-foreground/10">
                    <TableCell className="text-xs" colSpan={3}>TOTAL ({camp.length} campaign)</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatRupiah(campTotals.spend)}</TableCell>
                    <TableCell /><TableCell className="text-right text-xs tabular-nums">{campTotals.orders}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{campTotals.delivered}</TableCell>
                    <TableCell /><TableCell /><TableCell /><TableCell /><TableCell /><TableCell />
                    <TableCell className="text-right text-xs">{money(campTotals.net)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </>
          ) : tab === 'cs' ? (
            <Table>
              <TableHeader><TableRow>
                <TH>CS</TH>
                <TH className="text-right" tip="Total order yang ditangani CS ini">Order</TH>
                <TH className="text-right" tip="Order yang sudah DITERIMA (sampai)">Sampai</TH>
                <TH className="text-right" tip="Jumlah order retur">Retur</TH>
                <TH className="text-right" tip="% retur dari order final (DITERIMA + RETUR)">Retur%</TH>
                <TH className="text-right" tip="Nilai barang (total produk) — belum termasuk ongkir/potongan">Penjualan</TH>
                <TH className="text-right" tip="Penjualan + selisih ongkir − biaya admin COD">Omset</TH>
                <TH className="text-right" tip="Omset − HPP − Fee CS (laba sebelum iklan; proyeksi SEMUA order termasuk yg belum sampai)">Gross Profit</TH>
                <TH className="text-right" tip="Gross Profit dari order yang SUDAH DITERIMA aja (realisasi, bukan proyeksi)">GP Realisasi</TH>
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
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Tampilkan:</span>
                <div className="inline-flex rounded-md border p-0.5 text-xs">
                  {([['net', 'Laba Bersih'], ['roi', 'ROI'], ['retur', 'Retur%'], ['order', 'Order']] as [ProdMetric, string][]).map(([k, l]) => (
                    <button key={k} onClick={() => setProdMetric(k)} className={`px-2.5 h-7 rounded ${prodMetric === k ? 'bg-zinc-500 text-white' : 'text-muted-foreground'}`}>{l}</button>
                  ))}
                </div>
              </div>
              {matrix.rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Belum ada data.</p> : (
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse min-w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 sticky left-0 bg-card z-10">Produk</th>
                        {matrix.cols.map(c => <th key={c} className="text-right p-2 whitespace-nowrap font-medium">{c === '(tanpa platform)' ? '(tanpa)' : c}</th>)}
                        <th className="text-right p-2 font-semibold border-l">TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.rows.map(row => (
                        <tr key={row.name} className="border-b hover:bg-muted/30">
                          <td className="p-2 font-medium sticky left-0 bg-card z-10 whitespace-nowrap">{row.name}</td>
                          {matrix.cols.map(c => <td key={c} className="text-right p-2 tabular-nums">{cellVal(row.cells[c], prodMetric)}</td>)}
                          <td className="text-right p-2 tabular-nums font-semibold border-l">{totalCell(row.total, prodMetric)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Winning = <b>Laba Bersih</b> tertinggi (bukan CPR termurah). ROI = (Gross Profit − Iklan) ÷ Iklan. "tanpa platform" = order lama belum ber-kode atribusi.</p>
    </div>
  )
}
