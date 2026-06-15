'use client'
import { useState, useEffect, useMemo } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Inbox, Search, Wrench, Loader2, Filter, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  INTERNAL_STATUSES,
  STATUS_BADGE_COLOR,
  STATUS_LABEL,
} from '@/lib/schemas/settings'
import type { OrderStatus } from '@/lib/types'
import { format, parseISO } from 'date-fns'

const supabase = createClient()

interface InboxRow {
  id: number
  channel_id: number
  raw_status: string
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
  resolved: boolean
  resolved_to_internal: OrderStatus | null
  resolved_at: string | null
  resolved_by: string | null
  channel?: { id: number; code: string; name: string }
}

interface ChannelLite { id: number; code: string; name: string; active: boolean }

export default function UnmappedStatusesPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<InboxRow[]>([])
  const [channels, setChannels] = useState<ChannelLite[]>([])
  const [loading, setLoading] = useState(true)
  const [channelFilter, setChannelFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('PENDING')
  const [search, setSearch] = useState('')

  const [mapOpen, setMapOpen] = useState(false)
  const [active, setActive] = useState<InboxRow | null>(null)
  const [pickedInternal, setPickedInternal] = useState<OrderStatus>('DIKIRIM')
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: rs }, { data: chs }] = await Promise.all([
      supabase
        .from('inbox_unmapped_statuses')
        .select('*, channel:courier_channels(id, code, name)')
        .order('occurrence_count', { ascending: false })
        .order('last_seen_at', { ascending: false })
        .limit(500),
      supabase.from('courier_channels').select('id, code, name, active').order('code'),
    ])
    setRows((rs as any) || [])
    setChannels(chs || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const openMap = (r: InboxRow) => {
    setActive(r)
    setPickedInternal('DIKIRIM')
    setMapOpen(true)
  }

  const submitMap = async () => {
    if (!active) return
    setSubmitting(true)
    try {
      // Step 1: Insert (or upsert) into courier_channel_statuses
      const mappingPayload = {
        channel_id: active.channel_id,
        raw_status: active.raw_status,
        internal_status: pickedInternal,
      }
      const { error: insErr } = await supabase
        .from('courier_channel_statuses')
        .insert(mappingPayload)

      let alreadyExists = false
      if (insErr) {
        if ((insErr as any).code === '23505') {
          alreadyExists = true
        } else {
          throw insErr
        }
      }

      // Step 2: Mark inbox row resolved
      const { error: upErr } = await supabase
        .from('inbox_unmapped_statuses')
        .update({
          resolved: true,
          resolved_to_internal: pickedInternal,
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id || null,
        })
        .eq('id', active.id)
      if (upErr) throw upErr

      if (alreadyExists) {
        toast.warning('Mapping sudah ada sebelumnya', {
          description: 'Inbox di-set resolved tanpa insert baru.',
        })
      } else {
        toast.success(`Status "${active.raw_status}" → ${pickedInternal} ter-mapping`)
      }
      setMapOpen(false)
      setActive(null)
      load()
    } catch (err: any) {
      toast.error('Gagal map', { description: getErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const submitIgnore = async () => {
    if (!active) return
    setSubmitting(true)
    try {
      // Mark inbox row resolved without inserting mapping
      const { error } = await supabase
        .from('inbox_unmapped_statuses')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id || null,
        })
        .eq('id', active.id)
      if (error) throw error
      toast.success('Status diabaikan')
      setMapOpen(false)
      setActive(null)
      load()
    } catch (err: any) {
      toast.error('Gagal abaikan', { description: getErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = useMemo(() => {
    let list = rows
    if (statusFilter === 'PENDING') list = list.filter((r) => !r.resolved)
    if (statusFilter === 'RESOLVED') list = list.filter((r) => r.resolved)
    if (channelFilter !== 'ALL') list = list.filter((r) => String(r.channel_id) === channelFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((r) => r.raw_status.toLowerCase().includes(q))
    }
    return list
  }, [rows, statusFilter, channelFilter, search])

  const pendingCount = useMemo(() => rows.filter((r) => !r.resolved).length, [rows])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Inbox}
        title="Unmapped Statuses"
        description="Raw status dari rekonsil ekspedisi yang belum dimapping ke internal status. Map → otomatis insert ke courier_channel_statuses + clear inbox."
        badge={
          pendingCount > 0 ? (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
              {pendingCount} belum mapped
            </Badge>
          ) : null
        }
      />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari raw status..." className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as any)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-[200px]">
              <SelectItem value="PENDING">Belum mapped</SelectItem>
              <SelectItem value="RESOLVED">Sudah mapped</SelectItem>
              <SelectItem value="ALL">Semua</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={(v) => v && setChannelFilter(v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Channel">
                {(value: string | null) => {
                  if (!value || value === 'ALL') return 'Semua channel'
                  return channels.find((c) => String(c.id) === value)?.code ?? value
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-[260px]">
              <SelectItem value="ALL">Semua channel</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>
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
                <TableHead>First Seen</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Raw Status</TableHead>
                <TableHead className="text-right">Occurrences</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mapped To</TableHead>
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
                          ? 'Inbox akan otomatis terisi saat Converter Engine (Phase 3) nemu raw status yang belum dikenali. Insert manual via SQL untuk testing.'
                          : 'Coba ubah filter.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.first_seen_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.last_seen_at)}</TableCell>
                    <TableCell className="text-xs">
                      {r.channel ? (
                        <Badge variant="outline" className="font-mono text-[10px]">{r.channel.code}</Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.raw_status}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          r.occurrence_count > 10
                            ? 'bg-red-500/10 text-red-600 border-red-500/30'
                            : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'
                        }
                      >
                        {r.occurrence_count}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.resolved ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Resolved</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Belum</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.resolved_to_internal ? (
                        <Badge variant="outline" className={STATUS_BADGE_COLOR[r.resolved_to_internal]}>
                          {STATUS_LABEL[r.resolved_to_internal]}
                        </Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {!r.resolved && (
                        <Button variant="outline" size="sm" onClick={() => openMap(r)}>
                          <Wrench className="w-3.5 h-3.5 mr-1" />Map
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Map Dialog */}
      <Dialog open={mapOpen} onOpenChange={(v) => { setMapOpen(v); if (!v) setActive(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Map Status</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Channel</Label>
                <div>
                  <Badge variant="outline" className="font-mono text-xs">
                    {active.channel?.code} — {active.channel?.name}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Raw Status</Label>
                <div className="font-mono text-sm bg-muted px-3 py-2 rounded">{active.raw_status}</div>
              </div>
              <div className="text-center text-muted-foreground"><ArrowRight className="w-4 h-4 mx-auto" /></div>
              <div className="space-y-1.5">
                <Label className="text-xs">Map ke Internal Status *</Label>
                <Select value={pickedInternal} onValueChange={(v) => v && setPickedInternal(v as OrderStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="w-[260px]">
                    {INTERNAL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABEL[s]} ({s})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Mapping ini akan disimpan permanent ke courier_channel_statuses.
                </p>
              </div>
              <div className="flex justify-between gap-2 border-t pt-3">
                <Button variant="ghost" onClick={submitIgnore} disabled={submitting}>
                  Abaikan untuk sekarang
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setMapOpen(false)}>Batal</Button>
                  <Button
                    onClick={submitMap}
                    disabled={submitting}
                    className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                  >
                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Map status ini
                  </Button>
                </div>
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
