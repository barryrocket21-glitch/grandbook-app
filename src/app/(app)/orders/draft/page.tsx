'use client'
import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Inbox, Plus, Search, Filter, ChevronLeft, ChevronRight, RefreshCw, Truck,
  Trash2, AlertTriangle, Loader2, X, Wand2, MapPin, CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { formatRupiah, formatDate } from '@/lib/format'
import type {
  OrderDraftEnriched, DraftOrderStatus, DraftStatusStat, OrderStatus,
} from '@/lib/types'
import { fetchRiskByPhones, toCanonicalPhone } from '@/lib/supabase/queries/customers'
import type { CustomerRiskTier } from '@/lib/types'
import { DraftStatusStatsBar } from './_components/draft-status-stats-bar'
import { ResiInputDialog } from './_components/resi-input-dialog'
import { DraftRowActions } from './_components/draft-row-actions'
import { BulkResiDialog } from './_components/bulk-resi-dialog'
import { DraftQuickEditDialog } from './_components/draft-quick-edit-dialog'
import { BenerinAlamatDialog } from './_components/benerin-alamat-dialog'

const supabase = createClient()
const PAGE_SIZE = 100

export default function OrdersDraftPage() {
  return (
    <Suspense fallback={
      <div className="space-y-6"><PageHeader icon={Inbox} title="Antrian Kerja" /></div>
    }>
      <OrdersDraftInner />
    </Suspense>
  )
}

