'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { BookOpen, Loader2, Search, RefreshCw, Wand2, ChevronDown, ChevronUp, BarChart2, FileSpreadsheet } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah } from '@/lib/format'
import { OrderDetailSheet } from '@/components/orders/order-detail-sheet'
import { buildPembukuanXlsxBlob, buildPembukuanCsvBlob, collectPembukuanExport, pembukuanRowKey } from '@/lib/orders/pembukuan-export'
import { downloadBlob } from '@/lib/converter/serializer'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errors'

const supabase = createClient()

interface Row {
  source: string; id: number; order_number: string; order_date: string
  status: string; zone: string; customer_name: string; customer_city: string | null
  cs_name: string | null; channel_name: string | null; product_summary: string | null
  attribution_code_raw: string | null
  campaign_name: string | null; campaign_platform: string | null
  total: number; penjualan: number; ongkir: number; actual_shipping_fee: number | null; selisih_ongkir?: number | null; cod_amount: number | null; tracking_no: string | null; resi: string | null
  delivered_at: string | null; returned_at: string | null; exported_at: string | null
  payment_method: string | null; qty: number
  est_fee_admin?: number | null; est_omset: number; est_hpp: number; est_fee_cs: number; est_gross_profit: number
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
  Baru: 'bg-zinc-500/10 text-zinc-500', Antrian: 'bg-zinc-500/10 text-zinc-600',
  'Siap Kirim': 'bg-zinc-500/10 text-zinc-600',
  'Nunggu Resi': 'bg-amber-500/10 text-amber-600', Dikirim: 'bg-zinc-500/10 text-zinc-500',
  Problem: 'bg-amber-500/10 text-amber-600', 'Arsip (Delivered)': 'bg-emerald-500/10 text-emerald-600',
  Retur: 'bg-red-500/10 text-red-600', Batal: 'bg-zinc-500/10 text-zinc-400', Fake: 'bg-red-500/10 text-red-600',
}
const n = (v: unknown) => Number(v) || 0

