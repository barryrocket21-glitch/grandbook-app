'use client'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
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
import { Plus, Pencil, Loader2, Power, Search, Network } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { canManageSettings } from '@/lib/auth/permissions'
import { channelSchema } from '@/lib/schemas/settings'

const supabase = createClient()

interface Courier { id: number; code: string; name: string; active: boolean }
interface Channel {
  id: number; courier_id: number; code: string; name: string;
  aggregator: string | null; notes: string | null; active: boolean; created_at: string;
  courier?: Courier
  rates_count?: number
  status_count?: number
}

function ChannelsContent() {
  const { role } = useAuth()
  const searchParams = useSearchParams()
  const canManage = canManageSettings(role)
  const [couriers, setCouriers] = useState<Courier[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ courier_id: '', code: '', name: '', aggregator: '', notes: '', active: true })
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [courierFilter, setCourierFilter] = useState<string>(searchParams.get('courier') || 'ALL')
  const [aggFilter, setAggFilter] = useState<string>('ALL')

  const load = async () => {
    setLoading(true)
    const [{ data: cs }, { data: chs }, { data: rates }, { data: stats }] = await Promise.all([
      supabase.from('couriers').select('*').order('code'),
      supabase.from('courier_channels').select('*, courier:couriers(*)').order('code'),
      supabase.from('courier_channel_rates').select('channel_id').is('effective_to', null),
      supabase.from('courier_channel_statuses').select('channel_id'),
    ])
    const rateCounts = new Map<number, number>()
    ;(rates || []).forEach((r: any) => rateCounts.set(r.channel_id, (rateCounts.get(r.channel_id) || 0) + 1))
    const statusCounts = new Map<number, number>()
    ;(stats || []).forEach((s: any) => statusCounts.set(s.channel_id, (statusCounts.get(s.channel_id) || 0) + 1))
    setCouriers(cs || [])
    setChannels((chs || []).map((c: any) => ({
      ...c,
      rates_count: rateCounts.get(c.id) || 0,
      status_count: statusCounts.get(c.id) || 0,
    })))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const reset = () => { setForm({ courier_id: '', code: '', name: '', aggregator: '', notes: '', active: true }); setEditId(null) }

  const openEdit = (c: Channel) => {
    setForm({
      courier_id: String(c.courier_id), code: c.code, name: c.name,
      aggregator: c.aggregator || '', notes: c.notes || '', active: c.active,
    })
    setEditId(c.id); setOpen(true)
  }

  // Suggest code format saat aggregator dipilih
  const suggestedCode = useMemo(() => {
    if (!form.courier_id || !form.aggregator) return null
    const courier = couriers.find(c => c.id === Number(form.courier_id))
    if (!courier) return null
    return `${courier.code}_VIA_${form.aggregator.toUpperCase()}`
  }, [form.courier_id, form.aggregator, couriers])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      courier_id: Number(form.courier_id),
      code: form.code.toUpperCase(),
      name: form.name,
      aggregator: form.aggregator || null,
      notes: form.notes || null,
      active: form.active,
    }
    const parsed = channelSchema.safeParse(payload)
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal'); return }
    setSaving(true)
    try {
      const { error } = editId
        ? await supabase.from('courier_channels').update(parsed.data).eq('id', editId)
        : await supabase.from('courier_channels').insert(parsed.data)
      if (error) {
        if (error.code === '23505') throw new Error(`Code "${parsed.data.code}" sudah dipakai`)
        throw error
      }
      toast.success(editId ? 'Channel diupdate' : 'Channel ditambahkan')
      setOpen(false); reset(); load()
    } catch (err: any) { toast.error('Gagal simpan', { description: err.message }) }
    finally { setSaving(false) }
  }

  const toggleActive = async (c: Channel) => {
    const next = !c.active
    if (!next && !confirm(`Disable channel "${c.name}"?`)) return
    try {
      const { error } = await supabase.from('courier_channels').update({ active: next }).eq('id', c.id)
      if (error) throw error
      toast.success(next ? 'Channel aktif' : 'Channel di-disable')
      load()
    } catch (err: any) { toast.error('Gagal', { description: err.message }) }
  }

  const aggregators = useMemo(() => {
    const set = new Set<string>()
    channels.forEach(c => { if (c.aggregator) set.add(c.aggregator) })
    return Array.from(set).sort()
  }, [channels])

  const filtered = useMemo(() => {
    let list = channels
    if (!showInactive) list = list.filter(c => c.active)
    if (courierFilter !== 'ALL') list = list.filter(c => String(c.courier_id) === courierFilter)
    if (aggFilter !== 'ALL') {
      list = aggFilter === 'NONE' ? list.filter(c => !c.aggregator) : list.filter(c => c.aggregator === aggFilter)
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    }
    return list
  }, [channels, search, showInactive, courierFilter, aggFilter])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Network}
        title="Courier Channels"
        description="Jalur pengiriman per courier (direct atau via aggregator)"
        actions={
          <PermissionGuard role={role} allowedRoles={['owner','admin']}>
            <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
              <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}>
                <Plus className="w-4 h-4 mr-2" />Tambah Channel
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Channel</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Courier *</Label>
                    <Select value={form.courier_id} onValueChange={v => v && setForm({ ...form, courier_id: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih courier">
                          {(value: string | null) => couriers.find(c => String(c.id) === value)?.name ?? 'Pilih courier'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="w-[300px]">
                        {couriers.filter(c => c.active).map(c => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Aggregator (opsional)</Label>
                    <Input value={form.aggregator} onChange={e => setForm({ ...form, aggregator: e.target.value.toUpperCase() })} placeholder="MENGANTAR, LINCAH, SHIPPER, atau kosongkan untuk Direct" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Code *</Label>
                    <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SPX_DIRECT, NINJA_VIA_LINCAH" required />
                    {suggestedCode && form.code !== suggestedCode && (
                      <button type="button" onClick={() => setForm({ ...form, code: suggestedCode })} className="text-[10px] text-violet-400 hover:underline">
                        Pakai saran: <span className="font-mono">{suggestedCode}</span>
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nama *</Label>
                    <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="SPX (Direct), Ninja via Lincah" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Opsional" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={form.active} onCheckedChange={v => setForm({ ...form, active: !!v })} id="active" />
                    <Label htmlFor="active" className="cursor-pointer text-sm">Aktif</Label>
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
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari code/nama..." className="pl-9" />
          </div>
          <Select value={courierFilter} onValueChange={v => v && setCourierFilter(v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Courier">
              {(value: string | null) => {
                if (!value || value === 'ALL') return 'Semua courier'
                return couriers.find(c => String(c.id) === value)?.code ?? value
              }}
            </SelectValue></SelectTrigger>
            <SelectContent className="w-[220px]">
              <SelectItem value="ALL">Semua courier</SelectItem>
              {couriers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>)}
            </SelectContent>
          </Select>
          {aggregators.length > 0 && (
            <Select value={aggFilter} onValueChange={v => v && setAggFilter(v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Aggregator" /></SelectTrigger>
              <SelectContent className="w-[200px]">
                <SelectItem value="ALL">Semua</SelectItem>
                <SelectItem value="NONE">Direct (no aggregator)</SelectItem>
                {aggregators.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={showInactive} onCheckedChange={v => setShowInactive(!!v)} />
            <span>Tampilkan tidak aktif</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Aggregator</TableHead>
                <TableHead className="text-center">Rates</TableHead>
                <TableHead className="text-center">Status Map</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={8}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState icon={Network} title={channels.length === 0 ? 'Belum ada channel' : 'Tidak ada hasil'} description={channels.length === 0 ? 'Tambahkan channel pertama. Pastikan courier sudah ada dulu di menu Couriers.' : 'Coba ubah filter.'} />
                  </TableCell>
                </TableRow>
              ) : filtered.map(c => (
                <TableRow key={c.id} className={!c.active ? 'opacity-60' : ''}>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{c.code}</Badge></TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{c.courier?.code}</Badge></TableCell>
                  <TableCell>{c.aggregator ? <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600">{c.aggregator}</Badge> : <span className="text-xs text-muted-foreground">Direct</span>}</TableCell>
                  <TableCell className="text-center text-xs">{c.rates_count}</TableCell>
                  <TableCell className="text-center text-xs">{c.status_count}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={c.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-muted-foreground'}>
                      {c.active ? 'Active' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <PermissionGuard role={role} allowedRoles={['owner','admin']}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => toggleActive(c)} className={c.active ? '' : 'text-emerald-500'}>
                          <Power className="w-3.5 h-3.5" />
                        </Button>
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
            ℹ️ Mode read-only. Hanya Owner/Admin yang bisa edit channels.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function CourierChannelsPage() {
  return <Suspense><ChannelsContent /></Suspense>
}
