'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Search, RefreshCw, Eye, ChevronLeft, ChevronRight, Upload, ShoppingCart, Inbox } from 'lucide-react'
import { formatRupiah, formatDate } from '@/lib/format'
import { ORDER_STATUSES, RESI_STATUSES } from '@/lib/constants'
import type { Order } from '@/lib/types'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, defaultRange, type DateRange } from '@/components/ui/date-range-picker'

const supabase = createClient()

const PAGE_SIZE = 50

export default function OrdersListPage() {
  const { role } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [range, setRange] = useState<DateRange>(defaultRange())
  const dateFrom = range.from
  const dateTo = range.to
  const [selected, setSelected] = useState<number[]>([])
  const [bulkStatus, setBulkStatus] = useState<string>('')

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('orders').select('*, campaigns(campaign_name, platform)', { count: 'exact' })
    if (statusFilter !== 'ALL') query = query.eq('status', statusFilter)
    if (dateFrom) query = query.gte('order_date', dateFrom)
    if (dateTo) query = query.lte('order_date', dateTo)
    if (search) query = query.or(`customer_name.ilike.%${search}%,order_number.ilike.%${search}%`)
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    const { data, count, error } = await query
    if (error) { toast.error(error.message); setLoading(false); return }
    setOrders(data || [])
    setTotalCount(count || 0)
    setLoading(false)
  }, [page, statusFilter, dateFrom, dateTo, search])

  // Status counts (separate, so they don't paginate)
  const fetchStatusCounts = useCallback(async () => {
    let baseQuery = supabase.from('orders').select('status', { count: 'exact', head: false })
    if (dateFrom) baseQuery = baseQuery.gte('order_date', dateFrom)
    if (dateTo) baseQuery = baseQuery.lte('order_date', dateTo)
    if (search) baseQuery = baseQuery.or(`customer_name.ilike.%${search}%,order_number.ilike.%${search}%`)
    const { data } = await baseQuery
    const counts: Record<string, number> = {}
    ;(data || []).forEach((o: any) => { counts[o.status] = (counts[o.status] || 0) + 1 })
    setStatusCounts(counts)
  }, [dateFrom, dateTo, search])

  useEffect(() => { fetchOrders() }, [fetchOrders])
  useEffect(() => { fetchStatusCounts() }, [fetchStatusCounts])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
    setPage(0)
  }

  const toggleSelect = (id: number) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const toggleAll = () => setSelected(selected.length === orders.length ? [] : orders.map(o => o.id))

  const handleBulkUpdate = async () => {
    if (!bulkStatus || selected.length === 0) return
    const { error } = await supabase.from('orders').update({ status: bulkStatus }).in('id', selected)
    if (error) { toast.error(error.message); return }
    toast.success(`${selected.length} order diupdate ke ${bulkStatus}`)
    setSelected([]); setBulkStatus(''); fetchOrders()
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const getStatusBadge = (status: string) => {
    const s = ORDER_STATUSES.find(st => st.value === status)
    return <Badge variant="outline" className={s?.color || ''}>{s?.label || status}</Badge>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingCart}
        title="Daftar Order"
        description={`${totalCount.toLocaleString('id-ID')} total order`}
        actions={(role === 'admin' || role === 'owner') ? (
          <>
            <Button variant="outline" render={<Link href="/orders/bulk-upload" />}>
              <Upload className="w-4 h-4 mr-1.5" />Upload Massal
            </Button>
            <Button render={<Link href="/orders/new" />} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">+ Input Order Baru</Button>
          </>
        ) : null}
      />

      {/* Status overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {ORDER_STATUSES.map(s => {
          const count = statusCounts[s.value] || 0
          const isActive = statusFilter === s.value
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => { setStatusFilter(isActive ? 'ALL' : s.value); setPage(0) }}
              className={`text-left rounded-lg border bg-card p-3 transition-all hover:shadow-md ${isActive ? 'ring-2 ring-violet-500 border-violet-500/50' : 'hover:border-violet-500/30'}`}
            >
              <p className={`text-[10px] uppercase tracking-wider font-semibold ${s.color.replace('bg-', 'text-').replace('/15', '').replace('/10', '')}`}>{s.label}</p>
              <p className="text-2xl font-bold mt-1">{count}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">order</p>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => { setStatusFilter('ALL'); setPage(0) }}
          className={`text-left rounded-lg border bg-gradient-to-br from-violet-500/10 to-indigo-500/10 p-3 transition-all hover:shadow-md ${statusFilter === 'ALL' ? 'ring-2 ring-violet-500 border-violet-500/50' : 'hover:border-violet-500/30'}`}
        >
          <p className="text-[10px] uppercase tracking-wider font-semibold text-violet-400">Semua</p>
          <p className="text-2xl font-bold mt-1">{Object.values(statusCounts).reduce((s, c) => s + c, 0)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">total</p>
        </button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <form onSubmit={handleSearch} className="flex-1 flex gap-2">
              <Input placeholder="Cari nama / no. order..." value={searchInput} onChange={e => setSearchInput(e.target.value)} className="max-w-sm" />
              <Button type="submit" variant="outline" size="icon"><Search className="w-4 h-4" /></Button>
            </form>
            <Select value={statusFilter} onValueChange={v => { if (v) { setStatusFilter(v); setPage(0) } }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Status</SelectItem>
                {ORDER_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <DateRangePicker value={range} onChange={v => { setRange(v); setPage(0) }} />
            <Button variant="outline" size="icon" onClick={() => fetchOrders()}><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {(role === 'cs' || role === 'owner') && selected.length > 0 && (
        <Card className="border-violet-500/30 bg-violet-500/5">
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <span className="text-sm font-medium">{selected.length} order dipilih</span>
            <Select value={bulkStatus} onValueChange={v => v && setBulkStatus(v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Update ke..." /></SelectTrigger>
              <SelectContent>{ORDER_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" onClick={handleBulkUpdate} className="bg-violet-600 text-white">Update Status</Button>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {(role === 'cs' || role === 'owner') && <TableHead className="w-10"><Checkbox checked={selected.length === orders.length && orders.length > 0} onCheckedChange={toggleAll} /></TableHead>}
                  <TableHead>No. Order</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Bayar</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Resi</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={9} className="text-center py-4"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                  ))
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="p-0">
                      <EmptyState
                        icon={Inbox}
                        title="Belum ada order"
                        description="Order baru yang masuk akan muncul di sini. Coba ubah filter atau buat order baru."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map(order => (
                    <TableRow key={order.id} className="group hover:bg-muted/50">
                      {(role === 'cs' || role === 'owner') && <TableCell><Checkbox checked={selected.includes(order.id)} onCheckedChange={() => toggleSelect(order.id)} /></TableCell>}
                      <TableCell className="font-mono text-xs">{order.order_number}</TableCell>
                      <TableCell className="text-sm">{formatDate(order.order_date)}</TableCell>
                      <TableCell>
                        <p className="font-medium text-sm">{order.customer_name}</p>
                        {order.customer_phone && <p className="text-xs text-muted-foreground">{order.customer_phone}</p>}
                      </TableCell>
                      <TableCell className="font-semibold text-sm">{formatRupiah(order.total)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{order.payment_method}</Badge></TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                      <TableCell>
                        {order.resi ? (
                          <div>
                            <p className="font-mono text-xs">{order.resi}</p>
                            <p className="text-xs text-muted-foreground">{order.ekspedisi || ''}</p>
                            {order.resi_status && (() => {
                              const rs = RESI_STATUSES.find(s => s.value === order.resi_status)
                              return <Badge variant="outline" className={`text-xs mt-0.5 ${rs?.color}`}>{rs?.label || order.resi_status}</Badge>
                            })()}
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{(order as any).campaigns?.campaign_name || '-'}</TableCell>
                      <TableCell><Button variant="ghost" size="icon" render={<Link href={`/orders/${order.id}`} />}><Eye className="w-4 h-4" /></Button></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Hal {page + 1} dari {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4 mr-1" />Prev</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="w-4 h-4 ml-1" /></Button>
          </div>
        </div>
      )}
    </div>
  )
}
