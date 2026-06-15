'use client'
import { useState, useEffect, useMemo } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Pencil, Loader2, Trash2, GitBranch, Search, Copy, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { canManageSettings } from '@/lib/auth/permissions'
import { statusMappingSchema, INTERNAL_STATUSES, STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import type { OrderStatus } from '@/lib/types'

const supabase = createClient()

interface Channel { id: number; code: string; name: string; active: boolean }
interface Mapping {
  id: number; channel_id: number; raw_status: string; internal_status: OrderStatus;
  notes: string | null; created_at: string;
  channel?: Channel
}

export default function StatusMappingPage() {
  const { role } = useAuth()
  const canManage = canManageSettings(role)
  const [channels, setChannels] = useState<Channel[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ channel_id: '', raw_status: '', internal_status: 'BARU' as OrderStatus, notes: '' })
  const [channelFilter, setChannelFilter] = useState('ALL')
  const [internalFilter, setInternalFilter] = useState<'ALL' | OrderStatus>('ALL')
  const [search, setSearch] = useState('')

  // Bulk copy state
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkSource, setBulkSource] = useState('')
  const [bulkTarget, setBulkTarget] = useState('')
  const [bulkRunning, setBulkRunning] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: chs }, { data: ms }] = await Promise.all([
      supabase.from('courier_channels').select('id, code, name, active').order('code'),
      supabase.from('courier_channel_statuses').select('*, channel:courier_channels(id, code, name)').order('id'),
    ])
    setChannels(chs || [])
    setMappings(ms || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const reset = () => { setForm({ channel_id: '', raw_status: '', internal_status: 'BARU', notes: '' }); setEditId(null) }

  const openEdit = (m: Mapping) => {
    setForm({ channel_id: String(m.channel_id), raw_status: m.raw_status, internal_status: m.internal_status, notes: m.notes || '' })
    setEditId(m.id); setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      channel_id: Number(form.channel_id),
      raw_status: form.raw_status.trim(),
      internal_status: form.internal_status,
      notes: form.notes || null,
    }
    const parsed = statusMappingSchema.safeParse(payload)
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal'); return }
    setSaving(true)
    try {
      const { error } = editId
        ? await supabase.from('courier_channel_statuses').update(parsed.data).eq('id', editId)
        : await supabase.from('courier_channel_statuses').insert(parsed.data)
      if (error) {
        if (error.code === '23505') throw new Error(`Mapping "${parsed.data.raw_status}" sudah ada untuk channel ini`)
        throw error
      }
      toast.success(editId ? 'Mapping diupdate' : 'Mapping ditambahkan')
      setOpen(false); reset(); load()
    } catch (err: any) { toast.error('Gagal simpan', { description: getErrorMessage(err) }) }
    finally { setSaving(false) }
  }

  const handleDelete = async (m: Mapping) => {
    if (!confirm(`Hapus mapping "${m.raw_status}" → ${m.internal_status} (${m.channel?.code})?`)) return
    const { error } = await supabase.from('courier_channel_statuses').delete().eq('id', m.id)
    if (error) { toast.error('Gagal hapus', { description: error.message }); return }
    toast.success('Mapping dihapus'); load()
  }

  const handleBulkCopy = async () => {
    if (!bulkSource || !bulkTarget) { toast.error('Pilih source dan target channel'); return }
    if (bulkSource === bulkTarget) { toast.error('Source dan target tidak boleh sama'); return }
    setBulkRunning(true)
    try {
      const sourceMappings = mappings.filter(m => String(m.channel_id) === bulkSource)
      if (sourceMappings.length === 0) { toast.error('Channel source belum punya mapping'); return }
      const payload = sourceMappings.map(m => ({
        channel_id: Number(bulkTarget),
        raw_status: m.raw_status,
        internal_status: m.internal_status,
        notes: m.notes,
      }))
      const { error } = await supabase
        .from('courier_channel_statuses')
        .upsert(payload, { onConflict: 'channel_id,raw_status', ignoreDuplicates: true })
      if (error) throw error
      toast.success(`${payload.length} mapping ter-copy`, {
        description: 'Mapping yang sudah ada di target di-skip.',
      })
      setBulkOpen(false); setBulkSource(''); setBulkTarget(''); load()
    } catch (err: any) { toast.error('Gagal copy', { description: getErrorMessage(err) }) }
    finally { setBulkRunning(false) }
  }

  const filtered = useMemo(() => {
    let list = mappings
    if (channelFilter !== 'ALL') list = list.filter(m => String(m.channel_id) === channelFilter)
    if (internalFilter !== 'ALL') list = list.filter(m => m.internal_status === internalFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m => m.raw_status.toLowerCase().includes(q))
    }
    return list
  }, [mappings, channelFilter, internalFilter, search])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={GitBranch}
        title="Status Mapping"
        description="Mapping raw status ekspedisi → status internal GrandBook (BARU / SIAP_KIRIM / DIKIRIM / DITERIMA / dst.)"
        actions={
          <PermissionGuard role={role} allowedRoles={['owner','admin']}>
            <div className="flex gap-2">
              <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
                <DialogTrigger render={<Button variant="outline"><Copy className="w-4 h-4 mr-2" />Salin dari Channel Lain</Button>} />
                <DialogContent>
                  <DialogHeader><DialogTitle>Salin Mapping antar Channel</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Source (channel asal)</Label>
                      <Select value={bulkSource} onValueChange={v => v && setBulkSource(v)}>
                        <SelectTrigger><SelectValue placeholder="Pilih source" /></SelectTrigger>
                        <SelectContent className="w-[280px]">
                          {channels.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-center"><ArrowRight className="w-4 h-4 mx-auto text-muted-foreground" /></div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Target (channel tujuan)</Label>
                      <Select value={bulkTarget} onValueChange={v => v && setBulkTarget(v)}>
                        <SelectTrigger><SelectValue placeholder="Pilih target" /></SelectTrigger>
                        <SelectContent className="w-[280px]">
                          {channels.filter(c => c.active && String(c.id) !== bulkSource).map(c => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Semua mapping dari source di-copy ke target. Mapping yang sudah ada di target di-skip (UNIQUE constraint).
                    </p>
                    <Button onClick={handleBulkCopy} disabled={bulkRunning || !bulkSource || !bulkTarget} className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">
                      {bulkRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salin
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
                <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}>
                  <Plus className="w-4 h-4 mr-2" />Tambah Mapping
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Status Mapping</DialogTitle></DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Channel *</Label>
                      <Select value={form.channel_id} onValueChange={v => v && setForm({ ...form, channel_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Pilih channel">{(value: string | null) => channels.find(c => String(c.id) === value)?.name ?? 'Pilih channel'}</SelectValue></SelectTrigger>
                        <SelectContent className="w-[300px]">
                          {channels.filter(c => c.active).map(c => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Raw Status *</Label>
                      <Input value={form.raw_status} onChange={e => setForm({ ...form, raw_status: e.target.value })} placeholder='Delivered, Returned to Sender, dll. (case-sensitive)' required />
                      <p className="text-[10px] text-muted-foreground">Sama persis dengan label di file rekonsil ekspedisi</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Internal Status *</Label>
                      <Select value={form.internal_status} onValueChange={v => v && setForm({ ...form, internal_status: v as OrderStatus })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent className="w-[220px]">
                          {INTERNAL_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{STATUS_LABEL[s]} ({s})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes</Label>
                      <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder='Opsional, e.g. "Kurir sudah pickup tapi belum on-the-way"' />
                    </div>
                    <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </PermissionGuard>
        }
      />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari raw status..." className="pl-9" />
          </div>
          <Select value={channelFilter} onValueChange={v => v && setChannelFilter(v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Channel">
              {(value: string | null) => {
                if (!value || value === 'ALL') return 'Semua channel'
                return channels.find(c => String(c.id) === value)?.code ?? value
              }}
            </SelectValue></SelectTrigger>
            <SelectContent className="w-[260px]">
              <SelectItem value="ALL">Semua channel</SelectItem>
              {channels.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={internalFilter} onValueChange={v => v && setInternalFilter(v as any)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Internal Status" /></SelectTrigger>
            <SelectContent className="w-[240px]">
              <SelectItem value="ALL">Semua internal</SelectItem>
              {INTERNAL_STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Raw Status</TableHead>
                <TableHead className="text-center">→</TableHead>
                <TableHead>Internal</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState icon={GitBranch} title={mappings.length === 0 ? 'Belum ada mapping' : 'Tidak ada hasil'} description={mappings.length === 0 ? 'Tambah mapping untuk tiap raw status yang muncul di file rekonsil ekspedisi. Mapping ini dipakai converter engine (Phase 3) untuk auto-update status order.' : 'Coba ubah filter.'} />
                  </TableCell>
                </TableRow>
              ) : filtered.map(m => (
                <TableRow key={m.id}>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{m.channel?.code}</Badge></TableCell>
                  <TableCell className="font-medium font-mono text-xs">{m.raw_status}</TableCell>
                  <TableCell className="text-center text-muted-foreground"><ArrowRight className="w-3.5 h-3.5 inline" /></TableCell>
                  <TableCell><Badge variant="outline" className={STATUS_BADGE_COLOR[m.internal_status]}>{STATUS_LABEL[m.internal_status]}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{m.notes || '—'}</TableCell>
                  <TableCell className="text-right">
                    <PermissionGuard role={role} allowedRoles={['owner','admin']}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(m)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(m)} className="text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </PermissionGuard>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!canManage && (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-3 pb-3 text-xs text-muted-foreground">
            ℹ️ Mode read-only. Hanya Owner/Admin yang bisa edit status mapping.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