function Money({ v, bold }: { v: number | null | undefined; bold?: boolean }) {
  if (v === null || v === undefined) return <span className="text-muted-foreground/50">—</span>
  const neg = v < 0
  return <span className={`whitespace-nowrap tabular-nums ${bold ? 'font-semibold' : ''} ${neg ? 'text-red-600' : v > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{formatRupiah(v)}</span>
}

export default function PembukuanPage() {
  const { role, user, profile } = useAuth()
  const canFinance = role === 'owner' || role === 'admin' || role === 'akunting'

  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<LabaRugi | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [view, setView] = useState<'ringkas' | 'keuangan'>('ringkas')
  const [range, setRange] = useState<DateRange>(thisMonth)
  // The default WIB day may differ from cached server HTML after midnight.
  const [rangeReady, setRangeReady] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setRangeReady(true), 0)
    return () => window.clearTimeout(timer)
  }, [])
  const [allTime, setAllTime] = useState(false)
  const [zoneFilter, setZoneFilter] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ source: 'draft' | 'final'; id: number } | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [pnlOpen, setPnlOpen] = useState(false) // collapsed by default
  const [exportScope, setExportScope] = useState<'filtered' | 'selected'>('filtered')
  const [exportProgress, setExportProgress] = useState<{ read: number; total: number } | null>(null)
  const exporting = exportProgress !== null
  const exportRequest = useRef<AbortController | null>(null)
  const pageRequest = useRef<AbortController | null>(null)
  const scopeKey = JSON.stringify([user?.id, profile?.organization_id, role, allTime, range.from, range.to, status, search.trim(), zoneFilter])
  const [selection, setSelection] = useState<{ scope: string; keys: Set<string> }>({ scope: '', keys: new Set() })
  const selected = useMemo(() => selection.scope === scopeKey ? selection.keys : new Set<string>(), [selection, scopeKey])
  // Filter/auth changes and navigation invalidate an in-flight export.
  useEffect(() => () => { exportRequest.current?.abort() }, [scopeKey])

  const load = useCallback(async () => {
    pageRequest.current?.abort()
    const controller = new AbortController()
    pageRequest.current = controller
    setLoading(true); setErr(false)
    const p_from = allTime ? null : range.from
    const p_to = allTime ? null : range.to
    try {
      const params = { p_from, p_to, p_status: status === 'all' ? null : status, p_search: search.trim() || null }
      // Server-side pagination: jangan scan semua ledger di initial load.
      const [first, lr] = await Promise.all([
        supabase.rpc('list_pembukuan', { ...params, p_limit: pageSize, p_offset: page * pageSize }).range(0, pageSize - 1).abortSignal(controller.signal),
        pnlOpen && canFinance && !allTime
          ? supabase.rpc('laba_rugi_summary', { p_from, p_to }).abortSignal(controller.signal)
          : Promise.resolve({ data: null, error: null }),
      ])
      if (controller.signal.aborted) return
      if (first.error) throw first.error
      setRows((first.data || []) as Row[])
      setSummary(lr.error ? null : ((lr.data?.[0] ?? null) as LabaRugi | null))
    } catch (e) {
      if (!controller.signal.aborted) { console.warn('pembukuan load:', e); setErr(true); setRows([]); if (pnlOpen) setSummary(null) }
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [status, search, allTime, range.from, range.to, canFinance, pnlOpen, page, pageSize])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => { window.clearTimeout(timer); pageRequest.current?.abort() }
  }, [load])

  const total = rows[0]?.total_count ?? rows.length
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) m[r.zone] = (m[r.zone] || 0) + 1
    return m
  }, [rows])

  const displayed = useMemo(() => zoneFilter ? rows.filter(r => r.zone === zoneFilter) : rows, [rows, zoneFilter])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const paged = displayed
  const resetToFirstPage = () => { setPage(0) }
  const resetFilters = () => { setPage(0); setSelection({ scope: '', keys: new Set() }) }

  const totals = useMemo(() => displayed.reduce((a, r) => ({
    n: a.n + 1, total: a.total + n(r.penjualan),
    est_gp: a.est_gp + n(r.est_gross_profit),
    act_gp: a.act_gp + n(r.act_gross_profit),
    dicair: a.dicair + n(r.dicairkan),
  }), { n: 0, total: 0, est_gp: 0, act_gp: 0, dicair: 0 }), [displayed])

  const toggleSelection = (keys: string[], checked: boolean) => {
    const next = new Set(selected)
    for (const key of keys) { if (checked) next.add(key); else next.delete(key) }
    setSelection({ scope: scopeKey, keys: next })
  }
  const exportSheet = async (fmt: 'xlsx' | 'csv') => {
    if (exportRequest.current || loading || err) return
    const controller = new AbortController()
    exportRequest.current = controller
    setExportProgress({ read: 0, total: 0 })
    try {
      const params = { p_from: allTime ? null : range.from, p_to: allTime ? null : range.to,
        p_status: status === 'all' ? null : status, p_search: search.trim() || null }
      const list = await collectPembukuanExport<Row>({
        fetchPage: async (offset, limit, signal) => {
          // Let PostgREST page the full RPC result in a UNIQUE order. The RPC's
          // own date/id order can tie between draft and final with the same id.
          const { data, error } = await supabase.rpc('list_pembukuan', { ...params, p_limit: null, p_offset: 0 })
            .order('order_date', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false }).order('source', { ascending: true })
            .range(offset, offset + limit - 1).abortSignal(signal!)
          if (error) throw error
          if (!data) throw new Error('Respons ekspor tidak tersedia.')
          return data as Row[]
        },
        zone: zoneFilter, selected: exportScope === 'selected' ? selected : undefined,
        signal: controller.signal, onProgress: (read, count) => setExportProgress({ read, total: count }),
      })
      if (list.length === 0) { toast.info('Tidak ada order yang cocok dengan filter ekspor.'); return }
      const ts = new Date().toISOString().slice(0, 10)
      const blob = fmt === 'xlsx' ? buildPembukuanXlsxBlob(list) : buildPembukuanCsvBlob(list)
      if (controller.signal.aborted) return
      downloadBlob(blob, `pembukuan_${exportScope === 'selected' ? 'pilihan' : 'filter'}_${allTime ? 'semua-periode' : `${range.from}_${range.to}`}_${ts}.${fmt}`)
      toast.success(`${list.length.toLocaleString('id-ID')} baris + TOTAL diekspor (${fmt.toUpperCase()})`)
    } catch (e) {
      if (!controller.signal.aborted) toast.error('Gagal ekspor — file tidak diunduh', { description: getErrorMessage(e) })
    } finally {
      exportRequest.current = null
      setExportProgress(null)
    }
  }

  // Hitung retur rate dari row yang ada
  const deliveredCount = counts['Arsip (Delivered)'] || 0
  const returCount = counts['Retur'] || 0
  const returRate = deliveredCount + returCount > 0
    ? Math.round(returCount / (deliveredCount + returCount) * 100)
    : null

  const cols = view === 'keuangan' && canFinance ? 17 : 12
  const fmtShort = (d: string) => { const x = new Date(d); const p = (v: number) => String(v).padStart(2, '0'); return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${String(x.getFullYear()).slice(2)}` }
  const columnWidths = view === 'keuangan' && canFinance
    ? [130, 190, 190, 170, 240, ...Array(12).fill(170)]
    : [130, 190, 190, 170, 160, 150, 250, 240, 70, 110, 170, 190]
  const frozenStyle = (i: number) => ({ '--ledger-left': i === 1 ? '130px' : '0px' }) as React.CSSProperties


  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader icon={BookOpen} title="Buku Order"
        description="Periksa order, atribusi, dan nilai keuangan. Pilih Ringkas atau Keuangan sesuai kebutuhan."
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <select aria-label="Cakupan ekspor" value={exportScope} onChange={e => setExportScope(e.target.value as 'filtered' | 'selected')} disabled={exporting} className="h-8 max-w-full rounded-md border bg-background px-2 text-sm">
              <option value="filtered">Semua hasil filter</option>
              <option value="selected">Baris dipilih ({selected.size.toLocaleString('id-ID')})</option>
            </select>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void exportSheet('xlsx')} disabled={loading || err || exporting || !user || (exportScope === 'selected' && selected.size === 0)}>
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void exportSheet('csv')} disabled={loading || err || exporting || !user || (exportScope === 'selected' && selected.size === 0)}>
              CSV
            </Button>
            <a href="/marketing/distribusi" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm hover:bg-muted"><Wand2 className="w-3.5 h-3.5" /> Distribusi Atribusi</a>
          </div>
        } />

      {canFinance && <p className="text-xs text-muted-foreground">Komisi/selisih estimasi adalah sisa perhitungan seluruh peran, bukan pembayaran CS. Pencairan mengikuti bukti tercatat dan dapat ada saat status order masih berjalan; bukan laba kas atau verifikasi saldo bank.</p>}
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Ekspor: {allTime ? 'semua periode' : `${range.from} sampai ${range.to}`} · {status === 'all' ? 'semua status' : status}{search.trim() ? ` · pencarian “${search.trim()}”` : ''} · {zoneFilter || 'semua zona'}. Seluruh halaman dibaca. Excel berisi angka dan formula TOTAL; CSV berisi nilai.</span>
        <span>{selected.size.toLocaleString('id-ID')} order dipilih lintas halaman. Pilihan direset saat filter berubah.</span>
        {selected.size > 0 && <Button variant="ghost" size="sm" disabled={exporting} onClick={() => setSelection({ scope: scopeKey, keys: new Set() })}>Hapus pilihan</Button>}
      </div>
      {exportProgress && <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Membaca {exportProgress.read.toLocaleString('id-ID')}{exportProgress.total ? ` / ${exportProgress.total.toLocaleString('id-ID')}` : ''} order…
        <Button variant="outline" size="sm" onClick={() => exportRequest.current?.abort()}>Batalkan ekspor</Button>
      </div>}

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-4"><fieldset disabled={exporting} className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => { resetFilters(); setSearch(e.target.value) }} aria-label="Cari nomor order atau pelanggan" placeholder="Cari nomor order atau pelanggan…" className="pl-9" />
          </div>
          <Button variant={allTime ? 'default' : 'outline'} size="sm" onClick={() => { resetFilters(); setAllTime(true) }}>Semua</Button>
          <div className={allTime ? 'opacity-60' : ''}>
            {rangeReady && <DateRangePicker value={range} onChange={v => { resetFilters(); setRange(v); setAllTime(false) }} />}
          </div>
          <Select value={status} onValueChange={v => { resetFilters(); setStatus(v || 'all') }}>
            <SelectTrigger aria-label="Filter status order" className="w-44"><SelectValue>{status === 'all' ? 'Semua status' : status.replaceAll('_', ' ')}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" aria-label="Muat ulang Buku Order" onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
        </fieldset></CardContent>
      </Card>

      {/* Compact summary bar — 1 baris, semua role */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-1">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">{total.toLocaleString('id-ID')}</span> order total
          </span>
          {deliveredCount > 0 && (
            <span className="text-muted-foreground">
              <span className="font-semibold text-emerald-600">{deliveredCount.toLocaleString('id-ID')}</span> delivered
            </span>
          )}
          {returCount > 0 && (
            <span className="text-muted-foreground">
              <span className={`font-semibold ${returRate !== null && returRate >= 25 ? 'text-red-600' : 'text-amber-500'}`}>
                {returCount.toLocaleString('id-ID')} retur {returRate !== null ? `(${returRate}%)` : ''}
              </span>
            </span>
          )}
          {(counts['Problem'] || 0) > 0 && (
            <span className="text-amber-600 font-semibold">
              ⚠ {counts['Problem']} problem
            </span>
          )}
          {canFinance && summary && (
            <span className="text-muted-foreground">
              Laba Bersih:{' '}
              <span className={`font-semibold tabular-nums ${n(summary.laba_bersih_act) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {formatRupiah(n(summary.laba_bersih_act))}
              </span>
              <span className="text-xs text-muted-foreground/60 ml-1">(realisasi)</span>
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* Toggle view Ringkas/Keuangan */}
          {canFinance && (
            <div className="inline-flex rounded-md border p-0.5">
              <button onClick={() => { resetToFirstPage(); setView('ringkas') }} aria-pressed={view === 'ringkas'} className={`px-3 h-7 text-xs rounded ${view === 'ringkas' ? 'bg-zinc-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}>Ringkas</button>
              <button onClick={() => { resetToFirstPage(); setView('keuangan') }} aria-pressed={view === 'keuangan'} className={`px-3 h-7 text-xs rounded flex items-center gap-1 ${view === 'keuangan' ? 'bg-zinc-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                <BarChart2 className="w-3 h-3" /> Keuangan
              </button>
            </div>
          )}

          {/* Toggle P&L ringkasan */}
          {canFinance && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setPnlOpen(v => !v)}>
              {pnlOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {pnlOpen ? 'Sembunyikan P&L' : 'Lihat Ringkasan P&L'}
            </Button>
          )}
        </div>
      </div>

      {/* P&L cascade — collapsible, owner/admin/akunting only */}
      {canFinance && pnlOpen && (
        <Card>
          <CardContent className="pt-4 pb-3">
            {allTime ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                Ringkasan P&L all-time sengaja tidak dihitung otomatis supaya halaman tidak timeout. Pilih periode tanggal dulu kalau mau lihat P&L.
              </div>
            ) : (
              <>
            <div className="overflow-x-auto"><div className="grid min-w-[540px] grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 text-sm max-w-xl">
              <div className="text-xs font-medium text-muted-foreground col-span-1"></div>
              <div className="text-xs font-medium text-muted-foreground text-right">Proyeksi</div>
              <div className="text-xs font-medium text-muted-foreground text-right">Realisasi</div>
              <PnlRow label="Penjualan (barang)" est={summary?.est_penjualan} act={summary?.act_penjualan} />
              <PnlRow label="+ Selisih Ongkir" est={summary?.est_selisih_ongkir} act={summary?.act_selisih_ongkir} sub />
              <PnlRow label="− Biaya Admin (Fee COD+PPN)" est={summary?.est_fee_admin} act={summary?.act_fee_admin} sub />
              <PnlRow label="= Omset" est={summary?.est_omset} act={summary?.act_omset} strong />
              <PnlRow label="− HPP" est={summary?.est_hpp} act={summary?.act_hpp} sub />
              <PnlRow label="− Komisi/selisih estimasi" est={summary?.est_fee_cs} act={summary?.act_fee_cs} sub />
              <PnlRow label="= Gross Profit" est={summary?.est_gross_profit} act={summary?.act_gross_profit} strong />
              <PnlRow label="− Biaya Iklan" est={summary?.total_ad_spend} act={summary?.total_ad_spend} sub />
              <PnlRow label="− Biaya Operasional" est={summary?.total_opex} act={summary?.total_opex} sub />
              <div className="col-span-3 border-t border-foreground/10 mt-1" />
              <PnlRow label="LABA BERSIH" est={summary?.laba_bersih_est} act={summary?.laba_bersih_act} strong big />
            </div></div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Realisasi = akrual (revenue diakui pas delivered). Proyeksi = kalau semua order sukses.{' '}
              <a href="/laba-rugi" className="text-zinc-500 hover:underline">Laporan lengkap →</a>
            </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Zone chips (klik = filter) */}
      <fieldset disabled={exporting} className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Zona (jumlah di halaman ini):</span>
        <button onClick={() => { resetFilters(); setZoneFilter(null) }}
          className={`text-[11px] px-2.5 h-6 rounded-full border transition-colors ${zoneFilter === null ? 'bg-zinc-500 text-white border-zinc-500' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
          Semua · {total.toLocaleString('id-ID')}{rows.length < total ? ` (loaded ${rows.length.toLocaleString('id-ID')})` : ''}
        </button>
        {Object.keys(ZONE_COLOR).map(z => (
          <button key={z} onClick={() => { resetFilters(); setZoneFilter(zoneFilter === z ? null : z) }}
            className={`text-[11px] px-2.5 h-6 rounded-full border transition-colors ${zoneFilter === z ? `ring-2 ring-zinc-400 ${ZONE_COLOR[z] || 'bg-muted'}` : (ZONE_COLOR[z] || 'bg-muted text-muted-foreground')} hover:opacity-80`}>
            {z} · {counts[z] || 0}
          </button>
        ))}
      </fieldset>

      {/* Ledger table */}
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-4 py-3 text-xs text-muted-foreground">Geser tabel untuk melihat semua kolom. Ringkasan di bawah menjumlahkan baris pada halaman ini.</div>
          <Table className="ledger-table table-fixed" style={{ width: columnWidths.reduce((sum, width) => sum + width, 0) }} containerClassName="max-h-[65vh]" containerLabel="Tabel Buku Order, geser untuk melihat semua kolom">
            <colgroup>{columnWidths.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
            <TableHeader className="[&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:bg-card [&>tr>th]:z-10"><TableRow>
              <TableHead style={frozenStyle(0)} className="bg-card"><label className="flex items-center gap-2"><input type="checkbox" aria-label="Pilih semua baris halaman ini" disabled={loading || exporting || displayed.length === 0} checked={displayed.length > 0 && displayed.every(r => selected.has(pembukuanRowKey(r)))} onChange={e => toggleSelection(displayed.map(pembukuanRowKey), e.target.checked)} />Tgl</label></TableHead>
              <TableHead style={frozenStyle(1)} className="bg-card">Order#</TableHead>
              <TableHead style={frozenStyle(2)} className="bg-card">Nama</TableHead>
              <TableHead style={frozenStyle(3)} className="bg-card border-r">Status</TableHead>
              {view === 'keuangan' && canFinance ? (
                <>
                  <TableHead className="max-w-[160px]">Produk</TableHead>
                  <TableHead className="text-right" title="Tagihan barang dan ongkir pembeli; gross OrderOnline yang terbukti dihitung sekali">Tagihan pembeli</TableHead>
                  <TableHead className="text-right" title="Ongkir yang ditagih ke pembeli">Ongkir CS</TableHead>
                  <TableHead className="text-right" title="Ongkir asli dari SPX sebelum cashback">Ongkir Kurir</TableHead>
                  <TableHead className="text-right" title="Potongan cashback 40% dari ekspedisi">Cashback</TableHead>
                  <TableHead className="text-right" title="Ongkir CS − ongkir bersih ekspedisi">Selisih Ongkir</TableHead>
                  <TableHead className="text-right" title="Fee COD 1% + PPN 12%">Biaya COD</TableHead>
                  <TableHead className="text-right" title="Tagihan pembeli dikurangi biaya kurir estimasi">Omset</TableHead>
                  <TableHead className="text-right" title="Modal barang + packing">HPP</TableHead>
                  <TableHead className="text-right" title="Sisa omzet setelah HPP dan profit tersimpan; seluruh peran dan selisih estimasi">Komisi/selisih estimasi</TableHead>
                  <TableHead className="text-right" title="Proyeksi GP (semua order)">GP Proj.</TableHead>
                  <TableHead className="text-right" title="GP Realisasi — hanya DITERIMA">GP Real.</TableHead>
                  <TableHead className="text-right" title="Pencairan tercatat final/draft; bukan bukti saldo bank">Dicairkan</TableHead>
                </>
              ) : (
                <>
                  <TableHead>Kota</TableHead>
                  <TableHead>CS</TableHead>
                  <TableHead>Kode Atribusi</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead>Bayar</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Resi</TableHead>
                </>
              )}
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={cols} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : displayed.length === 0 ? (
                <TableRow><TableCell colSpan={cols} className={`py-10 text-center text-sm ${err ? 'text-red-600' : 'text-muted-foreground'}`}>{err ? '⚠️ Gagal memuat data — klik Refresh atau cek koneksi.' : zoneFilter && rows.length > 0 ? 'Tidak ada order di zona ini pada halaman ini. Coba halaman berikutnya atau ekspor semua hasil filter.' : 'Belum ada order di periode/filter ini.'}</TableCell></TableRow>
              ) : paged.map(r => (
                <TableRow key={`${r.source}-${r.id}`} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetail({ source: r.source as 'draft' | 'final', id: r.id })}>
                  <TableCell style={frozenStyle(0)} className="bg-card text-sm whitespace-nowrap"><label className="flex items-center gap-2" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Pilih ${r.order_number} (${r.source})`} disabled={exporting} checked={selected.has(pembukuanRowKey(r))} onChange={e => toggleSelection([pembukuanRowKey(r)], e.target.checked)} />{fmtShort(r.order_date)}</label></TableCell>
                  <TableCell style={frozenStyle(1)} className="bg-card font-mono text-xs whitespace-nowrap overflow-hidden">{r.order_number}</TableCell>
                  <TableCell style={frozenStyle(2)} className="bg-card whitespace-normal break-words text-sm font-medium" title={r.customer_name || ''}>{r.customer_name || '—'}</TableCell>
                  <TableCell style={frozenStyle(3)} className="bg-card border-r"><Badge variant="outline" className={`${ZONE_COLOR[r.zone] || 'bg-muted'} text-[11px] whitespace-nowrap`}>{r.zone}</Badge></TableCell>
                  {view === 'keuangan' && canFinance ? (
                    <>
                      <TableCell className="whitespace-normal break-words text-sm leading-relaxed" title={r.product_summary || ''}>{r.product_summary || '—'}</TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.penjualan)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.ongkir)} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground"><Money v={n(r.actual_shipping_fee)} /></TableCell>
                      <TableCell className="text-right text-sm text-emerald-600"><Money v={Math.round(n(r.actual_shipping_fee) * 0.4)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={r.selisih_ongkir} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground"><Money v={r.est_fee_admin} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.est_omset)} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground"><Money v={n(r.est_hpp)} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground"><Money v={n(r.est_fee_cs)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={n(r.est_gross_profit)} /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={r.act_gross_profit === null ? null : n(r.act_gross_profit)} bold /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={r.dicairkan === null ? null : n(r.dicairkan)} /></TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="whitespace-normal break-words text-sm">{r.customer_city || '—'}</TableCell>
                      <TableCell className="whitespace-normal break-words text-sm">{r.cs_name || '—'}</TableCell>
                      <TableCell className="whitespace-normal break-words text-sm">
                        {r.attribution_code_raw ? (
                          <div className="min-w-0">
                            <div className="truncate font-medium" title={r.attribution_code_raw}>{r.attribution_code_raw}</div>
                            {r.campaign_name && (
                              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="truncate" title={r.campaign_name}>{r.campaign_name}</span>
                                {r.campaign_platform && (
                                  <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-500/10 text-muted-foreground uppercase">{r.campaign_platform}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : r.campaign_name ? (
                          <div className="min-w-0">
                            <div className="text-muted-foreground/50">—</div>
                            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="truncate" title={r.campaign_name}>{r.campaign_name}</span>
                              {r.campaign_platform && (
                                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-500/10 text-muted-foreground uppercase">{r.campaign_platform}</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal break-words text-sm leading-relaxed" title={r.product_summary || ''}>{r.product_summary || '—'}</TableCell>
                      <TableCell className="text-center text-sm">{r.qty || '—'}</TableCell>
                      <TableCell className="text-sm">{r.payment_method || '—'}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{formatRupiah(n(r.penjualan))}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{r.tracking_no || r.resi || '—'}</TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {!loading && displayed.length > 0 && (
                <TableRow data-ledger-total className="bg-muted/50 font-semibold border-t-2 border-foreground/15">
                  {view === 'keuangan' && canFinance ? (
                    <>
                      <TableCell colSpan={5} className="text-sm">TOTAL HALAMAN ({totals.n.toLocaleString('id-ID')} order{zoneFilter ? ` · ${zoneFilter}` : ''})</TableCell>
                      <TableCell className="text-right text-sm"><Money v={totals.total} bold /></TableCell>
                      <TableCell /><TableCell /><TableCell /><TableCell /><TableCell /><TableCell /><TableCell /><TableCell />
                      <TableCell className="text-right text-sm"><Money v={totals.est_gp} bold /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={totals.act_gp} bold /></TableCell>
                      <TableCell className="text-right text-sm"><Money v={totals.dicair} bold /></TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell colSpan={10} className="text-sm">TOTAL HALAMAN ({totals.n.toLocaleString('id-ID')} order{zoneFilter ? ` · ${zoneFilter}` : ''})</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{formatRupiah(totals.total)}</TableCell>
                      <TableCell />
                    </>
                  )}
                </TableRow>
              )}
            </TableBody>
          </Table>
      </div>

      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <select aria-label="Jumlah order per halaman" value={pageSize} onChange={e => { resetToFirstPage(); setPageSize(Number(e.target.value)) }} className="h-8 rounded-md border bg-background px-2 text-sm">
              <option value={50}>50 / halaman</option>
              <option value={100}>100 / halaman</option>
              <option value={500}>500 / halaman</option>
              <option value={1000}>1000 / halaman</option>
            </select>
            <span className="text-muted-foreground tabular-nums">{displayed.length.toLocaleString('id-ID')} order · Hal {page + 1} / {totalPages}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹ Sebelumnya</Button>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Berikutnya ›</Button>
          </div>
        </div>
      )}

      <OrderDetailSheet source={detail?.source ?? null} id={detail?.id ?? null} onClose={() => setDetail(null)} />
    </div>
  )
}

function PnlRow({ label, est, act, strong, big, sub }: { label: string; est?: number; act?: number; strong?: boolean; big?: boolean; sub?: boolean }) {
  const cls = `${big ? 'text-base' : 'text-sm'} ${strong ? 'font-semibold' : sub ? 'text-muted-foreground' : ''}`
  const money = (v?: number) => {
    const x = Number(v) || 0
    return <span className={`whitespace-nowrap tabular-nums ${x < 0 ? 'text-red-600' : strong && x > 0 ? 'text-emerald-600' : ''}`}>{formatRupiah(x)}</span>
  }
  return (
    <>
      <div className={cls}>{label}</div>
      <div className={`text-right ${cls}`}>{money(est)}</div>
      <div className={`text-right ${cls}`}>{money(act)}</div>
    </>
  )
}
