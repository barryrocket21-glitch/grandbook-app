'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BookOpen, Loader2, Search, RefreshCw, ArrowUpDown } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah, formatDate } from '@/lib/format'

const supabase = createClient()

interface Row {
  source: string; id: number; order_number: string; order_date: string
  status: string; zone: string; customer_name: string; customer_city: string | null
  cs_name: string | null; channel_name: string | null; product_summary: string | null
  total: number; cod_amount: number | null; tracking_no: string | null; resi: string | null
  delivered_at: string | null; returned_at: string | null; exported_at: string | null
  total_count: number
}

// Brief #13 — SATU TAMPILAN PEMBUKUAN. Union orders_draft (jalan) + orders
// (terminal) jadi satu tabel; status = kolom sortable/filterable. Promote gak
// bikin order ilang — cuma pindah status (DITERIMA/RETUR/CANCEL).
const STATUSES = ['BARU', 'SIAP_KIRIM', 'DIKIRIM', 'PROBLEM', 'DITERIMA', 'RETUR', 'CANCEL', 'FAKE']
const ZONE_COLOR: Record<string, string> = {
  Baru: 'bg-zinc-500/10 text-zinc-500', Antrian: 'bg-sky-500/10 text-sky-600',
  'Nunggu Resi': 'bg-amber-500/10 text-amber-600', Dikirim: 'bg-indigo-500/10 text-indigo-500',
  Problem: 'bg-orange-500/10 text-orange-600', 'Arsip (Delivered)': 'bg-emerald-500/10 text-emerald-600',
  Retur: 'bg-rose-500/10 text-rose-600', Batal: 'bg-zinc-500/10 text-zinc-400', Fake: 'bg-red-500/10 text-red-600',
}
type SortKey = 'order_date' | 'order_number' | 'status' | 'customer_name' | 'cs_name' | 'total'

export default function PembukuanPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('order_date')
  const [sortAsc, setSortAsc] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('list_pembukuan', {
        p_status: status === 'all' ? null : status,
        p_search: search.trim() || null,
        p_limit: 1000, p_offset: 0,
      })
      if (error) throw error
      setRows((data || []) as Row[])
    } catch (err) { console.warn('pembukuan load:', err) } finally { setLoading(false) }
  }, [status, search])
  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
    return arr
  }, [rows, sortKey, sortAsc])

  const total = rows[0]?.total_count ?? rows.length
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) m[r.zone] = (m[r.zone] || 0) + 1
    return m
  }, [rows])

  const toggleSort = (k: SortKey) => { if (k === sortKey) setSortAsc(s => !s); else { setSortKey(k); setSortAsc(false) } }
  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={`cursor-pointer select-none ${className || ''}`} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{children}<ArrowUpDown className={`w-3 h-3 ${sortKey === k ? 'text-violet-500' : 'text-muted-foreground/40'}`} /></span>
    </TableHead>
  )

  return (
    <div className="space-y-4">
      <PageHeader icon={BookOpen} title="Pembukuan (Satu Tampilan)"
        description="Semua order — apapun statusnya — dalam satu tabel. Sort & filter by status/tanggal/CS/produk. Order yang udah delivered/retur/batal tetap di sini (pindah status, bukan ilang)." />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari order# / customer..." className="pl-9" />
          </div>
          <Select value={status} onValueChange={v => setStatus(v || 'all')}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Semua status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
          <Badge variant="outline" className="ml-auto">{total} order</Badge>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([z, n]) => (
          <Badge key={z} variant="outline" className={`${ZONE_COLOR[z] || 'bg-muted'} text-[11px]`}>{z}: {n}</Badge>
        ))}
      </div>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <Th k="order_date">Tanggal</Th><Th k="order_number">Order#</Th><Th k="status">Status</Th>
              <TableHead>Zona</TableHead><Th k="customer_name">Customer</Th><TableHead>Kota</TableHead>
              <Th k="cs_name">CS</Th><TableHead>Produk</TableHead><Th k="total" className="text-right">Total</Th>
              <TableHead>Resi/Tracking</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : sorted.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">Belum ada order.</TableCell></TableRow>
              ) : sorted.map(r => (
                <TableRow key={`${r.source}-${r.id}`}>
                  <TableCell className="text-xs whitespace-nowrap">{formatDate(r.order_date)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.order_number}</TableCell>
                  <TableCell className="text-[11px] font-medium">{r.status}</TableCell>
                  <TableCell><Badge variant="outline" className={`${ZONE_COLOR[r.zone] || 'bg-muted'} text-[10px]`}>{r.zone}</Badge></TableCell>
                  <TableCell className="text-xs">{r.customer_name}</TableCell>
                  <TableCell className="text-xs">{r.customer_city || '—'}</TableCell>
                  <TableCell className="text-xs">{r.cs_name || '—'}</TableCell>
                  <TableCell className="text-xs max-w-[220px] truncate" title={r.product_summary || ''}>{r.product_summary || '—'}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatRupiah(Number(r.total))}</TableCell>
                  <TableCell className="font-mono text-[10px]">{r.tracking_no || r.resi || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
