'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Coins, ShieldOff, Copy } from 'lucide-react'
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

type ProductMode = 'default' | 'specific'

interface FormState {
  id: number | null
  role: 'cs' | 'advertiser'
  user_id: string | null
  /** 'default' = 1 catch-all rule (product_id NULL). 'specific' = 1+ rules (one per checked product). */
  product_mode: ProductMode
  product_ids: number[]
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
  product_mode: 'default',
  product_ids: [],
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
      product_mode: r.product_id === null ? 'default' : 'specific',
      product_ids: r.product_id === null ? [] : [r.product_id],
      rate_type: r.rate_type,
      rate_value: Number(r.rate_value ?? 0),
      effective_from: r.effective_from || '',
      effective_to: r.effective_to || '',
      active: r.active,
    })
    setDialogOpen(true)
  }
  function openDuplicateDialog(r: typeof rules[number]) {
    // Same data as edit but id=null → save creates new row.
    setForm({
      id: null,
      role: r.role,
      user_id: r.user_id,
      product_mode: r.product_id === null ? 'default' : 'specific',
      product_ids: r.product_id === null ? [] : [r.product_id],
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

    // Resolve target product IDs.
    // - 'default' → [null]: 1 rule with product_id=NULL (catch-all).
    // - 'specific' → array of checked product IDs (1+ rules).
    const targetProductIds: (number | null)[] = form.product_mode === 'default'
      ? [null]
      : form.product_ids
    if (targetProductIds.length === 0) {
      toast.error('Pilih minimal 1 produk, atau pilih mode "Semua Produk".')
      return
    }
    if (form.id !== null && targetProductIds.length > 1) {
      toast.error('Edit rule hanya bisa 1 produk. Gunakan tombol Duplicate untuk apply ke produk lain.')
      return
    }

    setSaving(true)
    const commonArgs = {
      orgId,
      role: form.role,
      user_id: form.user_id,
      rate_type: form.rate_type,
      rate_value: form.rate_type === 'NONE' ? null : form.rate_value,
      effective_from: form.effective_from || null,
      effective_to: form.effective_to || null,
      active: form.active,
    }
    let okCount = 0
    const errs: string[] = []
    for (const pid of targetProductIds) {
      try {
        await saveCommissionRule(supabase, { ...commonArgs, id: form.id, product_id: pid })
        okCount++
      } catch (err) {
        const productLabel = pid === null ? 'Default' : (products.find(p => p.id === pid)?.name || `Produk #${pid}`)
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('duplicate') || msg.includes('unique')) {
          errs.push(`${productLabel} — sudah ada rule (skip)`)
        } else {
          errs.push(`${productLabel} — ${msg}`)
        }
      }
    }
    setSaving(false)

    if (okCount > 0) {
      if (form.id !== null) {
        toast.success('Rule diupdate')
      } else {
        toast.success(okCount === 1 ? 'Rule dibuat' : `${okCount} rule dibuat sekaligus`)
      }
    }
    if (errs.length > 0) {
      toast.error(`${errs.length} produk dilewati`, {
        description: errs.slice(0, 4).join('\n') + (errs.length > 4 ? `\n…dan ${errs.length - 4} lagi` : ''),
      })
    }
    if (okCount > 0) {
      setDialogOpen(false)
      load()
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
                        <Button size="sm" variant="ghost" onClick={() => openEditDialog(r)} title="Edit"><Pencil className="size-3.5"/></Button>
                        <Button size="sm" variant="ghost" onClick={() => openDuplicateDialog(r)} title="Duplicate" className="text-violet-500"><Copy className="size-3.5"/></Button>
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDeleteTarget(r)} title="Hapus"><Trash2 className="size-3.5"/></Button>
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
              Set rule komisi: pilih 1 / banyak produk sekaligus, atau "Semua Produk" sebagai catch-all default. Rule product-specific override default. Tipe NONE = role itu tidak dapat komisi untuk produk tsb.
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
            <div className="space-y-2">
              <Label>Berlaku Untuk Produk</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, product_mode: 'default', product_ids: [] }))}
                  className={`text-xs py-2 px-3 rounded border transition text-left ${form.product_mode === 'default' ? 'border-violet-500 bg-violet-500/10 text-violet-600' : 'border-input hover:bg-muted/40'}`}
                >
                  <div className="font-medium">Semua Produk</div>
                  <div className="text-[10px] text-muted-foreground">Catch-all default</div>
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, product_mode: 'specific' }))}
                  className={`text-xs py-2 px-3 rounded border transition text-left ${form.product_mode === 'specific' ? 'border-violet-500 bg-violet-500/10 text-violet-600' : 'border-input hover:bg-muted/40'}`}
                >
                  <div className="font-medium">Produk Spesifik</div>
                  <div className="text-[10px] text-muted-foreground">Pilih 1 atau banyak sekaligus</div>
                </button>
              </div>
              {form.product_mode === 'specific' && (
                <div className="space-y-1.5 border rounded p-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground">
                      {form.product_ids.length}/{products.length} produk dipilih
                    </span>
                    {form.id === null && products.length > 0 && (
                      <div className="flex gap-1.5 text-[10px]">
                        <button type="button" onClick={() => setForm(f => ({ ...f, product_ids: products.map(p => p.id) }))} className="text-violet-500 hover:underline">
                          Pilih semua
                        </button>
                        <span className="text-muted-foreground">·</span>
                        <button type="button" onClick={() => setForm(f => ({ ...f, product_ids: [] }))} className="text-violet-500 hover:underline">
                          Reset
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-0.5 pr-1">
                    {products.map(p => {
                      const isChecked = form.product_ids.includes(p.id)
                      const lockedSingle = form.id !== null && !isChecked && form.product_ids.length === 1
                      return (
                        <label key={p.id} className={`flex items-center gap-2 cursor-pointer text-sm rounded px-1 py-0.5 ${lockedSingle ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted/30'}`}>
                          <Checkbox
                            checked={isChecked}
                            disabled={lockedSingle}
                            onCheckedChange={(v) => {
                              setForm(f => ({
                                ...f,
                                product_ids: v === true
                                  ? (f.id !== null ? [p.id] : [...f.product_ids, p.id])
                                  : f.product_ids.filter(id => id !== p.id),
                              }))
                            }}
                          />
                          <span>{p.name}</span>
                        </label>
                      )
                    })}
                  </div>
                  {form.id === null && form.product_ids.length > 1 && (
                    <p className="text-[10px] text-amber-600">
                      {form.product_ids.length} rule akan dibuat — 1 per produk, dengan rate yang sama.
                    </p>
                  )}
                  {form.id !== null && (
                    <p className="text-[10px] text-muted-foreground">
                      Edit rule cuma 1 produk. Untuk apply ke produk lain, pakai tombol Duplicate di tabel.
                    </p>
                  )}
                </div>
              )}
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
