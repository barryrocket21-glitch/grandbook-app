'use client'
import { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ClipboardList, Search, Filter } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { INTERNAL_STATUSES, STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { format, parseISO } from 'date-fns'
import type { OrderStatus } from '@/lib/types'

const supabase = createClient()

interface OrderRow {
  id: number
  order_number: string
  status: OrderStatus
  customer_name: string
  customer_city: string | null
  channel_id: number | null
  total: number
  resi: string | null
  created_at: string
  channel?: { id: number; code: string }
}

export default function OrdersListPage() {
  return (
    <Suspense fallback={<div className="space-y-6"><PageHeader icon={ClipboardList} title="Daftar Order" /></div>}>
      <OrdersListInner />
    </Suspense>
  )
}

function OrdersListInner() {
  const searchParams = useSearchParams()
  const initialStatus = (searchParams.get('status') || 'ALL') as 'ALL' | OrderStatus
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>(initialStatus)
  const [channels, setChannels] = useState<Array<{ id: number; code: string }>>([])
  const [channelFilter, setChannelFilter] = useState('ALL')

  const load = async () => {
    setLoading(true)
    const [{ data }, { data: chs }] = await Promise.all([
      supabase
        .from('orders')
        .select('id, order_number, status, customer_name, customer_city, channel_id, total, resi, created_at, channel:courier_channels(id, code)')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('courier_channels').select('id, code').eq('active', true).order('code'),
    ])
    setRows((data as any) || [])
    setChannels((chs as any) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let list = rows
    if (statusFilter !== 'ALL') list = list.filter((r) => r.status === statusFilter)
    if (channelFilter !== 'ALL') list = list.filter((r) => String(r.channel_id) === channelFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          r.order_number.toLowerCase().includes(q) ||
          r.customer_name.toLowerCase().includes(q) ||
          (r.resi && r.resi.toLowerCase().includes(q))
      )
    }
    return list
  }, [rows, statusFilter, channelFilter, search])

  const counts = useMemo(() => {
    const map: Partial<Record<OrderStatus, number>> = {}
    for (const r of rows) map[r.status] = (map[r.status] || 0) + 1
    return map
  }, [rows])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="Daftar Order"
        description="Semua order yang masuk ke Grandbook (BARU s.d. DITERIMA / RETUR)."
      />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari order # / customer / resi..."
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as 'ALL' | OrderStatus)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent className="w-[220px]">
              <SelectItem value="ALL">Semua status ({rows.length})</SelectItem>
              {INTERNAL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]} ({counts[s] || 0})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={(v) => v && setChannelFilter(v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Channel">
              {(value: string | null) => {
                if (!value || value === 'ALL') return 'Semua channel'
                return channels.find((c) => String(c.id) === value)?.code ?? value
              }}
            </SelectValue></SelectTrigger>
            <SelectContent className="w-[260px]">
              <SelectItem value="ALL">Semua channel</SelectItem>
              {channels.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Resi</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <div className="h-4 bg-muted animate-pulse rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState
                      icon={rows.length === 0 ? ClipboardList : Filter}
                      title={rows.length === 0 ? 'Belum ada order' : 'Tidak ada hasil'}
                      description={
                        rows.length === 0
                          ? 'Tambah order via Input Order Baru / Bulk Upload / WA Paste.'
                          : 'Coba ubah filter.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      <Link href={`/orders/${r.id}`} className="text-violet-400 hover:underline">{r.order_number}</Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmt(r.created_at)}
                    </TableCell>
                    <TableCell className="text-sm">{r.customer_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.customer_city || '—'}</TableCell>
                    <TableCell className="text-xs">
                      {r.channel ? <Badge variant="outline" className="font-mono text-[10px]">{r.channel.code}</Badge> : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.resi || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">Rp {Number(r.total).toLocaleString('id-ID')}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE_COLOR[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function fmt(iso: string): string {
  try { return format(parseISO(iso), 'dd MMM HH:mm') } catch { return iso }
}
