'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Pencil, Package, Loader2, Trash2, Search, AlertTriangle, TrendingDown, ArrowUpDown, Power, Tag } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import type { Product } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'

const supabase = createClient()

type SortKey = 'name' | 'price' | 'hpp' | 'margin_pct' | 'margin_rp'
type SortDir = 'asc' | 'desc'

const computeMargin = (p: Product) => {
  const marginRp = p.price_default - p.hpp
  const marginPct = p.price_default > 0 ? (marginRp / p.price_default) * 100 : 0
  return { marginRp, marginPct }
}

const marginClass = (pct: number) => {
  if (pct < 10) return 'bg-red-500/10 text-red-600 border-red-500/30'
  if (pct < 30) return 'bg-amber-500/10 text-amber-600 border-amber-500/30'
  return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
}

export default function ProductsPage() {
  const { role } = useAuth()
  const isOwner = role === 'owner'
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', sku: '', price_default: 0, hpp: 0, category: '' })

  // Filter state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('products').select('*').order('name')
    setProducts(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const reset = () => { setForm({ name: '', sku: '', price_default: 0, hpp: 0, category: '' }); setEditId(null) }

  const handleEdit = (p: Product) => {
    setForm({ name: p.name, sku: p.sku || '', price_default: p.price_default, hpp: p.hpp, category: p.category || '' })
    setEditId(p.id); setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return toast.error('Nama produk wajib diisi')
    if (form.hpp > form.price_default) {
      if (!confirm('HPP lebih besar dari harga jual — produk ini akan rugi setiap closing. Lanjut simpan?')) return
    }
    setSaving(true)
    try {
      const payload = { name: form.name, sku: form.sku || null, price_default: form.price_default, hpp: form.hpp, category: form.category || null }
      const { error } = editId
        ? await supabase.from('products').update(payload).eq('id', editId)
        : await supabase.from('products').insert(payload)
      if (error) throw error
      toast.success(editId ? 'Produk diupdate' : 'Produk ditambahkan')
      setOpen(false); reset(); load()
    } catch (err: any) { toast.error('Gagal simpan', { description: err.message }) }
    finally { setSaving(false) }
  }

  const toggleActive = async (p: Product) => {
    const next = !p.active
    const { error } = await supabase.from('products').update({ active: next }).eq('id', p.id)
    if (error) { toast.error('Gagal', { description: error.message }); return }
    toast.success(next ? `${p.name} diaktifkan` : `${p.name} dinonaktifkan`)
    load()
  }

  const handleDelete = async (p: Product) => {
    // Check if there are linked orders (informational)
    const { count } = await supabase.from('order_items').select('*', { count: 'exact', head: true }).eq('product_id', p.id)
    const linked = count || 0

    let confirmMsg = `Hapus permanen produk "${p.name}"?`
    if (linked > 0) {
      confirmMsg = `⚠️ "${p.name}" sudah dipakai di ${linked} item order.\n\nKalau dihapus permanen, ${linked} item order beserta data komisi/analitiknya akan IKUT TERHAPUS.\n\nDISARANKAN: nonaktifkan saja (klik tombol Power) supaya data lama aman.\n\nLanjut hapus permanen?`
    }
    if (!confirm(confirmMsg)) return

    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) { toast.error('Gagal hapus', { description: error.message }); return }
    toast.success(`Produk "${p.name}" dihapus`)
    load()
  }

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Categories for filter
  const categories = useMemo(() => {
    const set = new Set<string>()
    products.forEach(p => { if (p.category) set.add(p.category) })
    return Array.from(set).sort()
  }, [products])

  // Apply filter + sort
  const filtered = useMemo(() => {
    let list = products
    if (statusFilter === 'ACTIVE') list = list.filter(p => p.active)
    else if (statusFilter === 'INACTIVE') list = list.filter(p => !p.active)
    if (categoryFilter !== 'ALL') list = list.filter(p => p.category === categoryFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      )
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'price') cmp = a.price_default - b.price_default
      else if (sortKey === 'hpp') cmp = a.hpp - b.hpp
      else if (sortKey === 'margin_rp') cmp = (a.price_default - a.hpp) - (b.price_default - b.hpp)
      else if (sortKey === 'margin_pct') {
        const pa = computeMargin(a).marginPct
        const pb = computeMargin(b).marginPct
        cmp = pa - pb
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [products, search, statusFilter, categoryFilter, sortKey, sortDir])

  // Stats
  const stats = useMemo(() => {
    const active = products.filter(p => p.active)
    const totalActive = active.length
    const totalInactive = products.filter(p => !p.active).length
    const margins = active.map(p => computeMargin(p).marginPct)
    const avgMargin = margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : 0
    const losing = active.filter(p => computeMargin(p).marginRp < 0).length
    const lowMargin = active.filter(p => {
      const m = computeMargin(p).marginPct
      return m >= 0 && m < 20
    }).length
    return { totalActive, totalInactive, avgMargin, losing, lowMargin }
  }, [products])

  const SortHeader = ({ sortable, label }: { sortable: SortKey; label: string }) => (
    <button type="button" onClick={() => setSort(sortable)} className="flex items-center gap-1 hover:text-foreground transition-colors">
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sortKey === sortable ? 'text-violet-400' : 'text-muted-foreground/40'}`} />
    </button>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        title="Master Produk"
        description={`${stats.totalActive} aktif • ${stats.totalInactive} nonaktif`}
        actions={
          <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
            <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}><Plus className="w-4 h-4 mr-2" />Tambah Produk</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Produk</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2"><Label>Nama Produk *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
                <div className="space-y-2"><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Harga Jual</Label><Input type="number" value={form.price_default} onChange={e => setForm({ ...form, price_default: Number(e.target.value) })} /></div>
                  <div className="space-y-2"><Label>HPP</Label><Input type="number" value={form.hpp} onChange={e => setForm({ ...form, hpp: Number(e.target.value) })} /></div>
                </div>
                {form.price_default > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Margin nominal</span><span className="font-semibold">{formatRupiah(form.price_default - form.hpp)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Margin %</span><span className="font-semibold">{(((form.price_default - form.hpp) / form.price_default) * 100).toFixed(1)}%</span></div>
                  </div>
                )}
                <div className="space-y-2"><Label>Kategori</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="opsional, untuk grouping & filter" list="prod-categories" /><datalist id="prod-categories">{categories.map(c => <option key={c} value={c} />)}</datalist></div>
                <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-violet-500/15 rounded-xl ring-1 ring-violet-500/20"><Package className="w-5 h-5 text-violet-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Produk Aktif</p>
              <p className="text-xl font-bold">{stats.totalActive}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20"><Tag className="w-5 h-5 text-emerald-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Margin</p>
              <p className="text-xl font-bold text-emerald-500">{stats.avgMargin.toFixed(1)}%</p>
              <p className="text-[10px] text-muted-foreground">dari produk aktif</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20"><AlertTriangle className="w-5 h-5 text-amber-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Margin Tipis</p>
              <p className="text-xl font-bold text-amber-500">{stats.lowMargin}</p>
              <p className="text-[10px] text-muted-foreground">{'<20% margin'}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><TrendingDown className="w-5 h-5 text-red-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rugi</p>
              <p className="text-xl font-bold text-red-500">{stats.losing}</p>
              <p className="text-[10px] text-muted-foreground">HPP &gt; harga jual</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama, SKU, atau kategori..." className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={v => v && setStatusFilter(v as any)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent className="w-[200px]">
                <SelectItem value="ACTIVE">Aktif saja</SelectItem>
                <SelectItem value="INACTIVE">Nonaktif saja</SelectItem>
                <SelectItem value="ALL">Semua</SelectItem>
              </SelectContent>
            </Select>
            {categories.length > 0 && (
              <Select value={categoryFilter} onValueChange={v => v && setCategoryFilter(v)}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Kategori" /></SelectTrigger>
                <SelectContent className="w-[220px]">
                  <SelectItem value="ALL">Semua kategori</SelectItem>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground self-center ml-auto">
              {filtered.length} dari {products.length} produk
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortHeader sortable="name" label="Produk" /></TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right"><SortHeader sortable="price" label="Harga Jual" /></TableHead>
                <TableHead className="text-right"><SortHeader sortable="hpp" label="HPP" /></TableHead>
                <TableHead className="text-right"><SortHeader sortable="margin_rp" label="Margin Rp" /></TableHead>
                <TableHead className="text-center"><SortHeader sortable="margin_pct" label="Margin %" /></TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={9} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      icon={Package}
                      title={products.length === 0 ? 'Belum ada produk' : 'Tidak ada produk yang cocok'}
                      description={products.length === 0
                        ? 'Tambah produk untuk mulai bisa dipilih saat input order.'
                        : 'Coba ubah filter atau search.'}
                    />
                  </TableCell>
                </TableRow>
              ) : filtered.map(p => {
                const { marginRp, marginPct } = computeMargin(p)
                const isLosing = marginRp < 0
                return (
                  <TableRow key={p.id} className={!p.active ? 'opacity-60' : ''}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {p.name}
                        {isLosing && <AlertTriangle className="w-3.5 h-3.5 text-red-500" aria-label="HPP > harga, rugi" />}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.sku || '-'}</TableCell>
                    <TableCell className="text-right">{formatRupiah(p.price_default)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatRupiah(p.hpp)}</TableCell>
                    <TableCell className={`text-right font-medium ${isLosing ? 'text-red-500' : ''}`}>{formatRupiah(marginRp)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={marginClass(marginPct)}>{marginPct.toFixed(1)}%</Badge>
                    </TableCell>
                    <TableCell>{p.category ? <Badge variant="outline" className="text-xs">{p.category}</Badge> : <span className="text-xs text-muted-foreground">-</span>}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={p.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-muted-foreground'}>
                        {p.active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => handleEdit(p)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" title={p.active ? 'Nonaktifkan' : 'Aktifkan'} onClick={() => toggleActive(p)} className={p.active ? '' : 'text-emerald-500'}>
                          <Power className="w-4 h-4" />
                        </Button>
                        {isOwner && (
                          <Button variant="ghost" size="icon" title="Hapus permanen" onClick={() => handleDelete(p)} className="text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-sm space-y-2">
          <p>📊 <strong>Tips:</strong></p>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
            <li><strong>Nonaktifkan</strong> (Power icon) = produk tidak muncul di pilihan saat input order, tapi data lama tetap aman</li>
            <li><strong>Hapus</strong> (Trash icon, owner only) = produk + semua order_items terkait akan IKUT TERHAPUS — destructive!</li>
            <li>Margin <span className="text-emerald-500">≥30% bagus</span>, <span className="text-amber-500">10–30% tipis</span>, <span className="text-red-500">&lt;10% rawan rugi</span></li>
            <li>Klik header kolom untuk sort. SKU bersifat opsional tapi memudahkan tracking</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
