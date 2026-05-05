'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Search, Filter, RefreshCw, Eye, ChevronLeft, ChevronRight, Upload } from 'lucide-react'
import { formatRupiah, formatDate } from '@/lib/format'
import { ORDER_STATUSES, RESI_STATUSES } from '@/lib/constants'
import type { Order, OrderStatus } from '@/lib/types'
import Link from 'next/link'

const supabase = createClient()

const PAGE_SIZE = 50

export default function OrdersListPage() {
  const { role } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [bulkStatus, setBulkStatus] = useState<string>('')

  const fetchOrders = async () => {
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
  }

  useEffect(() => { fetchOrders() }, [page, statusFilter, dateFrom, dateTo])

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(0); fetchOrders() }

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Daftar Order</h1>
          <p className="text-muted-foreground mt-1">{totalCount} total order</p>
        </div>
        {(role === 'admin' || role === 'owner') && (
          <div className="flex gap-2">
            <Button variant="outline" render={<Link href="/orders/bulk-upload" />}>
              <Upload className="w-4 h-4 mr-1.5" />Upload Massal
            </Button>
            <Button render={<Link href="/orders/new" />} className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white">+ Input Order Baru</Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <form onSubmit={handleSearch} className="flex-1 flex gap-2">
              <Input placeholder="Cari nama / no. order..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
              <Button type="submit" variant="outline" size="icon"><Search className="w-4 h-4" /></Button>
            </form>
            <Select value={statusFilter} onValueChange={v => { if (v) { setStatusFilter(v); setPage(0) } }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Status</SelectItem>
                {ORDER_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} className="w-40" />
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} className="w-40" />
            <Button variant="outline" size="icon" onClick={fetchOrders}><RefreshCw className="w-4 h-4" /></Button>
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
                  <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">Tidak ada order ditemukan</TableCell></TableRow>
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
