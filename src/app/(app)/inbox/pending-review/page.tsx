'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Inbox, Search, Loader2, Check, X, AlertTriangle, Eye, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { canApproveOrders } from '@/lib/auth/permissions'
import { updateOrderStatus } from '@/lib/orders/order-number'
import { format, formatDistanceToNow, parseISO } from 'date-fns'

const supabase = createClient()

interface OrderRow {
  id: number
  order_number: string
  customer_name: string
  customer_city: string | null
  customer_address_detail: string | null
  total: number
  status: string
  created_at: string
  channel_id: number | null
  source_profile_id: number | null
  created_by: string | null
  channel?: { id: number; code: string; name: string }
  source_profile?: { id: number; code: string; name: string }
  creator?: { id: string; full_name: string }
  items?: Array<{ id: number; qty: number; product_name_raw: string }>
}

interface Filters {
  search: string
  channel: string
  source: string
}

export default function PendingReviewPage() {
  const { user, role } = useAuth()
  const canApprove = canApproveOrders(role)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<Array<{ id: number; code: string }>>([])
  const [profiles, setProfiles] = useState<Array<{ id: number; code: string; name: string }>>([])
  const [filters, setFilters] = useState<Filters>({ search: '', channel: 'ALL', source: 'ALL' })
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Action dialog
  const [actionOpen, setActionOpen] = useState(false)
  const [actionType, setActionType] = useState<'reject_fake' | 'reject_problem' | null>(null)
  const [actionTarget, setActionTarget] = useState<OrderRow[] | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [running, setRunning] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: orderRows }, { data: chs }, { data: profs }] = await Promise.all([
      supabase
        .from('orders')
        .select(`
          id, order_number, customer_name, customer_city, customer_address_detail,
          total, status, created_at, channel_id, source_profile_id, created_by,
          channel:courier_channels(id, code, name),
          source_profile:converter_profiles(id, code, name),
          creator:profiles!orders_created_by_fkey(id, full_name),
          items:order_items(id, qty, product_name_raw)
        `)
        .eq('status', 'BARU')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('courier_channels').select('id, code').eq('active', true).order('code'),
      supabase.from('converter_profiles').select('id, code, name').eq('active', true).order('code'),
    ])
    setRows((orderRows as any) || [])
    setChannels((chs as any) || [])
    setProfiles((profs as any) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let list = rows
    if (filters.search) {
      const q = filters.search.toLowerCase()
      list = list.filter(
        (r) =>
          r.order_number.toLowerCase().includes(q) ||
          r.customer_name.toLowerCase().includes(q)
      )
    }
    if (filters.channel !== 'ALL') list = list.filter((r) => String(r.channel_id) === filters.channel)
    if (filters.source !== 'ALL') list = list.filter((r) => String(r.source_profile_id) === filters.source)
    return list
  }, [rows, filters])

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAllVisible = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map((r) => r.id)))
  }

  const approveOrders = async (orderIds: number[]) => {
    if (orderIds.length === 0) return
    setRunning(true)
    try {
      let success = 0
      let fail = 0
      for (const id of orderIds) {
        try {
          await updateOrderStatus(supabase, {
            orderId: id,
            newStatus: 'SIAP_KIRIM',
            source: 'admin_review',
            note: 'Approved oleh admin',
          })
          success++
        } catch {
          fail++
        }
      }
      if (success > 0) toast.success(`${success} order ter-approve`)
      if (fail > 0) toast.error(`${fail} order gagal di-approve`)
      setSelectedIds(new Set())
      load()
    } finally {
      setRunning(false)
    }
  }

  const openRejectDialog = (type: 'reject_fake' | 'reject_problem', targets: OrderRow[]) => {
    setActionType(type)
    setActionTarget(targets)
    setActionReason('')
    setActionOpen(true)
  }

  const submitReject = async () => {
    if (!actionTarget || !actionType) return
    if (!actionReason.trim()) {
      toast.error('Reason wajib diisi')
      return
    }
    setRunning(true)
    try {
      const newStatus = actionType === 'reject_fake' ? 'FAKE' : 'PROBLEM'
      let success = 0
      for (const target of actionTarget) {
        try {
          await updateOrderStatus(supabase, {
            orderId: target.id,
            newStatus,
            source: 'admin_review',
            note: actionReason.trim(),
          })
          success++
        } catch {}
      }
      if (success > 0) toast.success(`${success} order di-reject (${newStatus})`)
      setActionOpen(false)
      setActionType(null)
      setActionTarget(null)
      setSelectedIds(new Set())
      load()
    } finally {
      setRunning(false)
    }
  }

  if (!canApprove) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Inbox} title="Pending Review" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner/admin yang bisa akses approval inbox.
          <Link href="/orders/list" className="ml-2 text-zinc-400 hover:underline">→ Lihat daftar order</Link>
        </CardContent></Card>
      </div>
    )
  }

  const selectedRows = filtered.filter((r) => selectedIds.has(r.id))

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Inbox}
        title="Pending Review"
        description="Order BARU dari upload/CS yang menunggu approval admin."
        badge={
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
            {rows.length} pending
          </Badge>
        }
      />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="Cari order # / customer..."
              className="pl-9"
            />
          </div>
          <Select value={filters.channel} onValueChange={(v) => v && setFilters({ ...filters, channel: v })}>
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
          <Select value={filters.source} onValueChange={(v) => v && setFilters({ ...filters, source: v })}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Source">
              {(value: string | null) => {
                if (!value || value === 'ALL') return 'Semua source'
                return profiles.find((p) => String(p.id) === value)?.code ?? value
              }}
            </SelectValue></SelectTrigger>
            <SelectContent className="w-[280px]">
              <SelectItem value="ALL">Semua source</SelectItem>
              {profiles.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedIds.size > 0 && (
        <Card className="border-zinc-500/30 bg-zinc-500/5">
          <CardContent className="pt-3 pb-3 flex flex-wrap items-center gap-2 justify-between">
            <div className="text-sm">
              <span className="font-bold text-zinc-500">{selectedIds.size}</span> order terpilih
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => approveOrders([...selectedIds])}
                disabled={running}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                <Check className="w-3.5 h-3.5 mr-1" />Approve {selectedIds.size}
              </Button>
              <Button size="sm" variant="outline" onClick={() => openRejectDialog('reject_fake', selectedRows)}>
                <X className="w-3.5 h-3.5 mr-1 text-red-500" />Tandai FAKE
              </Button>
              <Button size="sm" variant="outline" onClick={() => openRejectDialog('reject_problem', selectedRows)}>
                <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-500" />Tandai PROBLEM
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onCheckedChange={selectAllVisible}
                  />
                </TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <div className="h-4 bg-muted animate-pulse rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      icon={Inbox}
                      title={rows.length === 0 ? 'Tidak ada order pending' : 'Tidak ada hasil'}
                      description={
                        rows.length === 0
                          ? 'Semua order sudah ter-approve. Order baru dari upload/CS akan muncul di sini.'
                          : 'Coba ubah filter.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const itemSummary =
                    r.items && r.items.length > 0
                      ? r.items.slice(0, 2).map((it) => `${it.qty}× ${it.product_name_raw}`).join(' + ') +
                        (r.items.length > 2 ? ` +${r.items.length - 2} lainnya` : '')
                      : '—'
                  return (
                    <TableRow key={r.id} data-state={selectedIds.has(r.id) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onCheckedChange={() => toggleSelect(r.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        <Link href={`/orders/${r.id}`} className="text-zinc-400 hover:underline">
                          {r.order_number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {fmtRel(r.created_at)}
                        {r.creator?.full_name && (
                          <div className="text-[10px]">by {r.creator.full_name}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{r.customer_name}</div>
                        <div className="text-muted-foreground truncate max-w-[200px]">
                          {r.customer_city || '—'}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {itemSummary}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.channel ? (
                          <Badge variant="outline" className="font-mono text-[10px]">{r.channel.code}</Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        Rp {Number(r.total).toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.source_profile ? (
                          <Badge variant="outline" className="font-mono text-[10px]">{r.source_profile.code}</Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Link
                            href={`/orders/${r.id}`}
                            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => approveOrders([r.id])}
                            disabled={running}
                            className="text-emerald-500"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openRejectDialog('reject_fake', [r])}
                            className="text-red-500"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={actionOpen} onOpenChange={(v) => { setActionOpen(v); if (!v) { setActionTarget(null); setActionReason('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Tandai sebagai {actionType === 'reject_fake' ? 'FAKE' : 'PROBLEM'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {actionTarget?.length || 0} order akan di-reject. Reason akan tersimpan di status history.
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason *</Label>
              <Textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                rows={3}
                placeholder={
                  actionType === 'reject_fake'
                    ? 'e.g. nomor HP tidak aktif, alamat fiktif'
                    : 'e.g. customer minta ditunda, perlu konfirmasi ulang'
                }
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActionOpen(false)}>Batal</Button>
              <Button
                onClick={submitReject}
                disabled={running || !actionReason.trim()}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                {running && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                Konfirmasi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function fmtRel(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true })
  } catch {
    return iso
  }
}
