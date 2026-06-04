'use client'
// =============================================================
// Pembukuan (Satu Tampilan) — sekarang LEDGER KEUANGAN per-order.
// Union orders_draft (jalan) + orders (terminal) jadi satu tabel; status =
// kolom filter. Dua mode tampilan:
//   • Ringkas    — operasional (tanggal, customer, produk, total, resi)
//   • Keuangan   — P&L per baris: Penjualan→Omset→Gross Profit (EST vs Aktual)
//                  + Dicairkan. Cuma owner/admin/akunting.
// Ringkasan atas = laba_rugi_summary(range) → Proyeksi vs Realisasi + Laba
// Bersih (setelah ad spend & opex periode). Angka rekonsil 1:1 dgn /laba-rugi.
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { BookOpen, Loader2, Search, RefreshCw, Wand2, TrendingUp, TrendingDown, Wallet, Receipt } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah } from '@/lib/format'
import { OrderDetailSheet } from '@/components/orders/order-detail-sheet'

const supabase = createClient()

interface Row {
  source: string; id: number; order_number: string; order_date: string
  status: string; zone: string; customer_name: string; customer_city: string | null
  cs_name: string | null; channel_name: string | null; product_summary: string | null
  total: number; penjualan: number; ongkir: number; actual_shipping_fee: number | null; selisih_ongkir: number; cod_amount: number | null; tracking_no: string | null; resi: string | null
  delivered_at: string | null; returned_at: string | null; exported_at: string | null
  payment_method: string | null; qty: number
  est_fee_admin: number; est_omset: number; est_hpp: number; est_fee_cs: number; est_gross_profit: number
  act_omset: number | null; act_hpp: number | null; act_fee_cs: number | null; act_gross_profit: number | null
  dicairkan: number | null; cod_settled_at: string | null
  total_count: number
}

interface LabaRugi {
  est_penjualan: number; est_selisih_ongkir: number; est_fee_admin: number; est_omset: number; est_hpp: number; est_fee_cs: number; est_gross_profit: number
  act_penjualan: number; act_selisih_ongkir: number; act_fee_admin: number; act_omset: number; act_hpp: number; act_fee_cs: number; act_gross_profit: number
  total_ad_spend: number; total_opex: number; laba_bersih_est: number; laba_bersih_act: number
}

const STATUSES = ['BARU', 'SIAP_KIRIM', 'DIKIRIM', 'PROBLEM', 'DITERIMA', 'RETUR', 'CANCEL', 'FAKE']
const ZONE_COLOR: Record<string, string> = {
  Baru: 'bg-zinc-500/10 text-zinc-500', Antrian: 'bg-sky-500/10 text-sky-600',
  'Siap Kirim': 'bg-teal-500/10 text-teal-600',
  'Nunggu Resi': 'bg-amber-500/10 text-amber-600', Dikirim: 'bg-indigo-500/10 text-indigo-500',
  Problem: 'bg-orange-500/10 text-orange-600', 'Arsip (Delivered)': 'bg-emerald-500/10 text-emerald-600',
  Retur: 'bg-rose-500/10 text-rose-600', Batal: 'bg-zinc-500/10 text-zinc-400', Fake: 'bg-red-500/10 text-red-600',
}
const n = (v: unknown) => Number(v) || 0

