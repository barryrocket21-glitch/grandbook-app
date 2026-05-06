'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Pencil, Loader2, Trash2, Coins } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/constants'
import type { UserRole } from '@/lib/types'

const supabase = createClient()

interface Rule {
  id: number
  role: UserRole
  rule_type: string
  value: number
  user_id: string | null
  product_id: number | null
  effective_from: string | null
  active: boolean
}

export default function CommissionRulesPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    role: 'cs' as UserRole,
    rule_type: 'FLAT_PER_ORDER' as string,
    value: 0,
    user_id: '' as string,
    product_id: '' as string,
    effective_from: '',
  })

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: p }, { data: u }] = await Promise.all([
      supabase.from('commission_rules').select('*').eq('active', true).order('role'),
      supabase.from('products').select('id, name').eq('active', true).order('name'),
      supabase.from('profiles').select('id, full_name, role').in('role', ['cs', 'advertiser', 'admin']).eq('active', true),
    ])
    setRules(r || [])
    setProducts(p || [])
    setUsers(u || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const reset = () => {
    setForm({ role: 'cs', rule_type: 'FLAT_PER_ORDER', value: 0, user_id: '', product_id: '', effective_from: '' })
    setEditId(null)
  }

  const openEdit = (r: Rule) => {
    setForm({
      role: r.role,
      rule_type: r.rule_type,
      value: Number(r.value),
      user_id: r.user_id || '',
      product_id: r.product_id ? String(r.product_id) : '',
      effective_from: r.effective_from || '',
    })
    setEditId(r.id)
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload: any = {
        role: form.role,
        rule_type: form.rule_type,
        value: form.value,
        user_id: form.user_id || null,
        product_id: form.product_id ? Number(form.product_id) : null,
        effective_from: form.effective_from || null,
        active: true,
      }
      const { error } = editId
        ? await supabase.from('commission_rules').update(payload).eq('id', editId)
        : await supabase.from('commission_rules').insert(payload)
      if (error) throw error
      toast.success(editId ? 'Rule diupdate' : 'Rule ditambahkan')
      setOpen(false); reset(); load()
    } catch (err: any) { toast.error('Gagal simpan', { description: err.message }) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Hapus aturan komisi ini? Tidak akan berlaku lagi untuk komisi yang dihitung setelah ini.')) return
    const { error } = await supabase.from('commission_rules').update({ active: false }).eq('id', id)
    if (error) { toast.error('Gagal hapus', { description: error.message }); return }
    toast.success('Rule dihapus'); load()
  }

  const usersByRole = useMemo(() => {
    return users.filter(u => u.role === form.role)
  }, [users, form.role])

  const allUsersById = useMemo(() => {
    const m = new Map<string, any>()
    users.forEach(u => m.set(u.id, u))
    return m
  }, [users])

  const productsById = useMemo(() => {
    const m = new Map<number, any>()
    products.forEach(p => m.set(p.id, p))
    return m
  }, [products])

  const roles: UserRole[] = ['cs', 'advertiser', 'admin']

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Aturan Komisi"
        description="Rule per role × user × produk × periode. Yang paling spesifik menang."
        actions={
          <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
            <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}><Plus className="w-4 h-4 mr-2" />Tambah Rule</DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Aturan Komisi</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Role *</Label>
                  <Select value={form.role} onValueChange={v => v && setForm({ ...form, role: v as UserRole, user_id: '' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="w-[200px]">{roles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">User Spesifik (opsional)</Label>
                  <Select value={form.user_id || 'all'} onValueChange={v => setForm({ ...form, user_id: !v || v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Semua user role ini">{(value: string | null) => value === 'all' || !value ? 'Semua user role ini' : allUsersById.get(value)?.full_name ?? 'Pilih user'}</SelectValue></SelectTrigger>
                    <SelectContent className="w-[260px]">
                      <SelectItem value="all">Semua user role ini</SelectItem>
                      {usersByRole.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Kosongkan untuk rule global, atau pilih user untuk rate khusus orang itu</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Produk Spesifik (opsional)</Label>
                  <Select value={form.product_id || 'all'} onValueChange={v => setForm({ ...form, product_id: !v || v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Semua produk">{(value: string | null) => value === 'all' || !value ? 'Semua produk' : productsById.get(Number(value))?.name ?? 'Pilih produk'}</SelectValue></SelectTrigger>
                    <SelectContent className="w-[260px]">
                      <SelectItem value="all">Semua produk</SelectItem>
                      {products.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Kosongkan untuk semua produk, atau pilih produk untuk rate khusus produk itu</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tipe *</Label>
                    <Select value={form.rule_type} onValueChange={v => v && setForm({ ...form, rule_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="w-[240px]">
                        <SelectItem value="FLAT_PER_ORDER">Flat per Order (Rp)</SelectItem>
                        <SelectItem value="PERCENT_REVENUE">% dari Revenue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{form.rule_type === 'PERCENT_REVENUE' ? 'Persentase (%)' : 'Nominal (Rp)'} *</Label>
                    <Input type="number" step="0.01" value={form.value} onChange={e => setForm({ ...form, value: Number(e.target.value) })} required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Berlaku Mulai (effective from)</Label>
                  <Input type="date" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} />
                  <p className="text-[10px] text-muted-foreground">Kosongkan kalau berlaku semua waktu. Untuk rate yang ganti tiap bulan, bikin rule baru dengan tanggal awal bulan</p>
                </div>
                <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-3 pb-3 text-xs space-y-1">
          <p>📊 <strong>Cara kerja prioritas rule:</strong> sistem ambil rule yang paling spesifik untuk order tertentu.</p>
          <ol className="list-decimal list-inside text-muted-foreground space-y-0.5">
            <li><strong>User + Produk</strong> — rate khusus si CS untuk produk tertentu (paling tinggi)</li>
            <li><strong>User</strong> — rate khusus si CS untuk semua produk</li>
            <li><strong>Produk</strong> — rate global untuk produk itu, semua user role itu</li>
            <li><strong>Role only</strong> — rate default fallback</li>
          </ol>
          <p className="text-muted-foreground">Untuk rate beda tiap bulan: bikin rule baru dengan <code className="bg-muted px-1 rounded">Berlaku Mulai = tanggal 1 bulan baru</code>. Sistem auto-pakai rule terbaru yang berlaku di tanggal order.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
                <TableHead>Berlaku Mulai</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <TableRow key={i}><TableCell colSpan={7}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>)
              ) : rules.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="p-0"><EmptyState icon={Coins} title="Belum ada aturan komisi" description="Tambah rule untuk menentukan komisi CS, advertiser, atau admin per order. Bisa specific per user dan/atau produk." /></TableCell></TableRow>
              ) : rules.map(r => {
                const user = r.user_id ? allUsersById.get(r.user_id) : null
                const product = r.product_id ? productsById.get(r.product_id) : null
                const specificity = (r.user_id ? 1 : 0) + (r.product_id ? 1 : 0)
                return (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="outline" className="text-xs">{ROLE_LABELS[r.role] || r.role}</Badge></TableCell>
                    <TableCell className="text-sm">{user ? <span className="font-medium">{user.full_name}</span> : <span className="text-muted-foreground italic">semua</span>}</TableCell>
                    <TableCell className="text-sm">{product ? <span className="font-medium">{product.name}</span> : <span className="text-muted-foreground italic">semua</span>}</TableCell>
                    <TableCell className="text-xs">{r.rule_type === 'PERCENT_REVENUE' ? '% Revenue' : 'Flat/Order'}</TableCell>
                    <TableCell className="text-right font-semibold">{r.rule_type === 'PERCENT_REVENUE' ? `${r.value}%` : formatRupiah(r.value)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.effective_from || 'selalu'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Badge variant="outline" className="text-[10px] mr-2" title={`Spesifisitas: ${specificity} (semakin tinggi semakin prioritas)`}>{'★'.repeat(specificity + 1)}</Badge>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDelete(r.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