function OrdersDraftInner() {
  const { user, profile, role } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialStatus = (searchParams.get('status') || 'ALL') as 'ALL' | DraftOrderStatus
  const canExport = role === 'owner' || role === 'admin'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | DraftOrderStatus>(initialStatus)
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<OrderDraftEnriched[]>([])
  // Brief #1 — reputasi per nomor (canonical "8xxx") utk quality flag "Customer Risk"
  const [riskByPhone, setRiskByPhone] = useState<Map<string, { tier: CustomerRiskTier; blacklisted: boolean }>>(new Map())
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusStats, setStatusStats] = useState<DraftStatusStat[]>([])
  const [statusStatsTotal, setStatusStatsTotal] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)
  // Brief #7 PART 2 — kesiapan JUJUR se-filter (wilayah_id sumber tunggal)
  const [readiness, setReadiness] = useState<{ ready: number; not_ready: number; total: number }>({ ready: 0, not_ready: 0, total: 0 })
  const [benerinOpen, setBenerinOpen] = useState(false)

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkResiOpen, setBulkResiOpen] = useState(false)
  const canBulkDelete = role === 'owner' || role === 'admin'
  const canSetResi = role === 'owner' || role === 'admin' || role === 'cs'

  // Resi input dialog state
  const [resiDialogOpen, setResiDialogOpen] = useState(false)
  const [resiDialogDraft, setResiDialogDraft] = useState<OrderDraftEnriched | null>(null)

  const loadDrafts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [listResp, statsResp, readyResp] = await Promise.all([
        supabase.rpc('list_orders_draft_enriched', {
          p_from: dateFrom || null,
          p_to: dateTo || null,
          p_status: statusFilter === 'ALL' ? null : statusFilter,
          p_search: search.trim() || null,
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        }),
        supabase.rpc('get_draft_status_stats', {
          p_from: dateFrom || null,
          p_to: dateTo || null,
          p_search: search.trim() || null,
        }),
        supabase.rpc('get_draft_readiness_stats', {
          p_from: dateFrom || null,
          p_to: dateTo || null,
          p_status: statusFilter === 'ALL' ? null : statusFilter,
          p_search: search.trim() || null,
        }),
      ])
      if (listResp.error) throw listResp.error
      const rs = (listResp.data || []) as OrderDraftEnriched[]
      setRows(rs)
      setTotalCount(rs[0]?.total_count ? Number(rs[0].total_count) : 0)
      // Enrich reputasi (fire-and-forget; gagal = map kosong, flag tidak muncul)
      fetchRiskByPhones(supabase, rs.map((r) => r.customer_phone)).then(setRiskByPhone)

      if (statsResp.error) {
        console.warn('get_draft_status_stats failed:', statsResp.error)
      } else {
        const stats = (statsResp.data || []) as DraftStatusStat[]
        setStatusStats(stats)
        setStatusStatsTotal(stats.reduce((sum, s) => sum + Number(s.cnt), 0))
      }
      if (readyResp.error) {
        console.warn('get_draft_readiness_stats failed:', readyResp.error)
      } else {
        const r = (readyResp.data?.[0] || { ready: 0, not_ready: 0, total: 0 }) as { ready: number; not_ready: number; total: number }
        setReadiness({ ready: Number(r.ready), not_ready: Number(r.not_ready), total: Number(r.total) })
      }
    } catch (err) {
      console.warn('list_orders_draft_enriched failed:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setStatsLoading(false)
    }
  }, [statusFilter, search, page, dateFrom, dateTo])

  useEffect(() => { loadDrafts() }, [loadDrafts])
  useEffect(() => { setPage(0); setSelectedIds(new Set()) }, [statusFilter, search, dateFrom, dateTo])

  // Phase 8K polish: auto-refresh polling 30s. Pause saat tab hidden
  // (visibility API). Indra paste WA → 30s later list updates otomatis.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null
    const tick = () => {
      // Brief #7 — jangan refresh pas fix-mode kebuka (re-render reset progress)
      if (document.visibilityState === 'visible' && !benerinOpen) loadDrafts(true)
    }
    intervalId = setInterval(tick, 30000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !benerinOpen) loadDrafts(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadDrafts, benerinOpen])

  // Quality issues — compute per row
  const computeQualityIssues = (r: OrderDraftEnriched): string[] => {
    const issues: string[] = []
    if (!r.customer_phone || String(r.customer_phone).trim().length < 8) issues.push('No HP missing/invalid')
    // Kota/alamat TIDAK dihitung di sini — itu urusan "Perlu Dibenerin" (wilayah_id).
    // Chip ini khusus masalah SELAIN alamat biar gak tumpang-tindih angkanya.
    if (!r.customer_name || r.customer_name.trim().length < 3) issues.push('Nama terlalu pendek')
    if (Number(r.total) === 0) issues.push('Total Rp 0')
    // Brief #1 — Customer Risk berdasarkan reputasi nomor HP
    const canon = toCanonicalPhone(r.customer_phone)
    const risk = canon ? riskByPhone.get(canon) : undefined
    if (risk?.blacklisted) issues.push('Customer Risk: BLACKLIST')
    else if (risk?.tier === 'HIGH_RISK') issues.push('Customer Risk: risiko tinggi')
    else if (risk?.tier === 'WATCH') issues.push('Customer Risk: perhatian')
    return issues
  }
  const issuesPerRow = useMemo(() => {
    const map = new Map<number, string[]>()
    rows.forEach(r => {
      const issues = computeQualityIssues(r)
      if (issues.length > 0) map.set(r.id, issues)
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, riskByPhone])

  // Filter chip: show only rows with issues
  const [showIssuesOnly, setShowIssuesOnly] = useState(false)
  // Brief #7 PART 2 — SUMBER TUNGGAL: wilayah_id NULL = ⚠️ Perlu Dibenerin
  // (bukan lagi proxy provinsi+kota dari #5). Chip/badge/filter/fix-mode samaaa.
  const [alamatKurangOnly, setAlamatKurangOnly] = useState(false)
  const alamatKurang = (r: OrderDraftEnriched) => !r.wilayah_id
  useEffect(() => { setShowIssuesOnly(false); setAlamatKurangOnly(false) }, [statusFilter, search])
  const visibleRows = useMemo(() => {
    let rs = rows
    if (showIssuesOnly) rs = rs.filter(r => issuesPerRow.has(r.id))
    if (alamatKurangOnly) rs = rs.filter(alamatKurang)
    return rs
  }, [rows, showIssuesOnly, alamatKurangOnly, issuesPerRow])

  // Bulk select helpers
  const allOnPageSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id))
  const someOnPageSelected = rows.some(r => selectedIds.has(r.id))
  const toggleAllOnPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allOnPageSelected) {
        rows.forEach(r => next.delete(r.id))
      } else {
        rows.forEach(r => next.add(r.id))
      }
      return next
    })
  }
  const toggleRow = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      const { error } = await supabase.from('orders_draft').delete().in('id', ids)
      if (error) throw error
      toast.success(`${ids.length} draft dihapus`)
      setBulkDeleteOpen(false)
      setSelectedIds(new Set())
      await loadDrafts(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal bulk delete', { description: msg })
    } finally {
      setBulkDeleting(false)
    }
  }

  // Compute summary of selected for delete dialog
  const selectedRows = rows.filter(r => selectedIds.has(r.id))
  const selectedTotal = selectedRows.reduce((sum, r) => sum + Number(r.total || 0), 0)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const openResiDialog = (row: OrderDraftEnriched) => {
    setResiDialogDraft(row)
    setResiDialogOpen(true)
  }

  // Brief #9 — ke Export ke Ekspedisi dengan filter aktif kebawa + auto-ceklis ✅.
  const goExportReady = () => {
    const params = new URLSearchParams()
    const st = statusFilter === 'SIAP_KIRIM' || statusFilter === 'BARU' ? statusFilter : 'ELIGIBLE'
    params.set('status', st)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    if (search.trim()) params.set('q', search.trim())
    params.set('ready', '1')
    router.push(`/orders/export-resi?${params.toString()}`)
  }

  const visibleColumns: { id: string; label: string; align?: 'right' | 'center'; width?: string }[] = useMemo(() => [
    { id: 'created_at', label: 'Input', width: 'w-24' },
    { id: 'order_number', label: 'Order#', width: 'w-40' },
    { id: 'product_summary', label: 'Produk', width: 'w-64' },
    { id: 'customer_name', label: 'Customer', width: 'w-36' },
    { id: 'customer_city', label: 'Kota', width: 'w-32' },
    { id: 'total', label: 'Total', align: 'right', width: 'w-28' },
    { id: 'status', label: 'Status', align: 'center', width: 'w-24' },
    { id: 'priority', label: 'Prio', align: 'center', width: 'w-16' },
    { id: 'cs_name', label: 'CS', width: 'w-24' },
    { id: 'days_in_draft', label: 'Umur', align: 'right', width: 'w-16' },
    { id: 'actions', label: '', align: 'center', width: 'w-32' },
  ], [])

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Inbox}
        title="Antrian Kerja"
        description="Order yang menunggu cetak resi atau follow-up CS. Begitu resi keisi, order pindah ke Arsip."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => loadDrafts(true)} disabled={refreshing} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {canSetResi && readiness.not_ready > 0 && (
              <Button
                size="sm"
                onClick={() => setBenerinOpen(true)}
                className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
              >
                <Wand2 className="w-3.5 h-3.5" />
                Benerin Alamat ({readiness.not_ready})
              </Button>
            )}
            {canExport && readiness.ready > 0 && (
              <Button
                size="sm"
                onClick={goExportReady}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Truck className="w-3.5 h-3.5" />
                Export yang Siap ({readiness.ready})
              </Button>
            )}
            {canSetResi && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBulkResiOpen(true)}
                className="gap-1.5 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
              >
                <Truck className="w-3.5 h-3.5" />
                Set Resi Massal
              </Button>
            )}
            <Link href="/orders/new">
              <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                <Plus className="w-3.5 h-3.5" />
                Input Order Baru
              </Button>
            </Link>
          </div>
        }
      />

      {/* Status stats bar */}
      <div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <DraftStatusStatsBar
          stats={statusStats}
          totalCount={statusStatsTotal}
          activeStatus={statusFilter}
          onStatusClick={(s) => setStatusFilter(s)}
          loading={statsLoading}
          notReady={readiness.not_ready}
        />
      </div>

      {/* Brief #7 PART 2 — Kesiapan Export JUJUR (pisah dari status lifecycle).
          wilayah_id = sumber tunggal. Bunuh ilusi "100% Siap Kirim". */}
      {readiness.total > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm rounded-lg border bg-card px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Kesiapan Export</span>
          <button
            type="button"
            onClick={() => canExport && readiness.ready > 0 && goExportReady()}
            disabled={!canExport || readiness.ready === 0}
            className={`inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 text-xs font-medium ${
              canExport && readiness.ready > 0 ? 'hover:bg-emerald-500/20 cursor-pointer' : ''}`}
            title={canExport && readiness.ready > 0 ? 'Klik: Export yang Siap' : undefined}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Siap Export {readiness.ready.toLocaleString('id-ID')}
          </button>
          {/* Klik = SARING list ke order ⚠️ (alamat belum ke-resolve). Buat
              BENERIN-nya pakai tombol "Benerin Alamat" di header (fix-mode). */}
          <button
            type="button"
            onClick={() => readiness.not_ready > 0 && setAlamatKurangOnly(v => !v)}
            disabled={readiness.not_ready === 0}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              readiness.not_ready === 0
                ? 'border-border bg-muted text-muted-foreground'
                : alamatKurangOnly
                  ? 'border-orange-500 bg-orange-500 text-white'
                  : 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20 cursor-pointer'}`}
            title={readiness.not_ready > 0 ? (alamatKurangOnly ? 'Klik: tampilkan semua lagi' : 'Klik: saring tampilkan cuma yang perlu dibenerin') : undefined}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Perlu Dibenerin {readiness.not_ready.toLocaleString('id-ID')}
          </button>
          <div className="hidden sm:flex items-center gap-2 ml-1 flex-1 min-w-[120px] max-w-[260px]">
            <div className="h-2 flex-1 rounded-full bg-orange-500/20 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${readiness.total > 0 ? (readiness.ready / readiness.total) * 100 : 0}%` }} />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">{readiness.total > 0 ? Math.round((readiness.ready / readiness.total) * 100) : 0}%</span>
          </div>
        </div>
      )}

      {/* Filter row */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cari order # / customer / no HP..."
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={v => v && setStatusFilter(v as 'ALL' | DraftOrderStatus)}
            >
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent className="w-[220px]">
                <SelectItem value="ALL">Semua status</SelectItem>
                <SelectItem value="BARU">Baru</SelectItem>
                <SelectItem value="SIAP_KIRIM">Siap Kirim</SelectItem>
                <SelectItem value="PROBLEM">Problem</SelectItem>
                <SelectItem value="CANCEL">Cancel</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-36 text-xs"
              title="Tanggal dari"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-36 text-xs"
              title="Tanggal sampai"
            />
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo('') }} className="text-xs">
                Clear tanggal
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {/* Saring alamat ⚠️ — kalau lagi aktif dari banner "Perlu Dibenerin",
                kasih tau + tombol matiin. Alamat-readiness cuma 1 angka (banner). */}
            {alamatKurangOnly && (
              <Button
                type="button"
                size="sm"
                onClick={() => setAlamatKurangOnly(false)}
                className="h-7 text-xs gap-1.5 bg-orange-500 hover:bg-orange-600 text-white border-orange-500"
              >
                <AlertTriangle className="w-3 h-3" />
                Saring: alamat perlu dibenerin
                <X className="w-3 h-3" />
              </Button>
            )}
            {/* Quality filter chip — issue NON-alamat (no HP / nama / total / reputasi) */}
            <Button
              type="button"
              variant={showIssuesOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowIssuesOnly(v => !v)}
              className={`h-7 text-xs gap-1.5 ${
                showIssuesOnly
                  ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                  : issuesPerRow.size > 0
                    ? 'border-amber-500/50 text-amber-600 hover:bg-amber-500/10'
                    : ''
              }`}
              disabled={issuesPerRow.size === 0 && !showIssuesOnly}
              title="Order dengan masalah SELAIN alamat: no HP, nama, total Rp 0, atau reputasi customer"
            >
              <AlertTriangle className="w-3 h-3" />
              Data lain bermasalah ({issuesPerRow.size})
            </Button>
            {showIssuesOnly && (
              <span className="text-xs text-muted-foreground">
                No HP / nama / total Rp 0 / reputasi (di halaman ini). Alamat dibenerin lewat tombol di atas.
              </span>
            )}
            <span className="ml-auto text-muted-foreground">
              {totalCount.toLocaleString('id-ID')} order · halaman {page + 1}/{totalPages}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={toggleAllOnPage}
                    aria-label="Select all on page"
                    className={someOnPageSelected && !allOnPageSelected ? 'opacity-60' : ''}
                  />
                </TableHead>
                {visibleColumns.map(c => (
                  <TableHead
                    key={c.id}
                    className={`${c.width || ''} ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={visibleColumns.length + 1}>
                      <div className="h-4 bg-muted animate-pulse rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="p-0">
                    <EmptyState
                      icon={search || statusFilter !== 'ALL' || dateFrom || dateTo ? Filter : Inbox}
                      title={search || statusFilter !== 'ALL' || dateFrom || dateTo ? 'Tidak ada hasil' : 'Antrian kosong'}
                      description={
                        search || statusFilter !== 'ALL' || dateFrom || dateTo
                          ? 'Coba ubah filter.'
                          : 'Belum ada draft. Tambah lewat tombol "Input Order Baru".'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map(row => (
                  <DraftRow
                    key={row.id}
                    row={row}
                    selected={selectedIds.has(row.id)}
                    issues={issuesPerRow.get(row.id)}
                    onToggleSelect={() => toggleRow(row.id)}
                    onResiClick={() => openResiDialog(row)}
                    onUpdated={() => loadDrafts(true)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{totalCount.toLocaleString('id-ID')} entries · halaman {page + 1} dari {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
              <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}

      <ResiInputDialog
        open={resiDialogOpen}
        onOpenChange={setResiDialogOpen}
        draft={resiDialogDraft}
        onPromoted={() => loadDrafts(true)}
      />

      <BulkResiDialog
        open={bulkResiOpen}
        onOpenChange={setBulkResiOpen}
        onApplied={() => loadDrafts(true)}
      />

      {/* Brief #7 PART 1 — mode fokus Benerin Alamat (cuma ⚠️, satu per layar) */}
      <BenerinAlamatDialog
        open={benerinOpen}
        onOpenChange={setBenerinOpen}
        filters={{ status: statusFilter, search: search.trim(), dateFrom, dateTo }}
        onDone={() => loadDrafts(true)}
      />

      {/* Bulk action bar — sticky bottom kalau ada selection */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 bg-card border shadow-lg rounded-lg px-4 py-3 flex items-center gap-3 min-w-[400px]">
          <div className="text-sm">
            <span className="font-semibold tabular-nums">{selectedIds.size}</span>
            <span className="text-muted-foreground ml-1">draft selected</span>
            {selectedTotal > 0 && (
              <span className="text-muted-foreground ml-2">· total {formatRupiah(selectedTotal)}</span>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="gap-1.5">
              <X className="w-3.5 h-3.5" />
              Clear
            </Button>
            {canBulkDelete && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBulkDeleteOpen(true)}
                className="gap-1.5 border-red-500/40 text-red-600 hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus Massal
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Bulk delete confirm */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Hapus {selectedIds.size} draft?
            </DialogTitle>
            <DialogDescription>
              Semua draft yang di-select akan dihapus permanent dari Antrian Kerja. Audit log mencatat tiap DELETE event.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-red-500/5 border border-red-500/20 p-3 text-xs space-y-1 max-h-48 overflow-y-auto">
            {selectedRows.slice(0, 10).map(r => (
              <div key={r.id} className="flex justify-between gap-2">
                <span className="font-mono text-violet-500 shrink-0">{r.order_number}</span>
                <span className="truncate">{r.customer_name}</span>
                <span className="tabular-nums shrink-0">{formatRupiah(Number(r.total))}</span>
              </div>
            ))}
            {selectedRows.length > 10 && (
              <div className="text-muted-foreground text-center pt-1">+ {selectedRows.length - 10} draft lain</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>Batal</Button>
            <Button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="bg-red-600 hover:bg-red-700 text-white gap-2"
            >
              {bulkDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Ya, hapus {selectedIds.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// =======================================================================
// Row renderer
// =======================================================================
function DraftRow({ row, selected, issues, onToggleSelect, onResiClick, onUpdated }: {
  row: OrderDraftEnriched
  selected: boolean
  issues?: string[]
  onToggleSelect: () => void
  onResiClick: () => void
  onUpdated: () => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  // Brief #7 — sumber tunggal kesiapan alamat
  const needsFix = !row.wilayah_id
  const status = row.status as OrderStatus
  const statusColor = STATUS_BADGE_COLOR[status] || 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'
  const statusLabel = STATUS_LABEL[status] || row.status

  // Umur draft = jumlah hari sejak created_at
  const daysInDraft = Math.max(0, Math.floor(
    (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24)
  ))
  const ageColor = daysInDraft > 3 ? 'text-amber-600' : daysInDraft > 7 ? 'text-red-600' : 'text-muted-foreground'

  const priorityBadge = row.priority && row.priority !== 'NORMAL' ? (
    <Badge variant="outline" className={
      row.priority === 'URGENT' ? 'bg-red-500/10 text-red-600 text-[10px]'
      : 'bg-zinc-500/10 text-zinc-600 text-[10px]'
    }>
      {row.priority}
    </Badge>
  ) : <span className="text-muted-foreground">—</span>

  return (
    <TableRow className={`${selected ? 'bg-violet-500/5' : ''} ${needsFix ? 'border-l-2 border-l-orange-500/70' : ''}`}>
      <TableCell className="text-center">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`Select ${row.order_number}`} />
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">{formatDate(row.created_at)}</TableCell>
      <TableCell>
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="text-violet-400 hover:underline font-mono text-xs whitespace-nowrap cursor-pointer"
          title="Klik untuk Edit cepat"
        >
          {row.order_number}
        </button>
      </TableCell>
      <TableCell className="text-xs max-w-[260px]">
        <span className="truncate inline-block max-w-full align-middle" title={row.product_summary || ''}>
          {row.product_summary || '—'}
        </span>
      </TableCell>
      <TableCell className="text-xs">
        <div className="flex items-center gap-1.5" title={issues && issues.length > 0 ? issues.join(' · ') : undefined}>
          {issues && issues.length > 0 && (
            <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" aria-label="Data tidak lengkap" />
          )}
          <span className="truncate">{row.customer_name}</span>
        </div>
      </TableCell>
      <TableCell className="text-xs">
        {needsFix ? (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1 rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 text-[11px] text-orange-700 dark:text-orange-300 hover:bg-orange-500/20 cursor-pointer max-w-full"
            title="Alamat belum ke-resolve — klik untuk benerin"
          >
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span className="truncate">{row.customer_city || 'Benerin'}</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1" title="Alamat lengkap — siap export">
            <span className="truncate">{row.customer_city || '—'}</span>
            <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-500" />
          </span>
        )}
      </TableCell>
      <TableCell className="text-xs text-right tabular-nums whitespace-nowrap">{formatRupiah(Number(row.total))}</TableCell>
      <TableCell className="text-center">
        <Badge variant="outline" className={`${statusColor} text-[10px]`}>{statusLabel}</Badge>
      </TableCell>
      <TableCell className="text-center">{priorityBadge}</TableCell>
      <TableCell className="text-xs">{row.cs_name || <span className="text-muted-foreground italic">—</span>}</TableCell>
      <TableCell className={`text-xs text-right tabular-nums ${ageColor}`}>{daysInDraft}h</TableCell>
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onResiClick}
            className="gap-1 text-[11px] h-7 px-2 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
            disabled={row.status === 'CANCEL'}
            title={row.status === 'CANCEL' ? 'Order cancelled — tidak bisa diberi resi' : 'Input resi & cetak'}
          >
            <Truck className="w-3 h-3" />
            Resi
          </Button>
          <DraftRowActions row={row} onUpdated={onUpdated} onEdit={() => setEditOpen(true)} />
        </div>
      </TableCell>
      {/* Edit dialog lifted to row level — shared antara Order# click + dropdown menu */}
      <DraftQuickEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        draft={row}
        onSaved={onUpdated}
      />
    </TableRow>
  )
}
