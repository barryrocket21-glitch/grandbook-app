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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { Plus, Pencil, Loader2, Power, Search, Truck } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { canManageSettings } from '@/lib/auth/permissions'
import { courierSchema } from '@/lib/schemas/settings'
import Link from 'next/link'

const supabase = createClient()

interface Courier {
  id: number
  code: string
  name: string
  active: boolean
  created_at: string
  channel_count?: number
}

export default function CouriersPage() {
  const { role } = useAuth()
  const canManage = canManageSettings(role)
  const [couriers, setCouriers] = useState<Courier[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ code: '', name: '', active: true })
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: cs }, { data: chs }] = await Promise.all([
      supabase.from('couriers').select('*').order('code'),
      supabase.from('courier_channels').select('courier_id'),
    ])
    const counts = new Map<number, number>()
    ;(chs || []).forEach((c: any) => counts.set(c.courier_id, (counts.get(c.courier_id) || 0) + 1))
    setCouriers((cs || []).map((c: any) => ({ ...c, channel_count: counts.get(c.id) || 0 })))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const reset = () => { setForm({ code: '', name: '', active: true }); setEditId(null) }

  const openEdit = (c: Courier) => {
    setForm({ code: c.code, name: c.name, active: c.active })
    setEditId(c.id); setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = courierSchema.safeParse({ code: form.code.toUpperCase(), name: form.name, active: form.active })
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal'); return }
    setSaving(true)
    try {
      const { error } = editId
        ? await supabase.from('couriers').update(parsed.data).eq('id', editId)
        : await supabase.from('couriers').insert(parsed.data)
      if (error) {
        if (error.code === '23505') throw new Error(`Code "${parsed.data.code}" sudah dipakai`)
        throw error
      }
      toast.success(editId ? 'Courier diupdate' : 'Courier ditambahkan')
      setOpen(false); reset(); load()
    } catch (err: any) { toast.error('Gagal simpan', { description: getErrorMessage(err) }) }
    finally { setSaving(false) }
  }

  const toggleActive = async (c: Courier) => {
    const next = !c.active
    if (!next && (c.channel_count || 0) > 0) {
      if (!confirm(`Disable courier "${c.name}"? ${c.channel_count} channel terkait akan ikut di-disable.`)) return
    } else if (!next) {
      if (!confirm(`Disable courier "${c.name}"?`)) return
    }
    try {
      const { error } = await supabase.from('couriers').update({ active: next }).eq('id', c.id)
      if (error) throw error
      // Cascade disable channels (app-level)
      if (!next && (c.channel_count || 0) > 0) {
        await supabase.from('courier_channels').update({ active: false }).eq('courier_id', c.id)
      }
      toast.success(next ? `${c.name} aktif` : `${c.name} di-disable`)
      load()
    } catch (err: any) { toast.error('Gagal', { description: getErrorMessage(err) }) }
  }

  const filtered = useMemo(() => {
    let list = couriers
    if (!showInactive) list = list.filter(c => c.active)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    }
    return list
  }, [couriers, search, showInactive])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Truck}
        title="Couriers"
        description="Master data ekspedisi (induk dari channel)"
        actions={
          <PermissionGuard role={role} allowedRoles={['owner','admin']}>
            <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
              <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}>
                <Plus className="w-4 h-4 mr-2" />Tambah Courier
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Courier</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Code *</Label>
                    <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SPX, JNE, NINJA" required />
                    <p className="text-[10px] text-muted-foreground">Uppercase, alphanumeric/underscore, 2-20 char</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Nama *</Label>
                    <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Shopee Express" required />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={form.active} onCheckedChange={v => setForm({ ...form, active: !!v })} id="active" />
                    <Label htmlFor="active" className="cursor-pointer">Aktif</Label>
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
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari code atau nama..." className="pl-9" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={showInactive} onCheckedChange={v => setShowInactive(!!v)} />
            <span>Tampilkan tidak aktif</span>
          </label>
          <p className="text-xs text-muted-foreground self-center sm:ml-auto">{filtered.length} dari {couriers.length}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead className="text-center">Channels</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={5}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={Truck}
                      title={couriers.length === 0 ? 'Belum ada courier' : 'Tidak ada hasil'}
                      description={couriers.length === 0 ? 'Tambahkan courier pertama untuk mulai.' : 'Coba ubah filter.'}
                    />
                  </TableCell>
                </TableRow>
              ) : filtered.map(c => (
                <TableRow key={c.id} className={!c.active ? 'opacity-60' : ''}>
                  <TableCell><Badge variant="outline" className="font-mono">{c.code}</Badge></TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-center">
                    {c.channel_count && c.channel_count > 0 ? (
                      <Link href={`/settings/courier-channels?courier=${c.id}`} className="text-xs text-violet-400 hover:underline">{c.channel_count} channel</Link>
                    ) : <span className="text-xs text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={c.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-muted-foreground'}>
                      {c.active ? 'Active' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <PermissionGuard role={role} allowedRoles={['owner','admin']}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" title={c.active ? 'Disable' : 'Aktifkan'} onClick={() => toggleActive(c)} className={c.active ? '' : 'text-emerald-500'}>
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
            ℹ️ Mode read-only. Hanya Owner/Admin yang bisa edit master courier.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
