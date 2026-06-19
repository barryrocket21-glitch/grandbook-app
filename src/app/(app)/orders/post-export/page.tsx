'use client'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PackageCheck, Search, RefreshCw, ChevronUp, ChevronDown, Inbox } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { PageTabs } from '@/components/ui/page-tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { OrderDetailSheet } from '@/components/orders/order-detail-sheet'
import { formatRupiah } from '@/lib/format'
import type { OrderDraftEnriched } from '@/lib/types'

const KIRIM_TABS = [
  { label: 'Antrian Kerja', href: '/orders/draft' },
  { label: 'Export Ekspedisi', href: '/orders/export-resi' },
  { label: 'Post-Export', href: '/orders/post-export' },
]
const supabase = createClient()
const fmtShort = (d: string) => { const x = new Date(d); const p = (v: number) => String(v).padStart(2, '0'); return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${String(x.getFullYear()).slice(2)}` }
const FROZEN = [{ left: 0, width: 82 }, { left: 82, width: 148 }, { left: 230, width: 120 }, { left: 350, width: 110 }]
const fzTh = (i: number): CSSProperties => ({ position: 'sticky', top: 0, left: FROZEN[i].left, width: FROZEN[i].width, minWidth: FROZEN[i].width, maxWidth: FROZEN[i].width, zIndex: 30 })
const fzTd = (i: number): CSSProperties => ({ position: 'sticky', left: FROZEN[i].left, width: FROZEN[i].width, minWidth: FROZEN[i].width, maxWidth: FROZEN[i].width, zIndex: 20 })

type SortKey = 'exported_at' | 'order_number' | 'customer_name' | 'customer_city' | 'total' | 'cs_name'

export default function PostExportPage() {
  const [rows, setRows] = useState<OrderDraftEnriched[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('exported_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [zoneFilter, setZoneFilter] = useState<'ALL' | 'EXPORTED' | 'DIKIRIM' | 'TERKIRIM' | 'RETUR'>('ALL')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [detail, setDetail] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(false)
    try {
      const { data, error } = await supabase.rpc('list_orders_draft_enriched', {
        p_from: dateFrom || null, p_to: dateTo || null, p_status: null,
        p_search: search.trim() || null, p_limit: 5000, p_offset: 0, p_exported: true,
      }).range(0, 4999)
      if (error) throw error
      setRows((data || []) as OrderDraftEnriched[])
    } catch (e) { console.warn('post-export load failed:', e); setErr(true) } finally { setLoading(false) }
  }, [search, dateFrom, dateTo])
  useEffect(() => { load() }, [load])

  const zoneOf = (s: string): 'EXPORTED' | 'DIKIRIM' | 'TERKIRIM' | 'RETUR' =>
    s === 'DITERIMA' ? 'TERKIRIM' : s === 'RETUR' ? 'RETUR' : s === 'DIKIRIM' ? 'DIKIRIM' : 'EXPORTED'

  const sorted = useMemo(() => {
    const arr = rows.filter((r) => zoneFilter === 'ALL' || zoneOf(r.status) === zoneFilter)
    arr.sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      switch (sortKey) {
        case 'total': av = Number(a.total); bv = Number(b.total); break
        case 'exported_at': av = a.exported_at || ''; bv = b.exported_at || ''; break
        case 'order_number': av = a.order_number; bv = b.order_number; break
        case 'customer_name': av = a.customer_name || ''; bv = b.customer_name || ''; break
        case 'customer_city': av = a.customer_city || ''; bv = b.customer_city || ''; break
        case 'cs_name': av = a.cs_name || ''; bv = b.cs_name || ''; break
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir, zoneFilter])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paged = useMemo(() => sorted.slice(page * pageSize, (page + 1) * pageSize), [sorted, page, pageSize])
  useEffect(() => { setPage(0) }, [search, dateFrom, dateTo, zoneFilter, sortKey, sortDir, pageSize])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const SortHead = ({ k, label, align, style, frozen }: { k: SortKey; label: string; align?: 'right'; style?: CSSProperties; frozen?: boolean }) => (
    <TableHead className={`${align === 'right' ? 'text-right' : ''} ${frozen ? 'bg-card' : ''}`} style={style}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    </TableHead>
  )

  return (
    <div className="space-y-4">
      <PageTabs items={KIRIM_TABS} />
      <PageHeader icon={PackageCheck} title="Post-Export — Nunggu Resi"
        description="Order yang udah diexport ke ekspedisi, nunggu resi/status balik. Begitu resi masuk → pindah ke Arsip."
        actions={<Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>} />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari order# / customer / HP..." className="pl-9" />
          </div>
          <Select value={zoneFilter} onValueChange={(v) => v && setZoneFilter(v as typeof zoneFilter)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua status</SelectItem>
              <SelectItem value="EXPORTED">Sudah Diexport (nunggu jemput)</SelectItem>
              <SelectItem value="DIKIRIM">Dikirim (in transit)</SelectItem>
              <SelectItem value="TERKIRIM">Terkirim / Selesai</SelectItem>
              <SelectItem value="RETUR">Retur</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 text-xs" title="Tanggal dari" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 text-xs" title="Tanggal sampai" />
        </CardContent>
      </Card>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <Table>
            <TableHeader className="[&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:bg-card [&>tr>th]:z-10">
              <TableRow>
                <SortHead k="exported_at" label="Diexport" style={fzTh(0)} frozen />
                <SortHead k="order_number" label="Order#" style={fzTh(1)} frozen />
                <SortHead k="customer_name" label="Nama" style={fzTh(2)} frozen />
                <TableHead style={fzTh(3)} className="bg-card border-r" title="Status pengiriman">Status</TableHead>
                <TableHead title="Nomor resi ekspedisi">Resi</TableHead>
                <SortHead k="customer_city" label="Kota" />
                <TableHead title="Produk yang dipesan">Produk</TableHead>
                <SortHead k="total" label="Total" align="right" />
                <SortHead k="cs_name" label="CS" />
                <TableHead title="Ekspedisi / kurir">Kurir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={10}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : err ? (
                <TableRow><TableCell colSpan={10} className="py-10 text-center text-sm text-red-600">⚠️ Gagal memuat data — klik Refresh.</TableCell></TableRow>
              ) : sorted.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="p-0"><EmptyState icon={Inbox} title="Belum ada order diexport" description="Order yang udah di-generate ke file ekspedisi bakal muncul di sini." /></TableCell></TableRow>
              ) : (
                paged.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetail(r.id)}>
                    <TableCell style={fzTd(0)} className="bg-card text-sm whitespace-nowrap">{r.exported_at ? fmtShort(r.exported_at) : '—'}</TableCell>
                    <TableCell style={fzTd(1)} className="bg-card font-mono text-xs whitespace-nowrap overflow-hidden">{r.order_number}</TableCell>
                    <TableCell style={fzTd(2)} className="bg-card text-sm font-medium truncate" title={r.customer_name || ''}>{r.customer_name || '—'}</TableCell>
                    <TableCell style={fzTd(3)} className="bg-card border-r">
                      {(() => {
                        const map: Record<string, { label: string; cls: string }> = {
                          DITERIMA: { label: 'Terkirim', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
                          RETUR: { label: 'Retur', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
                          DIKIRIM: { label: 'Dikirim', cls: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30' },
                          PROBLEM: { label: 'Problem', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
                        }
                        const m = map[r.status] || { label: 'Sudah Diexport', cls: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30' }
                        return <Badge variant="outline" className={`${m.cls} text-[10px] whitespace-nowrap`}>{m.label}</Badge>
                      })()}
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.tracking_no || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">{r.customer_city || '—'}</TableCell>
                    <TableCell className="text-sm max-w-[220px]"><span className="truncate inline-block max-w-full align-middle" title={r.product_summary || ''}>{r.product_summary || '—'}</span></TableCell>
                    <TableCell className="text-sm text-right tabular-nums whitespace-nowrap">{formatRupiah(Number(r.total))}</TableCell>
                    <TableCell className="text-sm">{r.cs_name || '—'}</TableCell>
                    <TableCell className="text-sm">{r.exported_channel_name || r.channel_name || '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {!loading && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2 text-sm">
              <option value={50}>50 / halaman</option>
              <option value={100}>100 / halaman</option>
              <option value={500}>500 / halaman</option>
              <option value={1000}>1000 / halaman</option>
            </select>
            <span className="text-muted-foreground tabular-nums">{sorted.length.toLocaleString('id-ID')} order · Hal {page + 1} / {totalPages}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹ Prev</Button>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next ›</Button>
          </div>
        </div>
      )}

      <OrderDetailSheet source={detail !== null ? 'draft' : null} id={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