// Sel uang berwarna: hijau (+), merah (−), abu kalau null (belum final)
function Money({ v, bold }: { v: number | null | undefined; bold?: boolean }) {
  if (v === null || v === undefined) return <span className="text-muted-foreground/50">—</span>
  const neg = v < 0
  return <span className={`tabular-nums ${bold ? 'font-semibold' : ''} ${neg ? 'text-rose-600' : v > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{formatRupiah(v)}</span>
}

export default function PembukuanPage() {
  const { role } = useAuth()
  const canFinance = role === 'owner' || role === 'admin' || role === 'akunting'

  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<LabaRugi | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [view, setView] = useState<'ringkas' | 'keuangan'>('ringkas')
  const [range, setRange] = useState<DateRange>(thisMonth)
  const [allTime, setAllTime] = useState(true) // default: semua periode (biar semua order kelihatan)
  const [zoneFilter, setZoneFilter] = useState<string | null>(null) // klik chip zona = filter
  const [detail, setDetail] = useState<{ source: 'draft' | 'final'; id: number } | null>(null) // klik baris = detail
  const [page, setPage] = useState(0) // pagination
  const [pageSize, setPageSize] = useState(50) // baris per halaman (pilihan)

  const load = useCallback(async () => {
    setLoading(true); setErr(false)
    const p_from = allTime ? null : range.from
    const p_to = allTime ? null : range.to
    try {
      const [lp, lr] = await Promise.all([
        supabase.rpc('list_pembukuan', { p_from, p_to, p_status: status === 'all' ? null : status, p_search: search.trim() || null, p_limit: 2000, p_offset: 0 }),
        canFinance ? supabase.rpc('laba_rugi_summary', { p_from, p_to }) : Promise.resolve({ data: null, error: null }),
      ])
      if (lp.error) throw lp.error
      setRows((lp.data || []) as Row[])
      setSummary(lr.error ? null : ((lr.data?.[0] ?? null) as LabaRugi | null))
    } catch (e) { console.warn('pembukuan load:', e); setErr(true) } finally { setLoading(false) }
  }, [status, search, allTime, range.from, range.to, canFinance])
  useEffect(() => { void load() }, [load])

  const total = rows[0]?.total_count ?? rows.length
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) m[r.zone] = (m[r.zone] || 0) + 1
    return m
  }, [rows])
  const totalDicair = useMemo(() => rows.reduce((s, r) => s + n(r.dicairkan), 0), [rows])

  // Filter zona (klik chip) di atas hasil server — biar bisa "filter tracking + liat total"
  const displayed = useMemo(() => zoneFilter ? rows.filter(r => r.zone === zoneFilter) : rows, [rows, zoneFilter])
  const totalPages = Math.max(1, Math.ceil(displayed.length / pageSize))
  const paged = useMemo(() => displayed.slice(page * pageSize, (page + 1) * pageSize), [displayed, page, pageSize])
  useEffect(() => { setPage(0) }, [zoneFilter, status, search, allTime, range.from, range.to, view, pageSize])
  const totals = useMemo(() => displayed.reduce((a, r) => ({
    n: a.n + 1, total: a.total + n(r.penjualan),
    est_gp: a.est_gp + n(r.est_gross_profit),
    act_gp: a.act_gp + n(r.act_gross_profit),
    dicair: a.dicair + n(r.dicairkan),
  }), { n: 0, total: 0, est_gp: 0, act_gp: 0, dicair: 0 }), [displayed])

  const cols = view === 'keuangan' && canFinance ? 17 : 11
  // tanggal singkat 04/06/26
  const fmtShort = (d: string) => { const x = new Date(d); const p = (v: number) => String(v).padStart(2, '0'); return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${String(x.getFullYear()).slice(2)}` }
  // freeze 4 kolom kiri (Tanggal·Order#·Nama·Status) — nempel pas scroll kanan
  const FROZEN = [{ left: 0, width: 82 }, { left: 82, width: 148 }, { left: 230, width: 120 }, { left: 350, width: 110 }]
  const fzTh = (i: number): React.CSSProperties => ({ position: 'sticky', top: 0, left: FROZEN[i].left, width: FROZEN[i].width, minWidth: FROZEN[i].width, maxWidth: FROZEN[i].width, zIndex: 30 })
  const fzTd = (i: number): React.CSSProperties => ({ position: 'sticky', left: FROZEN[i].left, width: FROZEN[i].width, minWidth: FROZEN[i].width, maxWidth: FROZEN[i].width, zIndex: 20 })

  return (
    <div className="space-y-4">
      <PageHeader icon={BookOpen} title="Pembukuan (Satu Tampilan)"
        description="Ledger semua order dalam satu tabel — operasional + keuangan (P&L Proyeksi vs Realisasi + Dicairkan). Order yang udah delivered/retur/batal tetap di sini (pindah status, bukan ilang)."
        actions={
          <a href="/marketing/distribusi" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm hover:bg-muted"><Wand2 className="w-3.5 h-3.5" /> Distribusi Atribusi</a>
        } />

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari order# / customer..." className="pl-9" />
          </div>
          <Button variant={allTime ? 'default' : 'outline'} size="sm" onClick={() => setAllTime(true)}>Semua</Button>
          <div className={allTime ? 'opacity-60' : ''}>
            <DateRangePicker value={range} onChange={v => { setRange(v); setAllTime(false) }} />
          </div>
          <Select value={status} onValueChange={v => setStatus(v || 'all')}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Semua status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
        </CardContent>
      </Card>

      {/* Ringkasan keuangan (owner/admin/akunting) */}
      {canFinance && (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
          {/* Headline cards */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={total ? TrendingUp : TrendingUp} label="Order" value={`${total}`} sub={`${counts['Arsip (Delivered)'] || 0} delivered`} />
            <StatCard icon={(summary && n(summary.act_gross_profit) < 0) ? TrendingDown : TrendingUp} label="Gross Profit (Realisasi)" value={formatRupiah(summary ? n(summary.act_gross_profit) : 0)} money={summary ? n(summary.act_gross_profit) : 0} />
            <StatCard icon={Wallet} label="Laba Bersih (Realisasi)" value={formatRupiah(summary ? n(summary.laba_bersih_act) : 0)} money={summary ? n(summary.laba_bersih_act) : 0} sub="setelah iklan + opex" />
            <StatCard icon={Receipt} label="Total Dicairkan" value={formatRupiah(totalDicair)} sub="COD masuk rekening" />
          </div>
          {/* P&L cascade: Proyeksi vs Realisasi */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm">
                <div className="text-xs font-medium text-muted-foreground"></div>
                <div className="text-xs font-medium text-muted-foreground text-right">Proyeksi</div>
                <div className="text-xs font-medium text-muted-foreground text-right">Realisasi</div>
                <PnlRow label="Penjualan (barang)" est={summary?.est_penjualan} act={summary?.act_penjualan} />
                <PnlRow label="+ Selisih Ongkir" est={summary?.est_selisih_ongkir} act={summary?.act_selisih_ongkir} sub />
                <PnlRow label="− Biaya Admin (Fee COD+PPN)" est={summary?.est_fee_admin} act={summary?.act_fee_admin} sub />
                <PnlRow label="= Omset" est={summary?.est_omset} act={summary?.act_omset} strong />
                <PnlRow label="− HPP" est={summary?.est_hpp} act={summary?.act_hpp} sub />
                <PnlRow label="− Fee CS" est={summary?.est_fee_cs} act={summary?.act_fee_cs} sub />
                <PnlRow label="= Gross Profit" est={summary?.est_gross_profit} act={summary?.act_gross_profit} strong />
                <PnlRow label="− Biaya Iklan" est={summary?.total_ad_spend} act={summary?.total_ad_spend} sub />
                <PnlRow label="− Biaya Operasional" est={summary?.total_opex} act={summary?.total_opex} sub />
                <div className="col-span-3 border-t border-foreground/10 mt-1" />
                <PnlRow label="LABA BERSIH" est={summary?.laba_bersih_est} act={summary?.laba_bersih_act} strong big />
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">Realisasi = akrual (revenue diakui pas delivered). Proyeksi = kalau semua order sukses. <a href="/laba-rugi" className="text-violet-500 hover:underline">Laporan lengkap →</a></div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Zona chips (klik = filter) + view toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setZoneFilter(null)}
          className={`text-[11px] px-2 h-6 rounded-full border ${zoneFilter === null ? 'bg-violet-500 text-white border-violet-500' : 'bg-muted text-muted-foreground'}`}>
          Semua: {rows.length}
        </button>
        {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([z, c]) => (
          <button key={z} onClick={() => setZoneFilter(zoneFilter === z ? null : z)}
            className={`text-[11px] px-2 h-6 rounded-full border ${zoneFilter === z ? `ring-2 ring-violet-400 ${ZONE_COLOR[z] || 'bg-muted'}` : (ZONE_COLOR[z] || 'bg-muted')}`}>
            {z}: {c}
          </button>
        ))}
        {canFinance && (
          <div className="ml-auto inline-flex rounded-md border p-0.5">
            <button onClick={() => setView('ringkas')} className={`px-3 h-7 text-xs rounded ${view === 'ringkas' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>Ringkas</button>
            <button onClick={() => setView('keuangan')} className={`px-3 h-7 text-xs rounded ${view === 'keuangan' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>Keuangan</button>
          </div>
        )}
      </div>

      {/* Ledger table */}
      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <Table>
            <TableHeader className="[&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:bg-card [&>tr>th]:z-10"><TableRow>
              <TableHead style={fzTh(0)} className="bg-card" title="Tanggal order">Tgl</TableHead><TableHead style={fzTh(1)} className="bg-card" title="Nomor referensi GrandBook">Order#</TableHead><TableHead style={fzTh(2)} className="bg-card" title="Nama pembeli">Nama</TableHead><TableHead style={fzTh(3)} className="bg-card border-r" title="Status / zona pengiriman">Status</TableHead>
              {view === 'keuangan' && canFinance ? (
                <>
                  <TableHead className="max-w-[160px]" title="Produk yang dipesan">Produk</TableHead>
                  <TableHead className="text-right" title="Harga barang (belum termasuk ongkir)">Penjualan</TableHead>
                  <TableHead className="text-right" title="Ongkir yang ditagih ke pembeli (dari CS / input order)">Ongkir CS</TableHead>
                  <TableHead className="text-right" title="Ongkir asli dari ekspedisi sebelum cashback (dari Sync SPX)">Ongkir Kurir</TableHead>
                  <TableHead className="text-right" title="Potongan ongkir dari ekspedisi (±40% dari ongkir kurir)">Cashback</TableHead>
                  <TableHead className="text-right" title="Ongkir CS − ongkir bersih ekspedisi (untung/rugi ongkir)">Selisih Ongkir</TableHead>
                  <TableHead className="text-right" title="Fee layanan COD ekspedisi (±1%) + PPN">Biaya COD</TableHead>
                  <TableHead className="text-right" title="Penjualan + Selisih Ongkir − Biaya COD (duit bersih masuk)">Omset</TableHead>
                  <TableHead className="text-right" title="Modal barang + fee packing">HPP</TableHead>
                  <TableHead className="text-right" title="Komisi CS per order">Fee CS</TableHead>
                  <TableHead className="text-right" title="Omset − HPP − Fee CS (asumsi order sukses sampai)">GP Proyeksi</TableHead>
                  <TableHead className="text-right" title="Gross profit final — cuma order DITERIMA (uang beneran)">GP Realisasi</TableHead>
                  <TableHead className="text-right" title="COD yang sudah cair dari ekspedisi">Dicairkan</TableHead>
                </>
              ) : (
                <>
                  <TableHead title="Kota tujuan">Kota</TableHead>
                  <TableHead title="CS yang menangani order">CS</TableHead>
                  <TableHead title="Produk yang dipesan">Produk</TableHead>
                  <TableHead className="text-center" title="Jumlah barang">Qty</TableHead>
                  <TableHead title="Metode pembayaran (COD/Transfer)">Bayar</TableHead>
                  <TableHead className="text-right" title="Harga barang">Total</TableHead>
                  <TableHead title="Nomor resi ekspedisi">Resi</TableHead>
                </>
              )}
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={cols} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : displayed.length === 0 ? (
                <TableRow><TableCell colSpan={cols} className={`py-10 text-center text-sm ${err ? 'text-rose-600' : 'text-muted-foreground'}`}>{err ? '⚠️ Gagal memuat data — klik Refresh atau cek koneksi.' : 'Belum ada order di periode/filter ini.'}</TableCell></TableRow>
              ) : paged.map(r => (
                <TableRow key={`${r.source}-${r.id}`} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetail({ source: r.source as 'draft' | 'final', id: r.id })}>
                  <TableCell style={fzTd(0)} className="bg-card text-sm whitespace-nowrap">{fmtShort(r.order_date)}</TableCell>
                  <TableCell style={fzTd(1)} className="bg-card font-mono text-xs whitespace-nowrap overflow-hidden">{r.order_number}</TableCell>
                  <TableCell style={fzTd(2)} className="bg-card text-sm font-medium truncate" title={r.customer_name || ''}>{r.customer_name || '—'}</TableCell>
                  <TableCell style={fzTd(3)} className="bg-card border-r"><Badge variant="outline" className={`${ZONE_COLOR[r.zone] || 'bg-muted'} text-[11px] whitespace-nowrap`}>{r.zone}</Badge></TableCell>
                  {view === 'keuangan' && canFinance ? (
                    <>
                      <TableCell className="text-sm max-w-[160px] truncate" title={r.product_summary || ''}>{r.product_summary || '—'}</TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.penjualan)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.ongkir)} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground"><Money v={n(r.actual_shipping_fee)} /></TableCell>
                      <TableCell className="text-right text-sm text-emerald-600"><Money v={Math.round(n(r.actual_shipping_fee) * 0.4)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.selisih_ongkir)} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground"><Money v={n(r.est_fee_admin)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.est_omset)} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground"><Money v={n(r.est_hpp)} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground"><Money v={n(r.est_fee_cs)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.est_gross_profit)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={r.act_gross_profit === null ? null : n(r.act_gross_profit)} bold /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={r.dicairkan === null ? null : n(r.dicairkan)} /></TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="text-sm">{r.customer_city || '—'}</TableCell>
                      <TableCell className="text-sm">{r.cs_name || '—'}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={r.product_summary || ''}>{r.product_summary || '—'}</TableCell>
                      <TableCell className="text-center text-sm">{r.qty || '—'}</TableCell>
                      <TableCell className="text-sm">{r.payment_method || '—'}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{formatRupiah(n(r.penjualan))}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{r.tracking_no || r.resi || '—'}</TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {!loading && displayed.length > 0 && (
                <TableRow className="bg-muted/50 font-semibold border-t-2 border-foreground/15">
                  {view === 'keuangan' && canFinance ? (
                    <>
                      <TableCell colSpan={5} className="text-sm">TOTAL ({totals.n} order{zoneFilter ? ` · ${zoneFilter}` : ''})</TableCell>
                      <TableCell className="text-right text-sm"><Money v={totals.total} bold /></TableCell>
                      <TableCell /><TableCell /><TableCell /><TableCell /><TableCell /><TableCell /><TableCell /><TableCell />
                      <TableCell className="text-right text-sm"><Money v={totals.est_gp} bold /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={totals.act_gp} bold /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={totals.dicair} bold /></TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell colSpan={9} className="text-sm">TOTAL ({totals.n} order{zoneFilter ? ` · ${zoneFilter}` : ''})</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{formatRupiah(totals.total)}</TableCell>
                      <TableCell />
                    </>
                  )}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {!loading && displayed.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2 text-sm">
              <option value={50}>50 / halaman</option>
              <option value={100}>100 / halaman</option>
              <option value={500}>500 / halaman</option>
              <option value={1000}>1000 / halaman</option>
            </select>
            <span className="text-muted-foreground tabular-nums">{displayed.length.toLocaleString('id-ID')} order · Hal {page + 1} / {totalPages}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹ Prev</Button>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next ›</Button>
          </div>
        </div>
      )}
      <OrderDetailSheet source={detail?.source ?? null} id={detail?.id ?? null} onClose={() => setDetail(null)} />
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, money }: { icon: React.ElementType; label: string; value: string; sub?: string; money?: number }) {
  const color = money === undefined ? '' : money < 0 ? 'text-rose-600' : money > 0 ? 'text-emerald-600' : ''
  return (
    <Card><CardContent className="pt-4 pb-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  )
}

function PnlRow({ label, est, act, strong, big, sub }: { label: string; est?: number; act?: number; strong?: boolean; big?: boolean; sub?: boolean }) {
  const cls = `${big ? 'text-base' : 'text-sm'} ${strong ? 'font-semibold' : sub ? 'text-muted-foreground' : ''}`
  const money = (v?: number) => {
    const x = Number(v) || 0
    return <span className={`tabular-nums ${x < 0 ? 'text-rose-600' : strong && x > 0 ? 'text-emerald-600' : ''}`}>{formatRupiah(x)}</span>
  }
  return (
    <>
      <div className={cls}>{label}</div>
      <div className={`text-right ${cls}`}>{money(est)}</div>
      <div className={`text-right ${cls}`}>{money(act)}</div>
    </>
  )
}
