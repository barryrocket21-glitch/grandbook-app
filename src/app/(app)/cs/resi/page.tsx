'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, PackageCheck, RefreshCw, Search, Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { spxFollowupReport } from '@/lib/cs-shipment-actions'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { formatRupiah } from '@/lib/format'

import { ShipmentContactActions, type ContactProgress } from '@/components/cs/shipment-contact-actions'

const supabase = createClient()

type CsResiRow = {
  id: number
  order_number: string
  order_date: string | null
  spx_created_at: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_city: string | null
  product_summary: string | null
  product_variation: string | null
  cod_amount: number | null
  tracking_no: string | null
  tracking_status: string | null
  delivered_at: string | null
  returned_at: string | null
  cs_name: string | null
  total_count: number
  delivered_count: number
  returned_count: number
  in_progress_count: number
  problem_count: number
  source: string
  delivery_group: string
  order_status: string
  reject_reason: string | null
  no_resi_count: number
}

type Summary = {
  total: number
  delivered: number
  returned: number
  inProgress: number
  problem: number
  noResi: number
}

function statusBadge(row: CsResiRow) {
  const status = row.tracking_status || (row.tracking_no ? 'Status belum tersedia' : 'Belum ada resi')
  if (row.delivery_group === 'delivered') return <Badge className="bg-emerald-600 hover:bg-emerald-600">{status}</Badge>
  if (row.delivery_group === 'returned' || row.delivery_group === 'problem') return <Badge variant="destructive">{status}</Badge>
  return <Badge variant="outline">{status}</Badge>
}

