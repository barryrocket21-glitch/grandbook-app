'use client'

import { jakartaDateString } from '@/lib/date/jakarta'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import { formatRupiah, formatNumber, formatDate } from '@/lib/format'
import { isSandboxMode, loadSandboxOrders, type SandboxOrder } from '@/lib/sandbox-orders'
import { Database, RefreshCw, Search, PackageCheck, AlertTriangle, Download } from 'lucide-react'
import type { FulfillmentCategory } from '@/lib/types'
import { buildDataOrderExportRpcParams } from '@/lib/orders/data-order-export-params'

const supabase = createClient()

type CategoryFilter = 'ALL' | FulfillmentCategory

type DataOrderRow = {
  id: number
  order_number: string
  order_date: string
  spx_created_at?: string | null
  status: string
  fulfillment_category: FulfillmentCategory | null
  customer_name: string | null
  payment_method?: string | null
  customer_phone: string | null
  customer_city: string | null
  cs_name: string | null
  attribution_code_raw: string | null
  product_summary: string | null
  product_variation?: string | null
  total: number | null
  cod_amount: number | null
  tracking_no: string | null
  tracking_status: string | null
  exported_at: string | null
  channel_name: string | null
  export_batch_label?: string | null
  total_count: number
  fix_count?: number
  non_coverage_count?: number
  pending_count?: number
}

function mapSandboxCategory(row: SandboxOrder): FulfillmentCategory {
  if (row.fulfillmentCategory === 'FIX_ORDER') return 'FIX_ORDER'
  return 'GB_NO_RESI'
}

function mapSandboxRows(rows: SandboxOrder[], totalCount: number): DataOrderRow[] {
  return rows.map((row, index) => ({
    id: index + 1,
    order_number: row.orderNumber,
    order_date: row.orderDate,
    spx_created_at: row.spxCreatedAt,
    status: row.fulfillmentCategory,
    fulfillment_category: mapSandboxCategory(row),
    customer_name: row.customerName,
    payment_method: 'COD',
    customer_phone: row.customerPhone,
    customer_city: row.city,
    cs_name: row.csName,
    attribution_code_raw: row.attributionCodeRaw,
    product_summary: row.productName,
    product_variation: row.variation,
    total: row.total,
    cod_amount: row.codAmount,
    tracking_no: row.trackingNo,
    tracking_status: row.trackingStatus,
    exported_at: row.exportedAt,
    channel_name: 'SANDBOX',
    export_batch_label: row.exportBatchLabel,
    total_count: totalCount,
  }))
}

const CATEGORY_TABS: Array<{ value: CategoryFilter; label: string }> = [
  { value: 'ALL', label: 'Semua Data' },
  { value: 'FIX_ORDER', label: 'GB Dengan Resi' },
  { value: 'GB_NO_RESI', label: 'GB Belum Ada Resi' },
]

type DataOrderSummary = {
  total: number
  fix: number
  nonCoverage: number
  pending: number
  spxCreated: number
  resi: number
  trackingStatus: number
  missingSpxCreated: number
  missingResi: number
  missingTrackingStatus: number
}



function hasValue(value: unknown) {
  return String(value ?? '').trim() !== ''
}

function computeSpxFieldMetrics(metricRows: DataOrderRow[], base: Pick<DataOrderSummary, 'total' | 'fix' | 'nonCoverage' | 'pending'>): DataOrderSummary {
  const spxCreated = metricRows.filter((row) => hasValue(row.spx_created_at)).length
  const resi = metricRows.filter((row) => hasValue(row.tracking_no)).length
  const trackingStatus = metricRows.filter((row) => hasValue(row.tracking_status)).length
  return {
    ...base,
    spxCreated,
    resi,
    trackingStatus,
    missingSpxCreated: Math.max(0, base.total - spxCreated),
    missingResi: Math.max(0, base.total - resi),
    missingTrackingStatus: Math.max(0, base.total - trackingStatus),
  }
}

