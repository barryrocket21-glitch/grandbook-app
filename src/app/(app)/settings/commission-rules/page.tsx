'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Coins, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah } from '@/lib/format'
import {
  listCommissionRules,
  saveCommissionRule,
  deleteCommissionRule,
  listProductsWithCounts,
} from '@/lib/supabase/queries/variants'
import type { CommissionRule, CommissionRateType, Product } from '@/lib/types'

const supabase = createClient()

interface FormState {
  id: number | null
  role: 'cs' | 'advertiser'
  user_id: string | null
  product_id: number | null
  rate_type: CommissionRateType
  rate_value: number
  effective_from: string
  effective_to: string
  active: boolean
}

const emptyForm: FormState = {
  id: null,
  role: 'cs',
  user_id: null,
  product_id: null,
  rate_type: 'FLAT_PER_ORDER',
  rate_value: 0,
  effective_from: '',
  effective_to: '',
  active: true,
}

interface UserOption {
  id: string
  full_name: string
  role: string
}

export default function CommissionRulesPage() {
  const { profile, role, loading: authLoading } = useAuth()
  const orgId = profile?.organization_id ?? null

  const [rules, setRules] = useState<Array<CommissionRule & { product_name: string | null; user_name: string | null }>>([])
  const [products, setProducts] = useState<Product[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<typeof rules[number] | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [r, p, u] = await Promise.all([
        listCommissionRules(supabase, orgId),
        listProductsWithCounts(supabase, orgId),
        supabase
          .from('profiles')
          .select('id, full_name, role')
          .in('role', ['cs', 'advertiser'])
          .order('full_name'),
      ])
      setRules(r)
      setProducts(p as Product[])
      setUsers((u.data || []) as UserOption[])
    } catch (err) {
      toast.error('Gagal load', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  function openNewDialog() {
    setForm(emptyForm)
    setDialogOpen(true)
  }
  function openEditDialog(r: typeof rules[number]) {
    setForm({
      id: r.id,
      role: r.role,
      user_id: r.user_id,
      product_id: r.product_id,
      rate_type: r.rate_type,
      rate_value: Number(r.rate_value ?? 0),
      effective_from: r.effective_from || '',
      effective_to: r.effective_to || '',
      active: r.active,
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!orgId) return
    if (form.rate_type !== 'NONE' && (form.rate_value === null || isNaN(form.rate_value) || form.rate_value < 0)) {
      toast.error('Rate value harus >= 0')
      return
    }
    if (form.effective_from && form.effective_to && form.effective_from > form.effective_to) {
      toast.error('Tanggal mulai tidak boleh setelah tanggal selesai')
      return
    }
    setSaving(true)
    try {
      await saveCommissionRule(supabase, {
        id: form.id,
        orgId,
        role: form.role,
        user_id: form.user_id,
        product_id: form.product_id,
        rate_type: form.rate_type,
        rate_value: form.rate_type === 'NONE' ? null : form.rate_value,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
        active: form.active,
      })
      toast.success(form.id ? 'Rule diupdate' : 'Rule dibuat')
      setDialogOpen(false)
      load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('duplicate') || msg.includes('unique')) {
        toast.error('Sudah ada rule untuk kombinasi role + produk yang sama', { description: 'Edit existing atau pilih produk lain.' })
      } else {
        toast.error('Gagal simpan', { description: msg })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteCommissionRule(supabase, deleteTarget.id)
      toast.success('Rule dihapus')
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error('Gagal hapus', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role)
      if (a.product_id === null && b.product_id !== null) return -1
      if (a.product_id !== null && b.product_id === null) return 1
      return (a.product_name || '').localeCompare(b.product_name || '')
    })
  }, [rules])

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (role !== 'owner') {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500"><ShieldOff className="size-5"/>Akses ditolak</CardTitle>
            <CardDescription>Manage aturan komisi hanya untuk owner.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Aturan Komisi"
        description="Setting komisi per role (CS / Advertiser) per produk. NULL produk = default catch-all."
        icon={Coins}
        actions={<Button onClick={openNewDialog}><Plus className="size-4 mr-2"/>Tambah Rule</Button>}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : sortedRules.length === 0 ? (
            <EmptyState
              icon={Coins}
              title="Belum ada aturan komisi"
              description="Tambah rule pertama. Tanpa rule, commission compute akan return 0 untuk semua role."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRules.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="outline" className={r.role === 'cs' ? 'bg-teal-500/10 text-teal-600' : 'bg-orange-500/10 text-orange-600'}>
                        {r.role.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.user_name ? r.user_name : <span className="text-muted-foreground italic">(semua {r.role.toUpperCase()})</span>}
                    </TableCell>
                    <TableCell>
                      {r.product_name ? r.product_name : <span className="text-muted-foreground italic">(semua produk)</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.rate_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.rate_type === 'NONE'
                        ? <span className="text-muted-foreground">—</span>
                        : r.rate_type === 'PERCENT_REVENUE'
                          ? `${r.rate_value}%`
                          : formatRupiah(Number(r.rate_value ?? 0))}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.effective_from || r.effective_to ? (
                        <span>
                          {r.effective_from || '—'} → {r.effective_to || '∞'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">selalu</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={r.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500'}>
                        {r.active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditDialog(r)}><Pencil className="size-3.5"/></Button>
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDeleteTarget(r)}><Trash2 className="size-3.5"/></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Form dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit aturan komisi' : 'Tambah aturan komisi'}</DialogTitle>
            <DialogDescription>
              Set rule per role × produk. Rule product-specific override default. Tipe NONE = role itu tidak dapat komisi untuk produk tsb.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Role</Label>
              <Select
                value={form.role}
                onValueChange={v => {
                  // Saat ganti role, reset user_id karena dropdown user nge-filter by role
                  if (v) setForm({ ...form, role: v as 'cs' | 'advertiser', user_id: null })
                }}
              >
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cs">Customer Service</SelectItem>
                  <SelectItem value="advertiser">Advertiser</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>User</Label>
              <Select
                value={form.user_id || 'all'}
                onValueChange={v => setForm({ ...form, user_id: v === 'all' ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Pilih user">
                  {(value: string | null) => {
                    if (!value || value === 'all') return `— Semua ${form.role.toUpperCase()} (default) —`
                    return users.find(u => u.id === value)?.full_name ?? value
                  }}
                </SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">— Semua {form.role.toUpperCase()} (default) —</SelectItem>
                  {users.filter(u => u.role === form.role).map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Pilih user spesifik untuk override default — e.g. Lisa beda dari Miranda.</p>
            </div>
            <div className="space-y-1">
              <Label>Produk</Label>
              <Select
                value={form.product_id ? String(form.product_id) : 'default'}
                onValueChange={v => setForm({ ...form, product_id: v === 'default' ? null : Number(v) })}
              >
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">— Default (semua produk) —</SelectItem>
                  {products.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Tipe Rate</Label>
              <Select value={form.rate_type} onValueChange={v => v && setForm({ ...form, rate_type: v as CommissionRateType })}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FLAT_PER_ORDER">Flat per Order (Rp)</SelectItem>
                  <SelectItem value="PERCENT_REVENUE">Persentase Revenue (%)</SelectItem>
                  <SelectItem value="NONE">None (tidak dapat komisi)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.rate_type !== 'NONE' && (
              <div className="space-y-1">
                <Label>Nilai {form.rate_type === 'PERCENT_REVENUE' ? '(0-100, persen)' : '(Rupiah)'}</Label>
                <Input
                  type="number"
                  min={0}
                  max={form.rate_type === 'PERCENT_REVENUE' ? 100 : undefined}
                  value={form.rate_value}
                  onChange={e => setForm({ ...form, rate_value: Number(e.target.value) || 0 })}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Periode mulai (opsional)</Label>
                <Input
                  type="date"
                  value={form.effective_from}
                  onChange={e => setForm({ ...form, effective_from: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Periode selesai (opsional)</Label>
                <Input
                  type="date"
                  value={form.effective_to}
                  onChange={e => setForm({ ...form, effective_to: e.target.value })}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Kosongkan periode = berlaku selamanya. Filter pakai order_date saat compute commission.
            </p>
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <Checkbox checked={form.active} onCheckedChange={v => setForm({ ...form, active: v === true })} />
              <span className="text-sm">Aktif</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Batal</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Simpan'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus rule?</DialogTitle>
            <DialogDescription>
              Hapus rule {deleteTarget?.role} × {deleteTarget?.product_name ?? '(default)'}. Commission yang sudah ter-generate tidak ke-affect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete}>Hapus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
