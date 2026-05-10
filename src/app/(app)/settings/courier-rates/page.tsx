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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { Plus, Pencil, Loader2, Trash2, Coins } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { canManageSettings } from '@/lib/auth/permissions'
import { rateSchema, RATE_KEY_PRESETS, formatRateValue } from '@/lib/schemas/settings'
import { formatDate } from '@/lib/format'

const supabase = createClient()

interface Channel { id: number; code: string; name: string; active: boolean }
interface Rate {
  id: number; channel_id: number; rate_key: string; rate_value: number;
  effective_from: string; effective_to: string | null;
  notes: string | null; created_at: string;
  channel?: Channel
}

const today = () => new Date().toISOString().split('T')[0]

export default function CourierRatesPage() {
  const { role } = useAuth()
  const canManage = canManageSettings(role)
  const [channels, setChannels] = useState<Channel[]>([])
  const [rates, setRates] = useState<Rate[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    channel_id: '', rate_key: '', custom_key: '', rate_value: 0,
    effective_from: today(), effective_to: '', notes: '',
  })
  const [channelFilter, setChannelFilter] = useState('ALL')
  const [keyFilter, setKeyFilter] = useState('ALL')
  const [showExpired, setShowExpired] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: chs }, { data: rs }] = await Promise.all([
      supabase.from('courier_channels').select('id, code, name, active').order('code'),
      supabase.from('courier_channel_rates').select('*, channel:courier_channels(id, code, name)').order('effective_from', { ascending: false }),
    ])
    setChannels(chs || [])
    setRates(rs || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const reset = () => {
    setForm({ channel_id: '', rate_key: '', custom_key: '', rate_value: 0, effective_from: today(), effective_to: '', notes: '' })
    setEditId(null)
  }

  const openEdit = (r: Rate) => {
    const isPreset = (RATE_KEY_PRESETS as readonly string[]).includes(r.rate_key)
    setForm({
      channel_id: String(r.channel_id),
      rate_key: isPreset ? r.rate_key : '__custom__',
      custom_key: isPreset ? '' : r.rate_key,
      rate_value: Number(r.rate_value),
      effective_from: r.effective_from,
      effective_to: r.effective_to || '',
      notes: r.notes || '',
    })
    setEditId(r.id); setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const finalKey = form.rate_key === '__custom__' ? form.custom_key.toLowerCase().trim() : form.rate_key
    const payload = {
      channel_id: Number(form.channel_id),
      rate_key: finalKey,
      rate_value: form.rate_value,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
      notes: form.notes || null,
    }
    const parsed = rateSchema.safeParse(payload)
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal'); return }
    setSaving(true)
    try {
      // Replace logic: kalau create new dan ada rate aktif untuk pasangan (channel, key)
      if (!editId) {
        const { data: existing } = await supabase
          .from('courier_channel_rates')
          .select('id, effective_from')
          .eq('channel_id', payload.channel_id)
          .eq('rate_key', payload.rate_key)
          .is('effective_to', null)
          .limit(1)
        if (existing && existing.length > 0) {
          const ex = existing[0]
          const newFromDate = new Date(payload.effective_from)
          newFromDate.setDate(newFromDate.getDate() - 1)
          const oldEndDate = newFromDate.toISOString().split('T')[0]
          if (!confirm(`Rate "${payload.rate_key}" untuk channel ini sudah ada (aktif sejak ${ex.effective_from}). Set rate lama berakhir di ${oldEndDate}?`)) {
            setSaving(false); return
          }
          await supabase.from('courier_channel_rates').update({ effective_to: oldEndDate }).eq('id', ex.id)
        }
      }
      const { error } = editId
        ? await supabase.from('courier_channel_rates').update(parsed.data).eq('id', editId)
        : await supabase.from('courier_channel_rates').insert(parsed.data)
      if (error) {
        if (error.code === '23505') throw new Error('Rate untuk channel + key + tanggal mulai sudah ada')
        throw error
      }
      toast.success(editId ? 'Rate diupdate' : 'Rate ditambahkan')
      setOpen(false); reset(); load()
    } catch (err: any) { toast.error('Gagal simpan', { description: err.message }) }
    finally { setSaving(false) }
  }

  const handleDelete = async (r: Rate) => {
    if (!confirm(`Hapus rate "${r.rate_key}" untuk channel ${r.channel?.code}?\n\nKalau rate sudah dipakai di order, hapus akan ditolak (set effective_to saja).`)) return
    const { error } = await supabase.from('courier_channel_rates').delete().eq('id', r.id)
    if (error) {
      if (error.code === '23503') {
        toast.error('Rate sudah dipakai di order. Set effective_to saja, jangan hapus.')
      } else {
        toast.error('Gagal hapus', { description: error.message })
      }
      return
    }
    toast.success('Rate dihapus'); load()
  }

  const uniqueKeys = useMemo(() => Array.from(new Set(rates.map(r => r.rate_key))).sort(), [rates])

  const filtered = useMemo(() => {
    let list = rates
    if (!showExpired) list = list.filter(r => !r.effective_to)
    if (channelFilter !== 'ALL') list = list.filter(r => String(r.channel_id) === channelFilter)
    if (keyFilter !== 'ALL') list = list.filter(r => r.rate_key === keyFilter)
    return list
  }, [rates, channelFilter, keyFilter, showExpired])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Courier Rates"
        description="Rate-card per channel (fee COD, cashback ongkir, dll.) dengan effective period"
        actions={
          <PermissionGuard role={role} allowedRoles={['owner','admin']}>
            <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
              <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}>
                <Plus className="w-4 h-4 mr-2" />Tambah Rate
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Rate</DialogTitle></DialogHeader>
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
                    <Label className="text-xs">Rate Key *</Label>
                    <Select value={form.rate_key} onValueChange={v => v && setForm({ ...form, rate_key: v })}>
                      <SelectTrigger><SelectValue placeholder="Pilih atau custom" /></SelectTrigger>
                      <SelectContent className="w-[280px]">
                        {RATE_KEY_PRESETS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                        <SelectItem value="__custom__">+ Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.rate_key === '__custom__' && (
                      <Input value={form.custom_key} onChange={e => setForm({ ...form, custom_key: e.target.value })} placeholder="lowercase_with_underscore" className="mt-1.5" />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nilai *</Label>
                    <Input type="number" step="0.0001" value={form.rate_value} onChange={e => setForm({ ...form, rate_value: Number(e.target.value) })} required />
                    <p className="text-[10px] text-muted-foreground">Untuk percent: 3.5 = 3.5%. Untuk amount: 5000 = Rp 5.000.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mulai *</Label>
                      <Input type="date" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Berakhir</Label>
                      <Input type="date" value={form.effective_to} onChange={e => setForm({ ...form, effective_to: e.target.value })} />
                      <p className="text-[10px] text-muted-foreground">Kosong = aktif</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
                  </div>
                  <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </PermissionGuard>
        }
      />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <Select value={channelFilter} onValueChange={v => v && setChannelFilter(v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Channel">
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
          {uniqueKeys.length > 0 && (
            <Select value={keyFilter} onValueChange={v => v && setKeyFilter(v)}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Rate Key" /></SelectTrigger>
              <SelectContent className="w-[280px]">
                <SelectItem value="ALL">Semua key</SelectItem>
                {uniqueKeys.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={showExpired} onCheckedChange={v => setShowExpired(!!v)} />
            <span>Tampilkan rate yang sudah berakhir</span>
          </label>
          <p className="text-xs text-muted-foreground self-center sm:ml-auto">{filtered.length} rate</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Rate Key</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
                <TableHead>Mulai</TableHead>
                <TableHead>Berakhir</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState icon={Coins} title="Belum ada rate" description="Tambahkan rate untuk channel. Untuk update rate yang berubah tiap periode, bikin entry baru — sistem auto-set effective_to rate lama." />
                  </TableCell>
                </TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id} className={r.effective_to ? 'opacity-70' : ''}>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{r.channel?.code}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.rate_key}</Badge></TableCell>
                  <TableCell className="text-right font-semibold">{formatRateValue(r.rate_key, Number(r.rate_value))}</TableCell>
                  <TableCell className="text-sm">{formatDate(r.effective_from)}</TableCell>
                  <TableCell>
                    {r.effective_to ? (
                      <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600 text-xs">Berakhir {formatDate(r.effective_to)}</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 text-xs">Aktif</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.notes || '—'}</TableCell>
                  <TableCell className="text-right">
                    <PermissionGuard role={role} allowedRoles={['owner','admin']}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(r)} className="text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
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
            ℹ️ Mode read-only. Hanya Owner/Admin yang bisa edit rates.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
