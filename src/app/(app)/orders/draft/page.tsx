'use client'
import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
  Trash2, AlertTriangle, Loader2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { formatRupiah, formatDate } from '@/lib/format'
import type {
  OrderDraftEnriched, DraftOrderStatus, DraftStatusStat, OrderStatus,
} from '@/lib/types'
import { DraftStatusStatsBar } from './_components/draft-status-stats-bar'
import { ResiInputDialog } from './_components/resi-input-dialog'
import { DraftRowActions } from './_components/draft-row-actions'
import { BulkResiDialog } from './_components/bulk-resi-dialog'

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
  const initialStatus = (searchParams.get('status') || 'ALL') as 'ALL' | DraftOrderStatus

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | DraftOrderStatus>(initialStatus)
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<OrderDraftEnriched[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusStats, setStatusStats] = useState<DraftStatusStat[]>([])
  const [statusStatsTotal, setStatusStatsTotal] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)

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
      const [listResp, statsResp] = await Promise.all([
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
      ])
      if (listResp.error) throw listResp.error
      const rs = (listResp.data || []) as OrderDraftEnriched[]
      setRows(rs)
      setTotalCount(rs[0]?.total_count ? Number(rs[0].total_count) : 0)

      if (statsResp.error) {
        console.warn('get_draft_status_stats failed:', statsResp.error)
      } else {
        const stats = (statsResp.data || []) as DraftStatusStat[]
        setStatusStats(stats)
        setStatusStatsTotal(stats.reduce((sum, s) => sum + Number(s.cnt), 0))
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
        />
      </div>

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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="ml-auto">
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
                rows.map(row => (
                  <DraftRow
                    key={row.id}
                    row={row}
                    selected={selectedIds.has(row.id)}
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
function DraftRow({ row, selected, onToggleSelect, onResiClick, onUpdated }: {
  row: OrderDraftEnriched
  selected: boolean
  onToggleSelect: () => void
  onResiClick: () => void
  onUpdated: () => void
}) {
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
    <TableRow className={selected ? 'bg-violet-500/5' : ''}>
      <TableCell className="text-center">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`Select ${row.order_number}`} />
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">{formatDate(row.created_at)}</TableCell>
      <TableCell>
        <Link href={`/orders/${row.id}?draft=1`} className="text-violet-400 hover:underline font-mono text-xs whitespace-nowrap">
          {row.order_number}
        </Link>
      </TableCell>
      <TableCell className="text-xs max-w-[260px]">
        <span className="truncate inline-block max-w-full align-middle" title={row.product_summary || ''}>
          {row.product_summary || '—'}
        </span>
      </TableCell>
      <TableCell className="text-xs">{row.customer_name}</TableCell>
      <TableCell className="text-xs">{row.customer_city || <span className="text-muted-foreground italic">—</span>}</TableCell>
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
          <DraftRowActions row={row} onUpdated={onUpdated} />
        </div>
      </TableCell>
    </TableRow>
  )
}