const XLS_HEADERS = [
  'Tanggal Terbit GB',
  'Tanggal Create SPX',
  'GB Referensi',
  'Resi',
  'Tracking Status',
  'Customer',
  'Produk',
  'Varian Produk',
  'Kode Atribusi',
  'Jenis Transaksi',
  'Nilai COD',
  'Nama CS',
  'Kategori Resi',
]

function escapeXls(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function downloadDataOrdersXls(exportRows: DataOrderRow[]) {
  const bodyRows = exportRows.map((row) => [
    row.order_date || '',
    row.spx_created_at ? jakartaDateString(new Date(row.spx_created_at)) : '',
    row.order_number,
    row.tracking_no || '',
    row.tracking_status || '',
    row.customer_name || '',
    row.product_summary || '',
    row.product_variation || '',
    row.attribution_code_raw || '',
    row.payment_method || 'COD',
    Number(row.cod_amount ?? row.total ?? 0),
    row.cs_name || '',
    row.tracking_no?.trim() ? 'GB Dengan Resi' : 'GB Belum Ada Resi',
  ])
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr>${XLS_HEADERS.map((h) => `<th>${escapeXls(h)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeXls(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
  const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  a.href = url
  a.download = `data-orderan-${stamp}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function DataOrderanPage() {
  const [rows, setRows] = useState<DataOrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<CategoryFilter>('ALL')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('q')
    // Hydrate the external URL after SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (query) setSearch(query)
  }, [])
  const [gbDateFrom, setGbDateFrom] = useState('')
  const [gbDateTo, setGbDateTo] = useState('')
  const [spxDateFrom, setSpxDateFrom] = useState('')
  const [spxDateTo, setSpxDateTo] = useState('')
  const [page, setPage] = useState(0)
  const [summary, setSummary] = useState<DataOrderSummary | null>(null)
  const [rowTotal, setRowTotal] = useState(0)
  const [exportingXls, setExportingXls] = useState(false)
  const pageSize = 100

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSummary(null)
    try {
      if (isSandboxMode()) {
        const allSandbox = loadSandboxOrders()
        const filtered = allSandbox.filter((row) => {
          const mappedCategory = mapSandboxCategory(row)
          if (category !== 'ALL' && mappedCategory !== category) return false
          if (gbDateFrom && row.orderDate < gbDateFrom) return false
          if (gbDateTo && row.orderDate > gbDateTo) return false
          if (mappedCategory === 'FIX_ORDER') {
            if (spxDateFrom && (!row.spxCreatedAt || row.spxCreatedAt.slice(0, 10) < spxDateFrom)) return false
            if (spxDateTo && (!row.spxCreatedAt || row.spxCreatedAt.slice(0, 10) > spxDateTo)) return false
          }
          const needle = search.trim().toLowerCase()
          if (!needle) return true
          return [
            row.orderNumber,
            row.trackingNo,
            row.customerName,
            row.customerPhone,
            row.csName,
            row.attributionCodeRaw,
            row.productName,
            row.exportBatchLabel,
          ].some((value) => String(value ?? '').toLowerCase().includes(needle))
        })
        const paged = filtered.slice(page * pageSize, page * pageSize + pageSize)
        setRows(mapSandboxRows(paged, filtered.length))
        const sandboxBase = {
          total: filtered.length,
          fix: filtered.filter((r) => {
            if (r.fulfillmentCategory !== 'FIX_ORDER') return false
            if (spxDateFrom && (!r.spxCreatedAt || r.spxCreatedAt.slice(0, 10) < spxDateFrom)) return false
            if (spxDateTo && (!r.spxCreatedAt || r.spxCreatedAt.slice(0, 10) > spxDateTo)) return false
            return true
          }).length,
          nonCoverage: filtered.filter((r) => r.fulfillmentCategory === 'GB_NO_RESI').length,
          pending: filtered.filter((r) => r.fulfillmentCategory === 'GB_NO_RESI').length,
        }
        setSummary(computeSpxFieldMetrics(mapSandboxRows(filtered, filtered.length), sandboxBase))
        return
      }

      const { data, error: rpcError } = await supabase.rpc('list_data_orders', {
        p_from: null,
        p_to: null,
        p_category: category === 'ALL' ? null : category,
        p_search: search.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
        p_date_basis: 'order_date',
        p_gb_from: gbDateFrom || null,
        p_gb_to: gbDateTo || null,
        p_spx_from: spxDateFrom || null,
        p_spx_to: spxDateTo || null,
      })
      if (rpcError) throw rpcError
      const loaded = (data || []) as DataOrderRow[]
      const { data: snapshot, error: summaryError } = await supabase.rpc('operations_data_order_snapshot', {
        p_category: category === 'ALL' ? null : category,
        p_search: search.trim() || null,
        p_gb_from: gbDateFrom || null, p_gb_to: gbDateTo || null,
        p_spx_from: spxDateFrom || null, p_spx_to: spxDateTo || null,
        p_include_rows: false,
      })
      if (summaryError) throw summaryError
      setRows(loaded)
      setRowTotal(Number(snapshot.summary.total))
      setSummary(snapshot.summary as DataOrderSummary)
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Gagal memuat Data Orderan'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [category, gbDateFrom, gbDateTo, page, search, spxDateFrom, spxDateTo])

  useEffect(() => {
    // Existing GrandBook pages use effect-driven RPC loading; keep this page consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, gbDateFrom, gbDateTo, page, search, spxDateFrom, spxDateTo])

  const totalCount = rowTotal || rows[0]?.total_count || 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const handleDownloadXls = async () => {
    setExportingXls(true)
    try {
      if (isSandboxMode()) {
        const allSandbox = loadSandboxOrders()
        const filtered = allSandbox.filter((row) => {
          const mappedCategory = mapSandboxCategory(row)
          if (category !== 'ALL' && mappedCategory !== category) return false
          if (gbDateFrom && row.orderDate < gbDateFrom) return false
          if (gbDateTo && row.orderDate > gbDateTo) return false
          if (mappedCategory === 'FIX_ORDER') {
            if (spxDateFrom && (!row.spxCreatedAt || row.spxCreatedAt.slice(0, 10) < spxDateFrom)) return false
            if (spxDateTo && (!row.spxCreatedAt || row.spxCreatedAt.slice(0, 10) > spxDateTo)) return false
          }
          const needle = search.trim().toLowerCase()
          if (!needle) return true
          return [row.orderNumber, row.trackingNo, row.customerName, row.customerPhone, row.csName, row.attributionCodeRaw, row.productName, row.exportBatchLabel]
            .some((value) => String(value ?? '').toLowerCase().includes(needle))
        })
        downloadDataOrdersXls(mapSandboxRows(filtered, filtered.length))
        return
      }

      const params = buildDataOrderExportRpcParams({ category, search, gbDateFrom, gbDateTo, spxDateFrom, spxDateTo })
      const { data: snapshot, error: rpcError } = await supabase.rpc('operations_data_order_snapshot', {
        p_category: params.p_category, p_search: params.p_search,
        p_gb_from: params.p_gb_from, p_gb_to: params.p_gb_to,
        p_spx_from: params.p_spx_from, p_spx_to: params.p_spx_to,
        p_include_rows: false,
      })
      if (rpcError) throw rpcError
      const expected = Number(snapshot?.summary?.total)
      if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Jumlah data belum tersedia. Coba lagi.')
      const exportRows: DataOrderRow[] = []
      const seen = new Set<string>()
      const batchSize = 1000
      for (let offset = 0; offset < expected; offset += batchSize) {
        const { data: batch, error: batchError } = await supabase.rpc('list_data_orders', {
          ...params, p_limit: batchSize, p_offset: offset,
        })
        if (batchError) throw batchError
        if (!Array.isArray(batch) || batch.length !== Math.min(batchSize, expected - offset)) throw new Error('Data berubah saat download. Coba lagi.')
        for (const row of batch as DataOrderRow[]) {
          const key = `${row.order_number}:${row.id}`
          if (Number(row.total_count) !== expected || seen.has(key)) throw new Error('Data berubah saat download. Coba lagi.')
          seen.add(key)
          exportRows.push(row)
        }
      }
      const { data: check, error: checkError } = await supabase.rpc('operations_data_order_snapshot', {
        p_category: params.p_category, p_search: params.p_search,
        p_gb_from: params.p_gb_from, p_gb_to: params.p_gb_to,
        p_spx_from: params.p_spx_from, p_spx_to: params.p_spx_to, p_include_rows: false,
      })
      if (checkError) throw checkError
      if (Number(check?.summary?.total) !== expected) throw new Error('Data berubah saat download. Coba lagi.')
      downloadDataOrdersXls(exportRows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal download XLS')
    } finally {
      setExportingXls(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={Database}
        title="Data Order"
        description={isSandboxMode()
          ? 'Mode testing: Data Orderan membaca data sandbox browser, bukan database live GrandBook.'
          : 'Pantau referensi order, atribusi, resi, dan status pengiriman dalam satu tabel.'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleDownloadXls} disabled={loading || exportingXls} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> {exportingXls ? 'Menyiapkan XLS…' : 'Ekspor XLS'}
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
          </div>
        )}
      />

      <Card>
        <CardContent className="flex min-w-0 flex-col gap-4 py-0">
          <div className="flex flex-wrap gap-2">
            {CATEGORY_TABS.map((tab) => (
              <Button
                key={tab.value}
                type="button"
                size="sm"
                variant={category === tab.value ? 'default' : 'outline'}
                aria-pressed={category === tab.value}
                onClick={() => setCategory(tab.value)}
              >
                {tab.value === 'FIX_ORDER' && <PackageCheck className="w-3.5 h-3.5 mr-1" />}
                {tab.value === 'GB_NO_RESI' && <AlertTriangle className="w-3.5 h-3.5 mr-1" />}
                {tab.label}
              </Button>
            ))}
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="relative col-span-2 min-w-0 xl:col-span-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari order, resi, pelanggan, CS, atau kode atribusi" placeholder="Cari order, resi, pelanggan, CS, atau kode atribusi…" className="pl-9" />
            </div>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">Tanggal order · dari<Input type="date" value={gbDateFrom} onChange={(e) => setGbDateFrom(e.target.value)} /></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">Tanggal order · sampai<Input type="date" value={gbDateTo} onChange={(e) => setGbDateTo(e.target.value)} /></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">Tanggal SPX · dari<Input type="date" value={spxDateFrom} onChange={(e) => setSpxDateFrom(e.target.value)} /></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">Tanggal SPX · sampai<Input type="date" value={spxDateTo} onChange={(e) => setSpxDateTo(e.target.value)} /></label>
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground">
            Filter tanggal order untuk daftar. Saat tanggal SPX diisi, ekspor mengikuti periode SPX; order tanpa resi tetap mengikuti tanggal order.
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard className="col-span-2 sm:col-span-1" label="Total order" value={summary?.total ?? '—'} sub="Sesuai filter yang aktif" />
            <StatCard label="Sudah ada resi" value={summary?.fix ?? '—'} />
            <StatCard label="Belum ada resi" value={summary?.nonCoverage ?? '—'} />
          </div>
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">Kelengkapan data SPX</summary>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ['Tanggal SPX', summary?.spxCreated, summary?.missingSpxCreated],
                ['Nomor resi', summary?.resi, summary?.missingResi],
                ['Status pengiriman', summary?.trackingStatus, summary?.missingTrackingStatus],
              ].map(([label, filled, missing]) => (
                <div key={String(label)} className="min-w-0 leading-relaxed">
                  <p className="font-medium">{label}</p>
                  <p className="text-muted-foreground">Terisi: {filled == null ? '—' : formatNumber(Number(filled))} · Kosong: {missing == null ? '—' : formatNumber(Number(missing))}</p>
                </div>
              ))}
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-4 py-3 text-xs text-muted-foreground">Geser tabel untuk melihat semua kolom. Teks panjang dapat dibaca lewat judul sel.</div>
          <Table className="table-fixed" style={{ width: 2090 }} containerClassName="max-h-[65vh]" containerLabel="Tabel Data Order, geser untuk melihat semua kolom">
            <colgroup>{[135, 135, 190, 190, 180, 210, 240, 150, 210, 120, 180, 150].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
            <TableHeader className="[&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:bg-card [&>tr>th]:z-10">
              <TableRow>
                <TableHead className="min-w-[125px]">Tanggal Terbit GB</TableHead>
                <TableHead className="min-w-[145px]">Tanggal Create SPX</TableHead>
                <TableHead className="min-w-[150px]">GB Referensi</TableHead>
                <TableHead className="min-w-[140px]">Resi</TableHead>
                <TableHead className="min-w-[170px]">Tracking Status</TableHead>
                <TableHead className="min-w-[180px]">Customer</TableHead>
                <TableHead className="min-w-[180px]">Produk</TableHead>
                <TableHead className="min-w-[150px]">Varian Produk</TableHead>
                <TableHead className="min-w-[190px]">Kode Atribusi</TableHead>
                <TableHead className="min-w-[130px]">Jenis Transaksi</TableHead>
                <TableHead className="min-w-[130px] text-right">Nilai COD</TableHead>
                <TableHead className="min-w-[110px]">Nama CS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={12}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : error ? (
                <TableRow><TableCell colSpan={12} className="py-8 text-center text-sm text-red-600">{error}</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="p-0"><EmptyState icon={Database} title="Belum ada data" description="Order muncul di sini setelah valid dan diexport dari GrandBook." /></TableCell></TableRow>
              ) : rows.map((row) => (
                <TableRow key={`${row.order_number}-${row.id}`}>
                  <TableCell className="text-sm whitespace-nowrap">{row.order_date ? formatDate(row.order_date) : '—'}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{row.spx_created_at ? formatDate(row.spx_created_at) : '—'}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{row.order_number}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{row.tracking_no || '—'}</TableCell>
                  <TableCell className="whitespace-normal break-words text-sm leading-relaxed" title={row.tracking_status || ''}>{row.tracking_status || '—'}</TableCell>
                  <TableCell className="whitespace-normal break-words text-sm leading-relaxed" title={row.customer_name || ''}>{row.customer_name || '—'}</TableCell>
                  <TableCell className="whitespace-normal break-words text-sm leading-relaxed" title={row.product_summary || ''}>{row.product_summary || '—'}</TableCell>
                  <TableCell className="whitespace-normal break-words text-sm leading-relaxed" title={row.product_variation || ''}>{row.product_variation || '—'}</TableCell>
                  <TableCell className="whitespace-normal break-words font-mono text-xs leading-relaxed" title={row.attribution_code_raw || ''}>{row.attribution_code_raw || '—'}</TableCell>
                  <TableCell className="text-sm">{row.payment_method || 'COD'}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums whitespace-nowrap">{formatRupiah(Number(row.cod_amount ?? row.total ?? 0))}</TableCell>
                  <TableCell className="whitespace-normal break-words text-sm">{row.cs_name || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="text-muted-foreground">Halaman {formatNumber(page + 1)} dari {formatNumber(totalPages)}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>Sebelumnya</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1 || loading} onClick={() => setPage((p) => p + 1)}>Berikutnya</Button>
        </div>
      </div>
    </div>
  )
}
