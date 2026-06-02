'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PackageCheck, Search, RefreshCw, ChevronUp, ChevronDown, Inbox } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah, formatDate } from '@/lib/format'
import type { OrderDraftEnriched } from '@/lib/types'

const supabase = createClient()

type SortKey = 'exported_at' | 'order_number' | 'customer_name' | 'customer_city' | 'total' | 'cs_name'

/**
 * Brief #11 — Tabel Post-Export (SATU tampilan, ala spreadsheet). Semua order
 * yang udah diexport (exported_at NOT NULL), nunggu resi. Status sekarang baru
 * "Sudah Diexport"; #13 nambah Dikirim/Delivered/Retur dari sync. Sortable.
 */
export default function PostExportPage() {
  const [rows, setRows] = useState<OrderDraftEnriched[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('exported_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // Brief #13 — "Arsip/Selesai" = filter status Terkirim di sini (bukan view pisah).
  const [zoneFilter, setZoneFilter] = useState<'ALL' | 'EXPORTED' | 'DIKIRIM' | 'TERKIRIM' | 'RETUR'>('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('list_orders_draft_enriched', {
        p_from: dateFrom || null,
        p_to: dateTo || null,
        p_status: null,
        p_search: search.trim() || null,
        p_limit: 500,
        p_offset: 0,
        p_exported: true,  // Brief #11 — zona Post-Export
      })
      if (error) throw error
      setRows((data || []) as OrderDraftEnriched[])
    } catch (err) {
      console.warn('post-export load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [search, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  // Map status enum → zona seragam (sesuai badge + #13)
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

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const SortHead = ({ k, label, align }: { k: SortKey; label: string; align?: 'right' }) => (
    <TableHead className={align === 'right' ? 'text-right' : ''}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    </TableHead>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        icon={PackageCheck}
        title="Post-Export — Nunggu Resi"
        description="Order yang udah diexport ke ekspedisi, nunggu resi/status balik. Begitu resi masuk → pindah ke Arsip."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      />

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
          <span className="text-xs text-muted-foreground self-center ml-auto">{sorted.length} / {rows.length} order</span>
        </CardContent>
      </Card>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="exported_at" label="Diexport" />
                <SortHead k="order_number" label="Order#" />
                <TableHead>Status</TableHead>
                <TableHead>Resi</TableHead>
                <SortHead k="customer_name" label="Customer" />
                <SortHead k="customer_city" label="Kota" />
                <TableHead>Produk</TableHead>
                <SortHead k="total" label="Total" align="right" />
                <SortHead k="cs_name" label="CS" />
                <TableHead>Kurir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={10}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="p-0">
                    <EmptyState icon={Inbox} title="Belum ada order diexport" description="Order yang udah di-generate ke file ekspedisi bakal muncul di sini." />
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{r.exported_at ? formatDate(r.exported_at) : '—'}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.order_number}</TableCell>
                    <TableCell>
                      {(() => {
                        // Brief #13 — status seragam dari sync. Sebelum sync = Sudah Diexport.
                        const map: Record<string, { label: string; cls: string }> = {
                          DITERIMA: { label: 'Terkirim', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
                          RETUR: { label: 'Retur', cls: 'bg-orange-500/10 text-orange-600 border-orange-500/30' },
                          DIKIRIM: { label: 'Dikirim', cls: 'bg-purple-500/10 text-purple-600 border-purple-500/30' },
                          PROBLEM: { label: 'Problem', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
                        }
                        const m = map[r.status] || { label: 'Sudah Diexport', cls: 'bg-blue-500/10 text-blue-600 border-blue-500/30' }
                        return <Badge variant="outline" className={`${m.cls} text-[10px] whitespace-nowrap`}>{m.label}</Badge>
                      })()}
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {r.tracking_no || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{r.customer_name}</TableCell>
                    <TableCell className="text-xs">{r.customer_city || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[220px]">
                      <span className="truncate inline-block max-w-full align-middle" title={r.product_summary || ''}>{r.product_summary || '—'}</span>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums whitespace-nowrap">{formatRupiah(Number(r.total))}</TableCell>
                    <TableCell className="text-xs">{r.cs_name || '—'}</TableCell>
                    <TableCell className="text-xs">{r.exported_channel_name || r.channel_name || '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
