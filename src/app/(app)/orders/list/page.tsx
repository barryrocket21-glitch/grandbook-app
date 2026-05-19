'use client'
import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList, Search, Filter, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { INTERNAL_STATUSES, STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { formatRupiah, formatDate, formatDateTime } from '@/lib/format'
import { format, parseISO } from 'date-fns'
import {
  COLUMNS, COLUMNS_BY_ID,
  SYSTEM_DEFAULT_VISIBILITY, SYSTEM_DEFAULT_ORDER, SYSTEM_DEFAULT_WIDTHS,
} from '@/lib/orders/columns-config'
import { ColumnCustomizer, persistOrdersListPreferences } from '@/components/orders/column-customizer'
import { EditableCell } from '@/components/orders/editable-cell'
import { OrderRowActions } from '@/components/orders/order-row-actions'
import { StatusStatsBar } from './_components/status-stats-bar'
import { InsightsDrawer } from './_components/insights-drawer'
import { ORDER_PRIORITIES } from '@/lib/types'
import { isEditableField } from '@/lib/schemas/order-update'
import type {
  OrderStatus, OrderEnriched, OrderStatusStat, UserPreferences, OrganizationSettings, SavedView,
} from '@/lib/types'

const supabase = createClient()

const STUCK_PICKUP_DAYS_THRESHOLD = 3
const PAGE_SIZE = 100
const PERSIST_DEBOUNCE_MS = 500

export default function OrdersListPage() {
  return (
    <Suspense fallback={<div className="space-y-6"><PageHeader icon={ClipboardList} title="Daftar Order" /></div>}>
      <OrdersListInner />
    </Suspense>
  )
}

function OrdersListInner() {
  const { user, profile } = useAuth()
  const searchParams = useSearchParams()
  const initialStatus = (searchParams.get('status') || 'ALL') as 'ALL' | OrderStatus
  const initialStuck  = searchParams.get('stuck_pickup') === 'true'
  // Phase 8I-Followup Part 4F — read from/to dari URL untuk Insights drawer click-through
  const initialFrom   = searchParams.get('from')
  const initialTo     = searchParams.get('to')

  // ---------- Filters ----------
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>(initialStatus)
  const [stuckPickup, setStuckPickup] = useState(initialStuck)
  const [dateFrom, setDateFrom] = useState<string>(initialFrom ?? '')
  const [dateTo, setDateTo] = useState<string>(initialTo ?? '')
  const [page, setPage] = useState(0)

  // ---------- Data ----------
  const [rows, setRows] = useState<OrderEnriched[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Phase 8I-Followup Part 3 — status breakdown stats bar
  const [statusStats, setStatusStats] = useState<OrderStatusStat[]>([])
  const [statusStatsTotal, setStatusStatsTotal] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)

  // ---------- Column view state (load dari profiles.preferences + org default) ----------
  const [visibility, setVisibility] = useState<Record<string, boolean>>(SYSTEM_DEFAULT_VISIBILITY)
  const [order, setOrder] = useState<string[]>(SYSTEM_DEFAULT_ORDER)
  const [widths, setWidths] = useState<Record<string, number>>(SYSTEM_DEFAULT_WIDTHS)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [fullPrefs, setFullPrefs] = useState<UserPreferences>({})

  // Load user preferences + org default sekali saat mount
  useEffect(() => {
    if (!user || !profile?.organization_id) return
    let cancelled = false
    ;(async () => {
      try {
        const [{ data: prof }, { data: org }] = await Promise.all([
          supabase.from('profiles').select('preferences').eq('id', user.id).single(),
          supabase.from('organizations').select('settings').eq('id', profile.organization_id).single(),
        ])
        if (cancelled) return
        const userPrefs = (prof?.preferences ?? {}) as UserPreferences
        const orgSettings = (org?.settings ?? {}) as OrganizationSettings
        setFullPrefs(userPrefs)

        const userOrdersList = userPrefs.orders_list
        const teamDefault    = orgSettings.orders_list_default_view

        // Resolution priority: user > team > system
        setVisibility({
          ...SYSTEM_DEFAULT_VISIBILITY,
          ...(teamDefault?.column_visibility ?? {}),
          ...(userOrdersList?.column_visibility ?? {}),
        })

        // Bug 2 fix (3.6): existing user yang prefs-nya disimpan sebelum kita
        // tambah kolom baru (mis. product_summary di Phase 8I-Followup Part 2)
        // → column_order ga punya kolom baru itu, jadi visibleColumns filter
        // ngabaikan walau visibility=true. Solusi: append column ID baru
        // (dari SYSTEM_DEFAULT_ORDER) ke akhir user's order kalau belum ada.
        const userOrderArr = userOrdersList?.column_order ?? teamDefault?.column_order ?? SYSTEM_DEFAULT_ORDER
        const userOrderSet = new Set(userOrderArr)
        const missingNewColumns = SYSTEM_DEFAULT_ORDER.filter(id => !userOrderSet.has(id))
        setOrder(missingNewColumns.length > 0 ? [...userOrderArr, ...missingNewColumns] : userOrderArr)

        // Bug 3 fix (3.6): kalau user width LEBIH KECIL dari system default,
        // ada kemungkinan saved width = legacy old-default yang sekarang stale
        // (mis. status width 110 saved sebelum kita naikkan ke 150 di Phase 8I).
        // Bump ke max(saved, system default). User yang explicit pengen width
        // lebih kecil dari default bisa set ulang via Customize.
        const teamWidths = teamDefault?.column_widths ?? {}
        const userWidths = userOrdersList?.column_widths ?? {}
        const mergedWidths: Record<string, number> = {}
        for (const id of SYSTEM_DEFAULT_ORDER) {
          const sysDefault = SYSTEM_DEFAULT_WIDTHS[id] ?? 100
          const chosen = userWidths[id] ?? teamWidths[id] ?? sysDefault
          mergedWidths[id] = Math.max(chosen, sysDefault)
        }
        setWidths(mergedWidths)
        setSavedViews(userOrdersList?.saved_views ?? [])
        setActiveViewId(userOrdersList?.active_view_id ?? null)
        setPrefsLoaded(true)
      } catch (err) {
        console.warn('Load preferences failed:', err)
        setPrefsLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [user, profile?.organization_id])

  // Debounced persist (auto-save) saat visibility/order/widths/savedViews berubah
  useEffect(() => {
    if (!user || !prefsLoaded) return
    const t = setTimeout(async () => {
      try {
        await persistOrdersListPreferences(user.id, fullPrefs, {
          column_visibility: visibility,
          column_order: order,
          column_widths: widths,
          saved_views: savedViews,
          active_view_id: activeViewId,
        })
      } catch (err) {
        console.warn('Auto-save prefs failed:', err)
      }
    }, PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [visibility, order, widths, savedViews, activeViewId, user, prefsLoaded, fullPrefs])

  // ---------- Load data via RPC ----------
  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      // Phase 8I-Followup Part 3 — fetch list + stats parallel. Stats berbasis
      // filter date/search yang sama, tapi TANPA p_status (supaya semua status
      // tetap tampil di bar walau user lagi filter ke 1 status).
      const [listResp, statsResp] = await Promise.all([
        supabase.rpc('list_orders_enriched', {
          p_from: dateFrom || null,
          p_to: dateTo || null,
          p_status: stuckPickup ? 'SIAP_KIRIM' : (statusFilter === 'ALL' ? null : statusFilter),
          p_search: search.trim() || null,
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        }),
        supabase.rpc('get_orders_status_stats', {
          p_from: dateFrom || null,
          p_to: dateTo || null,
          p_search: search.trim() || null,
        }),
      ])
      if (listResp.error) throw listResp.error
      const rs = (listResp.data || []) as OrderEnriched[]
      setRows(rs)
      setTotalCount(rs[0]?.total_count ? Number(rs[0].total_count) : 0)

      // Stats: jangan throw kalau RPC stats error (bar optional)
      if (statsResp.error) {
        console.warn('get_orders_status_stats failed:', statsResp.error)
      } else {
        const stats = (statsResp.data || []) as OrderStatusStat[]
        setStatusStats(stats)
        setStatusStatsTotal(stats.reduce((sum, s) => sum + Number(s.cnt), 0))
      }
    } catch (err) {
      console.warn('list_orders_enriched failed:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setStatsLoading(false)
    }
  }, [statusFilter, search, page, stuckPickup, dateFrom, dateTo])

  useEffect(() => { loadOrders() }, [loadOrders])

  // Reset page kalau filter berubah
  useEffect(() => { setPage(0) }, [statusFilter, search, stuckPickup, dateFrom, dateTo])

  // Phase 8I-Followup Part 4F — Sync filter state ke URL params kalau berubah
  // (mis. dari InsightsDrawer click-through yang router.push baru). Pakai search
  // param sebagai source of truth saat URL berubah, NOT initial mount (yang sudah
  // di-handle via useState initializer).
  useEffect(() => {
    const urlStatus = searchParams.get('status')
    if (urlStatus && urlStatus !== statusFilter) {
      setStatusFilter(urlStatus as 'ALL' | OrderStatus)
    }
    const urlFrom = searchParams.get('from') || ''
    if (urlFrom !== dateFrom) setDateFrom(urlFrom)
    const urlTo = searchParams.get('to') || ''
    if (urlTo !== dateTo) setDateTo(urlTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Filter "Resi Stuck" → apply client-side filter on top of fetched data
  // (server-side cuma filter status=SIAP_KIRIM)
  const stuckThresholdMs = STUCK_PICKUP_DAYS_THRESHOLD * 24 * 60 * 60 * 1000
  const isStuck = (r: OrderEnriched) =>
    r.status === 'SIAP_KIRIM'
    && !r.picked_up_at
    && !!r.resi_printed_at
    && (Date.now() - new Date(r.resi_printed_at).getTime() > stuckThresholdMs)

  const filtered = useMemo(() => {
    return stuckPickup ? rows.filter(isStuck) : rows
  }, [rows, stuckPickup]) // eslint-disable-line react-hooks/exhaustive-deps

  const stuckCount = useMemo(() => rows.filter(isStuck).length, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // Visible & ordered columns
  const visibleColumns = useMemo(
    () => order.filter(id => visibility[id] && COLUMNS_BY_ID[id]),
    [order, visibility]
  )

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const handleColumnChange = useCallback((next: {
    visibility?: Record<string, boolean>; order?: string[]; widths?: Record<string, number>
    savedViews?: SavedView[]; activeViewId?: string | null
  }) => {
    if (next.visibility) setVisibility(next.visibility)
    if (next.order)      setOrder(next.order)
    if (next.widths)     setWidths(next.widths)
    if (next.savedViews) setSavedViews(next.savedViews)
    if ('activeViewId' in next) setActiveViewId(next.activeViewId ?? null)
  }, [])

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ClipboardList}
        title="Daftar Order"
        description="Customizable view + inline edit + quick actions."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => loadOrders(true)} disabled={refreshing} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <InsightsDrawer
              initialFrom={dateFrom || null}
              initialTo={dateTo || null}
              initialStatus={statusFilter}
            />
            <ColumnCustomizer
              visibility={visibility}
              order={order}
              widths={widths}
              savedViews={savedViews}
              activeViewId={activeViewId}
              onChange={handleColumnChange}
              onPersist={async () => {
                if (!user) return
                await persistOrdersListPreferences(user.id, fullPrefs, {
                  column_visibility: visibility,
                  column_order: order,
                  column_widths: widths,
                  saved_views: savedViews,
                  active_view_id: activeViewId,
                })
              }}
            />
          </div>
        }
      />

      {/* Phase 8I-Followup Part 3 — status breakdown stats bar.
          Bug 1 fix (3.6): wrap di div sticky top-0 supaya stats tetap visible saat
          scroll vertikal panjang, dan z-20 supaya di atas tabel header. backdrop-blur
          biar tetap readable saat row tabel di belakang. -mx + px ngebuat full-bleed
          padding parent. */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <StatusStatsBar
          stats={statusStats}
          totalCount={statusStatsTotal}
          activeStatus={stuckPickup ? null : statusFilter}
          onStatusClick={(s) => {
            if (stuckPickup) setStuckPickup(false)
            setStatusFilter(s)
          }}
          loading={statsLoading}
        />
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cari order # / customer / resi / no HP..."
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={v => {
                if (!v) return
                setStatusFilter(v as 'ALL' | OrderStatus)
                if (stuckPickup) setStuckPickup(false)
              }}
            >
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent className="w-[220px]">
                <SelectItem value="ALL">Semua status</SelectItem>
                {INTERNAL_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Phase 8I-Followup Part 4F — date range inputs.
                Wired ke RPC p_from/p_to. URL param `from`/`to` sync via useEffect
                supaya InsightsDrawer click-through dimension day/month bisa apply. */}
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="text-xs"
              >
                Clear tanggal
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant={stuckPickup ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStuckPickup(v => !v)}
              className={
                stuckPickup
                  ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                  : stuckCount > 0
                    ? 'border-amber-500/50 text-amber-600 hover:bg-amber-500/10'
                    : ''
              }
            >
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />
              Resi Stuck ({stuckCount})
              <span className="ml-1 text-[10px] opacity-70">&gt; {STUCK_PICKUP_DAYS_THRESHOLD}h</span>
            </Button>
            {stuckPickup && (
              <span className="text-xs text-muted-foreground">
                Hanya order SIAP_KIRIM yang resi-nya dicetak &gt; {STUCK_PICKUP_DAYS_THRESHOLD} hari tapi belum di-pickup.
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {totalCount.toLocaleString('id-ID')} order · halaman {page + 1}/{totalPages}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Bug 1 fix (3.6): pakai plain div bukan Card supaya overflow-x scroll
          benar-benar isolate dari page-level scroll. Card sebelumnya pakai
          flex-col yang bisa propagate width child ke parent kalau ada flex-quirk. */}
      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.map(id => {
                  const col = COLUMNS_BY_ID[id]
                  return (
                    <TableHead
                      key={id}
                      style={{ width: widths[id] || col.default_width, minWidth: 60 }}
                      className={col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
                    >
                      {col.label}
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={visibleColumns.length}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length} className="p-0">
                    <EmptyState
                      icon={rows.length === 0 ? ClipboardList : Filter}
                      title={rows.length === 0 ? 'Belum ada order' : 'Tidak ada hasil'}
                      description={rows.length === 0 ? 'Tambah order via Input Order Baru / Bulk Upload.' : 'Coba ubah filter.'}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(row => (
                  <TableRow key={row.id}>
                    {visibleColumns.map(id => {
                      const col = COLUMNS_BY_ID[id]
                      const w = widths[id] || col.default_width
                      return (
                        <TableCell
                          key={id}
                          // Phase 8I-Followup hotfix: overflow-hidden bikin maxWidth actually
                          // clip overflow (sebelumnya content panjang overflow ke cell sebelah,
                          // mis. KAB. PENAJAM PASER UTARA bocor ke kolom Total).
                          className={`text-xs overflow-hidden align-middle ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} ${col.format === 'rupiah' || col.format === 'number' || col.format === 'percent' ? 'tabular-nums whitespace-nowrap' : ''}`}
                          style={{ maxWidth: w, minWidth: Math.min(w, 80) }}
                        >
                          <CellRenderer row={row} colId={id} onUpdated={() => loadOrders(true)} />
                        </TableCell>
                      )
                    })}
                  </TableRow>
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
    </div>
  )
}

// =======================================================================
// Cell renderer — dispatch ke EditableCell (kalau field whitelisted)
// atau render plain berdasarkan column format
// =======================================================================
function CellRenderer({ row, colId, onUpdated }: {
  row: OrderEnriched
  colId: string
  onUpdated: () => void
}) {
  const col = COLUMNS_BY_ID[colId]
  if (!col) return null

  // Actions column → render OrderRowActions
  if (colId === 'actions') {
    return <OrderRowActions row={row} onUpdated={onUpdated} />
  }

  // Order number → link ke detail
  if (colId === 'order_number') {
    return (
      <Link href={`/orders/${row.id}`} className="text-violet-400 hover:underline font-mono whitespace-nowrap">
        {row.order_number}
      </Link>
    )
  }

  // Channel name → mono badge
  if (colId === 'channel_name') {
    return row.channel_name
      ? <Badge variant="outline" className="font-mono text-[10px]">{row.channel_name}</Badge>
      : <span className="text-muted-foreground italic">—</span>
  }

  // Supplier name (+ multi-origin indicator)
  if (colId === 'supplier_name') {
    if (row.is_multi_origin) {
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 text-[10px]">Multi-Origin</Badge>
    }
    return row.supplier_name
      ? <Badge variant="outline" className="text-[10px]">{row.supplier_name}</Badge>
      : <span className="text-muted-foreground italic">—</span>
  }

  if (colId === 'is_multi_origin') {
    return row.is_multi_origin
      ? <Badge variant="outline" className="bg-amber-500/10 text-amber-600 text-[10px]">Ya</Badge>
      : <span className="text-muted-foreground">—</span>
  }

  if (colId === 'is_repeat_customer') {
    return row.is_repeat_customer
      ? <Badge variant="outline" className="bg-violet-500/10 text-violet-600 text-[10px]">Repeat</Badge>
      : <span className="text-muted-foreground">—</span>
  }

  // Phase 8I-Followup Part 2 — produk summary dengan compact display untuk multi-item.
  // 1 item: tampil langsung "Nama Produk (1x)".
  // N item: tampil primary_product_name + Badge "+N-1" dengan tooltip full summary.
  if (colId === 'product_summary') {
    const summary = row.product_summary || '—'
    const count = row.product_count || 0
    if (count === 0) return <span className="text-muted-foreground italic">—</span>
    if (count === 1) {
      return (
        <span className="text-xs truncate inline-block max-w-full align-middle" title={summary}>
          {summary}
        </span>
      )
    }
    // Multi-item: primary + "+N more" badge
    const primary = row.primary_product_name || summary.split(',')[0]?.trim() || '—'
    return (
      <div className="flex items-center gap-1 min-w-0" title={summary}>
        <span className="text-xs truncate min-w-0">{primary}</span>
        <Badge variant="outline" className="text-[10px] shrink-0 bg-violet-500/10 text-violet-600">
          +{count - 1}
        </Badge>
      </div>
    )
  }

  if (colId === 'primary_product_name') {
    return row.primary_product_name
      ? <span className="text-xs truncate inline-block max-w-full" title={row.primary_product_name}>{row.primary_product_name}</span>
      : <span className="text-muted-foreground italic">—</span>
  }

  // Editable field via EditableCell
  if (col.editable_field && isEditableField(col.editable_field)) {
    return (
      <EditableCell
        row={row}
        field={col.editable_field}
        onUpdated={onUpdated}
      />
    )
  }

  // Plain display by format
  const raw = (row as unknown as Record<string, unknown>)[colId]

  if (raw === null || raw === undefined || raw === '') {
    return <span className="text-muted-foreground italic">—</span>
  }

  if (col.format === 'rupiah') return <span>{formatRupiah(Number(raw) || 0)}</span>
  if (col.format === 'percent') return <span>{(Number(raw) || 0).toFixed(1)}%</span>
  if (col.format === 'number')  return <span>{Number(raw).toLocaleString('id-ID')}</span>
  if (col.format === 'date')    return <span className="whitespace-nowrap">{formatDate(String(raw))}</span>
  if (col.format === 'datetime') return <span className="whitespace-nowrap">{shortDateTime(String(raw))}</span>

  // Special days_in_status with color
  if (colId === 'days_in_status') {
    const d = Number(raw)
    const color = d > 7 ? 'text-red-600' : d > 3 ? 'text-amber-600' : 'text-muted-foreground'
    return <span className={`${color} tabular-nums`}>{d}h</span>
  }

  return <span>{String(raw)}</span>
}

function shortDateTime(iso: string): string {
  try { return format(parseISO(iso), 'dd MMM HH:mm') } catch { return iso }
}
