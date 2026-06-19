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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { canManageSettings } from '@/lib/auth/permissions'
import { supplierSchema, normalizeSupplierForm, type SupplierFormData } from '@/lib/schemas/supplier'
import type { Supplier } from '@/lib/types'
import { Plus, Pencil, Power, Search, Warehouse, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const supabase = createClient()

type SupplierRow = Supplier & {
  product_count?: number
  order_count?: number
}

const EMPTY_FORM: SupplierFormData = {
  name: '',
  code: '',
  address: '',
  city: '',
  province: '',
  pic_name: '',
  pic_phone: '',
  notes: '',
  active: true,
}

export default function SuppliersPage() {
  const { profile, role } = useAuth()
  const orgId = profile?.organization_id ?? null
  const canManage = canManageSettings(role)

  const [rows, setRows] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<SupplierFormData>(EMPTY_FORM)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [toggleTarget, setToggleTarget] = useState<SupplierRow | null>(null)
  const [toggling, setToggling] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [{ data: ss, error: sErr }, { data: ps }, { data: os }] = await Promise.all([
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('products').select('supplier_id').not('supplier_id', 'is', null),
        supabase.from('orders').select('origin_supplier_id').not('origin_supplier_id', 'is', null),
      ])
      if (sErr) throw sErr
      const productCounts = new Map<number, number>()
      ;(ps || []).forEach((p: { supplier_id: number | null }) => {
        if (p.supplier_id) productCounts.set(p.supplier_id, (productCounts.get(p.supplier_id) || 0) + 1)
      })
      const orderCounts = new Map<number, number>()
      ;(os || []).forEach((o: { origin_supplier_id: number | null }) => {
        if (o.origin_supplier_id) orderCounts.set(o.origin_supplier_id, (orderCounts.get(o.origin_supplier_id) || 0) + 1)
      })
      setRows((ss || []).map((s: Supplier) => ({
        ...s,
        product_count: productCounts.get(s.id) || 0,
        order_count: orderCounts.get(s.id) || 0,
      })))
    } catch (err) {
      toast.error('Gagal load supplier', { description: getErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const reset = () => {
    setForm(EMPTY_FORM)
    setEditId(null)
  }

  const openEdit = (s: SupplierRow) => {
    setForm({
      name: s.name,
      code: s.code ?? '',
      address: s.address ?? '',
      city: s.city ?? '',
      province: s.province ?? '',
      pic_name: s.pic_name ?? '',
      pic_phone: s.pic_phone ?? '',
      notes: s.notes ?? '',
      active: s.active,
    })
    setEditId(s.id)
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId) { toast.error('Organization belum siap'); return }
    const parsed = supplierSchema.safeParse(form)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal')
      return
    }
    const payload = normalizeSupplierForm(parsed.data)
    setSaving(true)
    try {
      const { error } = editId
        ? await supabase.from('suppliers').update(payload).eq('id', editId)
        : await supabase.from('suppliers').insert({ ...payload, organization_id: orgId })
      if (error) {
        if (error.code === '23505') throw new Error(`Code "${payload.code}" sudah dipakai supplier lain`)
        throw error
      }
      toast.success(editId ? 'Supplier diupdate' : 'Supplier ditambahkan')
      setOpen(false)
      reset()
      load()
    } catch (err) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const confirmToggle = async () => {
    if (!toggleTarget) return
    const next = !toggleTarget.active
    setToggling(true)
    try {
      const { error } = await supabase
        .from('suppliers')
        .update({ active: next })
        .eq('id', toggleTarget.id)
      if (error) throw error
      toast.success(next ? `${toggleTarget.name} diaktifkan` : `${toggleTarget.name} di-disable`)
      setToggleTarget(null)
      load()
    } catch (err) {
      toast.error('Gagal', { description: getErrorMessage(err) })
    } finally {
      setToggling(false)
    }
  }

  const filtered = useMemo(() => {
    let list = rows
    if (!showInactive) list = list.filter(r => r.active)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.name.toLowerCase().includes(q)
        || (r.code ?? '').toLowerCase().includes(q)
        || (r.city ?? '').toLowerCase().includes(q)
        || (r.province ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, search, showInactive])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Warehouse}
        title="Suppliers"
        description="Master gudang dropship — link produk & order ke supplier asal"
        actions={
          <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
            <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
              <DialogTrigger render={<Button className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white shadow-lg shadow-zinc-500/20" />}>
                <Plus className="w-4 h-4 mr-2" />Tambah Supplier
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editId ? 'Edit' : 'Tambah'} Supplier</DialogTitle>
                  <DialogDescription>
                    Field bertanda * wajib. Code (opsional) sebaiknya diisi pakai format singkat seperti &quot;JKT-KRAN&quot;.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Nama Supplier *</Label>
                      <Input
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        placeholder="Supplier Jakarta - Kran"
                        maxLength={200}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Code</Label>
                      <Input
                        value={form.code}
                        onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                        placeholder="JKT-KRAN"
                        maxLength={20}
                      />
                      <p className="text-[10px] text-muted-foreground">Huruf, angka, dash. Unik per organisasi.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Kota</Label>
                      <Input
                        value={form.city}
                        onChange={e => setForm({ ...form, city: e.target.value })}
                        placeholder="Jakarta Pusat"
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Provinsi</Label>
                      <Input
                        value={form.province}
                        onChange={e => setForm({ ...form, province: e.target.value })}
                        placeholder="DKI Jakarta"
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>PIC (Nama)</Label>
                      <Input
                        value={form.pic_name}
                        onChange={e => setForm({ ...form, pic_name: e.target.value })}
                        placeholder="Pak Budi"
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>PIC (No HP)</Label>
                      <Input
                        value={form.pic_phone}
                        onChange={e => setForm({ ...form, pic_phone: e.target.value })}
                        placeholder="08123456789"
                        maxLength={20}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Alamat</Label>
                      <Textarea
                        value={form.address}
                        onChange={e => setForm({ ...form, address: e.target.value })}
                        placeholder="Jl. Industri No. 12, Cempaka Putih"
                        maxLength={500}
                        rows={2}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Catatan</Label>
                      <Textarea
                        value={form.notes}
                        onChange={e => setForm({ ...form, notes: e.target.value })}
                        placeholder="Misal: pickup hari Senin & Kamis, fee packing 2k/produk"
                        maxLength={1000}
                        rows={2}
                      />
                    </div>
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <Checkbox
                        checked={form.active}
                        onCheckedChange={v => setForm({ ...form, active: v === true })}
                        id="active"
                      />
                      <Label htmlFor="active" className="cursor-pointer">Supplier aktif</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => { setOpen(false); reset() }} disabled={saving}>
                      Batal
                    </Button>
                    <Button
                      type="submit"
                      className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white shadow-lg shadow-zinc-500/20"
                      disabled={saving}
                    >
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan
                    </Button>
                  </DialogFooter>
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
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari nama, code, kota, provinsi..."
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={showInactive} onCheckedChange={v => setShowInactive(v === true)} />
            <span>Tampilkan tidak aktif</span>
          </label>
          <p className="text-xs text-muted-foreground self-center sm:ml-auto">
            {filtered.length} dari {rows.length}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Kota / Provinsi</TableHead>
                <TableHead>PIC</TableHead>
                <TableHead className="text-center">Produk</TableHead>
                <TableHead className="text-center">Order</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState
                      icon={Warehouse}
                      title={rows.length === 0 ? 'Belum ada supplier' : 'Tidak ada hasil'}
                      description={rows.length === 0 ? 'Tambahkan supplier pertama untuk mulai link produk & order.' : 'Coba ubah filter atau kata kunci.'}
                    />
                  </TableCell>
                </TableRow>
              ) : filtered.map(s => (
                <TableRow key={s.id} className={!s.active ? 'opacity-60' : ''}>
                  <TableCell>
                    {s.code ? <Badge variant="outline" className="font-mono">{s.code}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.city || s.province ? (
                      <>
                        {s.city || '—'}
                        {s.province ? <span className="block text-[10px]">{s.province}</span> : null}
                      </>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.pic_name ? (
                      <>
                        {s.pic_name}
                        {s.pic_phone ? <span className="block text-[10px] text-muted-foreground font-mono">{s.pic_phone}</span> : null}
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{s.product_count ?? 0}</TableCell>
                  <TableCell className="text-center tabular-nums">{s.order_count ?? 0}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={s.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-muted-foreground'}>
                      {s.active ? 'Active' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(s)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={s.active ? 'Disable' : 'Aktifkan'}
                          onClick={() => setToggleTarget(s)}
                          className={s.active ? '' : 'text-emerald-500'}
                        >
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
        <Card className="border-zinc-500/20 bg-zinc-500/5">
          <CardContent className="pt-3 pb-3 text-xs text-muted-foreground">
            ℹ️ Mode read-only. Hanya Owner/Admin yang bisa tambah/edit/disable supplier.
          </CardContent>
        </Card>
      )}

      {/* Soft-disable confirm dialog (jangan hard delete — bisa break FK
          ke products & orders. Kalau benar-benar mau delete, lewat SQL) */}
      <Dialog open={!!toggleTarget} onOpenChange={v => !v && setToggleTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {toggleTarget?.active ? 'Disable supplier?' : 'Aktifkan supplier?'}
            </DialogTitle>
            <DialogDescription>
              {toggleTarget?.active ? (
                <>
                  Supplier <span className="font-semibold">{toggleTarget?.name}</span> tidak akan tampil
                  di dropdown form produk/order. Data lama (produk & order) yang sudah link tetap aman.
                  {toggleTarget && ((toggleTarget.product_count ?? 0) + (toggleTarget.order_count ?? 0) > 0) && (
                    <span className="block mt-2 text-xs text-amber-600">
                      Catatan: {toggleTarget.product_count ?? 0} produk & {toggleTarget.order_count ?? 0} order
                      sedang link ke supplier ini.
                    </span>
                  )}
                </>
              ) : (
                <>Supplier <span className="font-semibold">{toggleTarget?.name}</span> akan kembali muncul di dropdown.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToggleTarget(null)} disabled={toggling}>
              Batal
            </Button>
            <Button onClick={confirmToggle} disabled={toggling}>
              {toggling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {toggleTarget?.active ? 'Disable' : 'Aktifkan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