export default function CsResiPage() {
  const { role, loading: authLoading, profile } = useAuth()
  const [contacts, setContacts] = useState<Record<string, ContactProgress>>({})
  const [contactReadFailed, setContactReadFailed] = useState(false)
  const [rows, setRows] = useState<CsResiRow[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, delivered: 0, returned: 0, inProgress: 0, noResi: 0, problem: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 100
  const requestId = useRef(0)
  const [reportRow, setReportRow] = useState<CsResiRow | null>(null)
  const [note, setNote] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const report = reportRow ? spxFollowupReport(reportRow, note) : ''
  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report)
      setCopyStatus('Laporan disalin. Buka grup SPX, tinjau, lalu tempel dan kirim.')
    } catch {
      setCopyStatus('Belum bisa menyalin otomatis. Pilih teks laporan di bawah dan salin manual.')
    }
  }

  const load = useCallback(async () => {
    if (authLoading || role !== 'cs') return
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('list_my_cs_shipments', {
        p_from: dateFrom || null,
        p_to: dateTo || null,
        p_group: status || null,
        p_search: search.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      })
      if (currentRequest !== requestId.current) return
      if (rpcError) throw rpcError
      const loaded = (data || []) as CsResiRow[]
      const contactResult = loaded.length ? await supabase.from('cs_shipment_contacts')
        .select('order_number,wa_opened_at,contacted_at').in('order_number', loaded.map(r => r.order_number)) : { data: [], error: null }
      if (currentRequest !== requestId.current) return
      setContactReadFailed(!!contactResult.error)
      setContacts(Object.fromEntries((contactResult.data || []).map(c => [c.order_number, c])))
      setRows(loaded)
      setSummary({
        total: Number(loaded[0]?.total_count || 0),
        delivered: Number(loaded[0]?.delivered_count || 0),
        returned: Number(loaded[0]?.returned_count || 0),
        inProgress: Number(loaded[0]?.in_progress_count || 0),
        problem: Number(loaded[0]?.problem_count || 0),
        noResi: Number(loaded[0]?.no_resi_count || 0),
      })
    } catch (err) {
      if (currentRequest !== requestId.current) return
      setRows([])
      setError(err instanceof Error ? err.message : 'Gagal memuat resi CS. Coba Refresh.')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [authLoading, role, dateFrom, dateTo, status, search, page])

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 200)
    return () => {
      clearTimeout(timer)
      // Invalidate the current network response when filters or identity change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestId.current++
    }
  }, [load])

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>

  if (role !== 'cs') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 space-y-2">
          <div className="font-semibold">Khusus CS</div>
          <p className="text-sm text-muted-foreground">Halaman ini hanya untuk akun role CS. Owner/Admin tetap pakai Data Orderan.</p>
        </CardContent>
      </Card>
    )
  }

  const totalPages = Math.max(1, Math.ceil(summary.total / pageSize))

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Truck}
        title="Resi Saya"
        description={`Pantau resi FIX ORDER dan status pengiriman milik ${profile?.full_name || 'CS'} saja.`}
        actions={<Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>}
      />

      <p className="text-sm text-muted-foreground">Status adalah hasil sinkronisasi terakhir yang tersimpan. Refresh membaca ulang GrandBook; konfirmasi perkembangan terbaru ke customer atau SPX.</p>
      {!error && !loading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Total Resi</div><div className="text-2xl font-semibold">{summary.total.toLocaleString('id-ID')}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Delivered</div><div className="text-2xl font-semibold">{summary.delivered.toLocaleString('id-ID')}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><Truck className="w-3.5 h-3.5 text-sky-600" /> Dalam Proses</div><div className="text-2xl font-semibold">{summary.inProgress.toLocaleString('id-ID')}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-red-600" /> Return</div><div className="text-2xl font-semibold">{summary.returned.toLocaleString('id-ID')}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Belum Resi</div><div className="text-2xl font-semibold">{summary.noResi.toLocaleString('id-ID')}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Terkendala / proses retur</div><div className="text-2xl font-semibold">{summary.problem.toLocaleString('id-ID')}</div></CardContent></Card>
      </div>}

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="flex-1 min-w-[220px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={(e) => { setPage(0); setSearch(e.target.value) }} placeholder="Cari order, resi, customer, no HP, produk..." className="pl-9" />
            </div>
            <select aria-label="Status pengiriman" className="rounded-md border px-3 py-2 bg-background" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value) }}>
              <option value="">Semua status</option><option value="problem">Terkendala / proses retur</option><option value="progress">Dalam proses</option><option value="delivered">Delivered</option><option value="returned">Returned</option><option value="no_resi">Belum resi</option>
            </select>
            <label className="text-xs text-muted-foreground lg:w-40">Dari<Input type="date" value={dateFrom} onChange={(e) => { setPage(0); setDateFrom(e.target.value) }} /></label>
            <label className="text-xs text-muted-foreground lg:w-40">Sampai<Input type="date" value={dateTo} onChange={(e) => { setPage(0); setDateTo(e.target.value) }} /></label>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <Table>
            <TableHeader className="[&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:bg-card [&>tr>th]:z-10">
              <TableRow>
                <TableHead className="min-w-[150px]">GB Referensi</TableHead>
                <TableHead className="min-w-[140px]">Resi</TableHead>
                <TableHead className="min-w-[170px]">Status Resi</TableHead>
                <TableHead className="min-w-[180px]">Customer</TableHead>
                <TableHead className="min-w-[180px]">Produk</TableHead>
                <TableHead className="min-w-[150px]">Kota</TableHead>
                <TableHead className="min-w-[130px] text-right">COD</TableHead>
                <TableHead className="min-w-[125px]">Tanggal GB</TableHead>
                <TableHead className="min-w-[145px]">Tanggal SPX</TableHead>
                <TableHead className="min-w-[200px]">Tindak lanjut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={10}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>)
              ) : error ? (
                <TableRow><TableCell colSpan={10} className="py-8 text-center text-sm text-red-600">{error}</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="p-0"><EmptyState icon={PackageCheck} title="Belum ada resi" description="Kalau order CS ini sudah FIX ORDER / punya resi, datanya muncul di sini." /></TableCell></TableRow>
              ) : rows.map((row) => (
                <TableRow key={`${row.source}-${row.id}`}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{row.order_number}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{row.tracking_no || '-'}</TableCell>
                  <TableCell>{statusBadge(row)}<div className="text-xs text-muted-foreground mt-1">GB: {row.order_status}</div>{row.reject_reason && <p className="text-xs mt-1 max-w-64 whitespace-normal">{row.reject_reason}</p>}</TableCell>
                  <TableCell className="text-sm max-w-[180px] truncate" title={row.customer_name || ''}>{row.customer_name || '-'}<div className="text-xs text-muted-foreground">{row.customer_phone || 'Nomor belum tersedia'}</div></TableCell>
                  <TableCell className="text-sm max-w-[180px] truncate" title={row.product_summary || ''}>{row.product_summary || '-'}</TableCell>
                  <TableCell className="text-sm max-w-[150px] truncate" title={row.customer_city || ''}>{row.customer_city || '-'}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums whitespace-nowrap">{formatRupiah(Number(row.cod_amount || 0))}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{row.order_date || '-'}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{row.spx_created_at ? new Date(row.spx_created_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'}</TableCell>
                  <TableCell><div className="flex flex-col items-start gap-2">
                    <ShipmentContactActions row={row} progress={contacts[row.order_number]} readFailed={contactReadFailed} onSaved={(value) => setContacts(current => ({ ...current, [value.order_number]: value }))} />
                    <Button variant="outline" size="sm" disabled={!row.tracking_no} onClick={() => { setReportRow(row); setNote(''); setCopyStatus('') }}>Laporan SPX</Button>
                  </div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!reportRow} onOpenChange={(open) => { if (!open) setReportRow(null) }}>
        <DialogContent><DialogHeader><DialogTitle>Laporan untuk grup SPX</DialogTitle><DialogDescription>Tinjau laporan, salin, lalu tempel ke grup WhatsApp SPX. Laporan tidak dikirim otomatis.</DialogDescription></DialogHeader>
          <label className="text-sm">Catatan CS<Input value={note} maxLength={1000} onChange={(e) => { setNote(e.target.value); setCopyStatus('') }} placeholder="Hasil menghubungi customer / permintaan bantuan" /></label>
          <textarea aria-label="Isi laporan SPX" readOnly value={report} rows={10} className="w-full rounded-md border p-3 text-sm" onFocus={(e) => e.target.select()} />
          <Button onClick={copyReport}>Salin laporan</Button><p role="status" className="text-sm">{copyStatus}</p>
        </DialogContent>
      </Dialog>
      <div className="flex items-center justify-between text-sm">
        <div className="text-muted-foreground">Hal {page + 1} / {totalPages}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1 || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
