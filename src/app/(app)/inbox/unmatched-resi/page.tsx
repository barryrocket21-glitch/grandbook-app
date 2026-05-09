'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Inbox, Search, Wrench, Loader2, Filter } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { format, parseISO } from 'date-fns'

const supabase = createClient()

interface InboxRow {
  id: number
  source_profile_id: number
  raw_resi: string
  raw_data: Record<string, any>
  resolved: boolean
  resolution: 'linked' | 'ignored' | 'created_new' | null
  resolved_to_order_id: number | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  source_profile?: { id: number; code: string; name: string }
  resolved_order?: { id: number; order_number: string }
}

interface OrderLite {
  id: number
  order_number: string
  external_order_id: string | null
  customer_name: string
  resi: string | null
}

interface ProfileLite { id: number; code: string; name: string }

export default function UnmatchedResiPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<InboxRow[]>([])
  const [profiles, setProfiles] = useState<ProfileLite[]>([])
  const [loading, setLoading] = useState(true)
  const [profileFilter, setProfileFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('PENDING')
  const [search, setSearch] = useState('')

  // Resolve dialog
  const [resolveOpen, setResolveOpen] = useState(false)
  const [active, setActive] = useState<InboxRow | null>(null)
  const [action, setAction] = useState<'link' | 'create' | 'ignore'>('link')
  const [orderQuery, setOrderQuery] = useState('')
  const [orderResults, setOrderResults] = useState<OrderLite[]>([])
  const [orderSearching, setOrderSearching] = useState(false)
  const [pickedOrderId, setPickedOrderId] = useState<number | null>(null)
  const [ignoreReason, setIgnoreReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: rs }, { data: ps }] = await Promise.all([
      supabase
        .from('inbox_unmatched_resi')
        .select(`
          *,
          source_profile:converter_profiles(id, code, name),
          resolved_order:orders!resolved_to_order_id(id, order_number)
        `)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('converter_profiles').select('id, code, name').order('code'),
    ])
    setRows((rs as any) || [])
    setProfiles(ps || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const openResolve = (row: InboxRow) => {
    setActive(row)
    setAction('link')
    setOrderQuery('')
    setOrderResults([])
    setPickedOrderId(null)
    setIgnoreReason('')
    setResolveOpen(true)
  }

  const searchOrders = async () => {
    if (!orderQuery.trim()) return
    setOrderSearching(true)
    try {
      const q = orderQuery.trim()
      // Search by order_number, external_order_id, or customer_name
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, external_order_id, customer_name, resi')
        .or(`order_number.ilike.%${q}%,external_order_id.ilike.%${q}%,customer_name.ilike.%${q}%`)
        .limit(20)
      if (error) throw error
      setOrderResults((data as any) || [])
      if ((data || []).length === 0) toast.info('Tidak ada order match.')
    } catch (err: any) {
      toast.error('Gagal cari', { description: err.message })
    } finally {
      setOrderSearching(false)
    }
  }

  const submitResolve = async () => {
    if (!active) return
    setSubmitting(true)
    try {
      const base: any = {
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id || null,
      }
      if (action === 'link') {
        if (!pickedOrderId) {
          toast.error('Pilih order untuk di-link')
          return
        }
        // Update orders to set resi from this raw_resi
        const { error: e1 } = await supabase
          .from('orders')
          .update({ resi: active.raw_resi })
          .eq('id', pickedOrderId)
        if (e1) throw e1
        const { error } = await supabase
          .from('inbox_unmatched_resi')
          .update({ ...base, resolution: 'linked', resolved_to_order_id: pickedOrderId })
          .eq('id', active.id)
        if (error) throw error
        toast.success(`Resi "${active.raw_resi}" ter-link ke order`)
      } else if (action === 'create') {
        const { error } = await supabase
          .from('inbox_unmatched_resi')
          .update({ ...base, resolution: 'created_new' })
          .eq('id', active.id)
        if (error) throw error
        toast.success('Inbox di-clear', {
          description: 'Fitur create order dari resi akan tersedia di Phase 4. Inbox sudah di-resolve.',
        })
      } else {
        // ignore — no notes column on inbox_unmatched_resi; reason dropped silently
        const { error } = await supabase
          .from('inbox_unmatched_resi')
          .update({ ...base, resolution: 'ignored' })
          .eq('id', active.id)
        if (error) throw error
        toast.success('Resi diabaikan')
      }
      setResolveOpen(false)
      setActive(null)
      load()
    } catch (err: any) {
      toast.error('Gagal resolve', { description: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = useMemo(() => {
    let list = rows
    if (statusFilter === 'PENDING') list = list.filter((r) => !r.resolved)
    if (statusFilter === 'RESOLVED') list = list.filter((r) => r.resolved)
    if (profileFilter !== 'ALL') list = list.filter((r) => String(r.source_profile_id) === profileFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((r) => r.raw_resi.toLowerCase().includes(q))
    }
    return list
  }, [rows, statusFilter, profileFilter, search])

  const pendingCount = useMemo(() => rows.filter((r) => !r.resolved).length, [rows])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Inbox}
        title="Unmatched Resi"
        description="Resi dari rekonsil ekspedisi yang belum nemu match di tabel orders. Resolve dengan link ke order existing, buat order baru, atau abaikan."
        badge={
          pendingCount > 0 ? (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
              {pendingCount} belum resolved
            </Badge>
          ) : null
        }
      />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari raw resi..." className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as any)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-[200px]">
              <SelectItem value="PENDING">Belum resolved</SelectItem>
              <SelectItem value="RESOLVED">Sudah resolved</SelectItem>
              <SelectItem value="ALL">Semua</SelectItem>
            </SelectContent>
          </Select>
          <Select value={profileFilter} onValueChange={(v) => v && setProfileFilter(v)}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Source Profile" />
            </SelectTrigger>
            <SelectContent className="w-[280px]">
              <SelectItem value="ALL">Semua source</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Raw Resi</TableHead>
                <TableHead>Receiver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resolution</TableHead>
                <TableHead>Linked Order</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
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
                      icon={rows.length === 0 ? Inbox : Filter}
                      title={rows.length === 0 ? 'Inbox kosong' : 'Tidak ada hasil'}
                      description={
                        rows.length === 0
                          ? 'Inbox akan otomatis terisi saat Converter Engine (Phase 3) nemu resi yang nggak match. Kamu bisa juga insert manual via SQL untuk testing.'
                          : 'Coba ubah filter.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const receiver =
                    (r.raw_data?.receiver_name as string) ||
                    (r.raw_data?.customer_name as string) ||
                    (r.raw_data?.['Nama Penerima'] as string) ||
                    null
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(r.created_at)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.source_profile ? (
                          <Badge variant="outline" className="font-mono text-[10px]">{r.source_profile.code}</Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.raw_resi}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{receiver || '—'}</TableCell>
                      <TableCell>
                        {r.resolved ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Resolved</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Belum</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.resolution ? (
                          <Badge variant="outline" className={
                            r.resolution === 'linked' ? 'bg-blue-500/10 text-blue-600 border-blue-500/30' :
                            r.resolution === 'created_new' ? 'bg-purple-500/10 text-purple-600 border-purple-500/30' :
                            'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'
                          }>
                            {r.resolution}
                          </Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.resolved_order ? r.resolved_order.order_number : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {!r.resolved && (
                          <Button variant="outline" size="sm" onClick={() => openResolve(r)}>
                            <Wrench className="w-3.5 h-3.5 mr-1" />Resolve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Resolve Dialog */}
      <Dialog open={resolveOpen} onOpenChange={(v) => { setResolveOpen(v); if (!v) setActive(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resolve Resi “{active?.raw_resi}”</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Source: <Badge variant="outline" className="font-mono text-[10px]">{active.source_profile?.code}</Badge></div>
                <div>Created: {fmtDate(active.created_at)}</div>
                <details className="mt-2">
                  <summary className="cursor-pointer hover:text-foreground">Lihat raw data</summary>
                  <pre className="mt-2 p-2 bg-muted rounded text-[10px] overflow-x-auto">
                    {JSON.stringify(active.raw_data, null, 2)}
                  </pre>
                </details>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Pilih Action</Label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={action === 'link'}
                      onChange={() => setAction('link')}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Link ke order existing</div>
                      <div className="text-xs text-muted-foreground">
                        Cari order yang sudah ada di sistem, set resi-nya = "{active.raw_resi}".
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={action === 'create'}
                      onChange={() => setAction('create')}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Buat order baru dari data ini</div>
                      <div className="text-xs text-muted-foreground">
                        ⚠️ Stub — fitur create order dari resi akan tersedia di Phase 4.
                        Saat ini cuma clear inbox dengan resolution=created_new.
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={action === 'ignore'}
                      onChange={() => setAction('ignore')}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Abaikan resi ini</div>
                      <div className="text-xs text-muted-foreground">
                        Tandai inbox sebagai resolved tanpa link/create.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {action === 'link' && (
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs">Cari Order</Label>
                  <div className="flex gap-2">
                    <Input
                      value={orderQuery}
                      onChange={(e) => setOrderQuery(e.target.value)}
                      placeholder="Order number / external ID / nama customer"
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchOrders())}
                    />
                    <Button onClick={searchOrders} disabled={orderSearching || !orderQuery.trim()} variant="outline">
                      {orderSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  {orderResults.length > 0 && (
                    <div className="border rounded max-h-60 overflow-y-auto">
                      {orderResults.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setPickedOrderId(o.id)}
                          className={`w-full text-left p-2 text-xs hover:bg-muted border-b last:border-b-0 ${pickedOrderId === o.id ? 'bg-violet-500/10' : ''}`}
                        >
                          <div className="font-medium">{o.order_number} {o.external_order_id && <span className="text-muted-foreground">· {o.external_order_id}</span>}</div>
                          <div className="text-muted-foreground">
                            {o.customer_name}
                            {o.resi && <span> · resi: {o.resi}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {action === 'ignore' && (
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs">Alasan (optional)</Label>
                  <Textarea
                    value={ignoreReason}
                    onChange={(e) => setIgnoreReason(e.target.value)}
                    rows={2}
                    placeholder="(catatan untuk diri sendiri — tidak disimpan ke DB di Phase 2B)"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setResolveOpen(false)}>Batal</Button>
                <Button
                  onClick={submitResolve}
                  disabled={submitting || (action === 'link' && !pickedOrderId)}
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                >
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Konfirmasi
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function fmtDate(iso: string): string {
  try {
    return format(parseISO(iso), 'dd MMM HH:mm')
  } catch {
    return iso
  }
}
