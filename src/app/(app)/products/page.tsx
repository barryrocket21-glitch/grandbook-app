'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Plus, Pencil, Package, Loader2, Trash2, Search, AlertTriangle, TrendingDown,
  ArrowUpDown, Power, Tag, FolderTree,
} from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import type { Product, ProductCategory } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  listProducts, listCategories,
  insertProduct, updateProduct, deleteProduct,
  insertCategory, updateCategory, deleteCategory,
  countProductsInCategory, countOrderItemsForProduct,
} from '@/lib/supabase/queries/products'
import { slugifyCategory } from '@/lib/schemas/settings'

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

interface ProductForm {
  sku: string
  name: string
  category_id: number | null
  variation: string
  price_default: number
  hpp: number
  notes: string
  active: boolean
}

interface CategoryForm {
  name: string
  slug: string
  description: string
  display_order: number
  active: boolean
}

const emptyProductForm: ProductForm = {
  sku: '', name: '', category_id: null, variation: '',
  price_default: 0, hpp: 0, notes: '', active: true,
}

const emptyCategoryForm: CategoryForm = {
  name: '', slug: '', description: '', display_order: 0, active: true,
}

export default function ProductsPage() {
  const { role, profile } = useAuth()
  const isOwner = role === 'owner'
  const canWrite = role === 'owner' || role === 'admin' || role === 'akunting'

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, c] = await Promise.all([
        listProducts(supabase),
        listCategories(supabase),
      ])
      setProducts(p)
      setCategories(c)
    } catch (err) {
      toast.error('Gagal load data', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        title="Master Produk"
        description={`${products.filter(p => p.active).length} produk aktif • ${categories.length} kategori`}
      />

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Produk ({products.length})</TabsTrigger>
          <TabsTrigger value="categories">Kategori ({categories.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4">
          <ProductsTab
            products={products}
            categories={categories}
            loading={loading}
            canWrite={canWrite}
            isOwner={isOwner}
            orgId={profile?.organization_id ?? 1}
            onReload={() => void load()}
          />
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <CategoriesTab
            categories={categories}
            products={products}
            loading={loading}
            canWrite={canWrite}
            isOwner={isOwner}
            orgId={profile?.organization_id ?? 1}
            onReload={() => void load()}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// =============================================================
// Products Tab
// =============================================================
function ProductsTab({
  products, categories, loading, canWrite, isOwner, orgId, onReload,
}: {
  products: Product[]
  categories: ProductCategory[]
  loading: boolean
  canWrite: boolean
  isOwner: boolean
  orgId: number
  onReload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyProductForm)

  // Filter state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE')
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | string>('ALL')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const reset = () => { setForm(emptyProductForm); setEditId(null) }

  const handleEdit = (p: Product) => {
    setForm({
      sku: p.sku || '',
      name: p.name,
      category_id: p.category_id ?? null,
      variation: p.variation ?? '',
      price_default: Number(p.price_default) || 0,
      hpp: Number(p.hpp) || 0,
      notes: p.notes ?? '',
      active: p.active,
    })
    setEditId(p.id)
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Nama produk wajib diisi')
    if (form.hpp > form.price_default) {
      if (!confirm('HPP lebih besar dari harga jual — produk ini akan rugi setiap closing. Lanjut simpan?')) return
    }
    setSaving(true)
    try {
      const payload = {
        sku: form.sku.trim() || null,
        name: form.name.trim(),
        category_id: form.category_id,
        variation: form.variation.trim() || null,
        price_default: form.price_default,
        hpp: form.hpp,
        notes: form.notes.trim() || null,
        active: form.active,
      }
      if (editId) {
        await updateProduct(supabase, editId, payload)
        toast.success('Produk diupdate')
      } else {
        await insertProduct(supabase, orgId, payload)
        toast.success('Produk ditambahkan')
      }
      setOpen(false)
      reset()
      onReload()
    } catch (err) {
      toast.error('Gagal simpan', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (p: Product) => {
    try {
      await updateProduct(supabase, p.id, { active: !p.active })
      toast.success(!p.active ? `${p.name} diaktifkan` : `${p.name} dinonaktifkan`)
      onReload()
    } catch (err) {
      toast.error('Gagal toggle', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleDelete = async (p: Product) => {
    const linked = await countOrderItemsForProduct(supabase, p.id)
    let confirmMsg = `Hapus permanen produk "${p.name}"?`
    if (linked > 0) {
      confirmMsg = `⚠️ "${p.name}" sudah dipakai di ${linked} item order.\n\nKalau dihapus permanen, ${linked} item order beserta data komisi/analitiknya akan IKUT TERHAPUS.\n\nDISARANKAN: nonaktifkan saja (klik tombol Power) supaya data lama aman.\n\nLanjut hapus permanen?`
    }
    if (!confirm(confirmMsg)) return
    try {
      await deleteProduct(supabase, p.id)
      toast.success(`Produk "${p.name}" dihapus`)
      onReload()
    } catch (err) {
      toast.error('Gagal hapus', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Category lookup helper
  const categoryMap = useMemo(() => {
    const m = new Map<number, ProductCategory>()
    categories.forEach(c => m.set(c.id, c))
    return m
  }, [categories])

  const filtered = useMemo(() => {
    let list = products
    if (statusFilter === 'ACTIVE') list = list.filter(p => p.active)
    else if (statusFilter === 'INACTIVE') list = list.filter(p => !p.active)
    if (categoryFilter !== 'ALL') {
      const cid = Number(categoryFilter)
      list = list.filter(p => p.category_id === cid)
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p => {
        const catName = (p.category_id && categoryMap.get(p.category_id)?.name) || p.category || ''
        return p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.variation || '').toLowerCase().includes(q) ||
          catName.toLowerCase().includes(q)
      })
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'price') cmp = a.price_default - b.price_default
      else if (sortKey === 'hpp') cmp = a.hpp - b.hpp
      else if (sortKey === 'margin_rp') cmp = (a.price_default - a.hpp) - (b.price_default - b.hpp)
      else if (sortKey === 'margin_pct') {
        cmp = computeMargin(a).marginPct - computeMargin(b).marginPct
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [products, search, statusFilter, categoryFilter, sortKey, sortDir, categoryMap])

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

  const categoryOptions = useMemo(() => [
    ...categories.filter(c => c.active).map(c => ({ value: String(c.id), label: c.name })),
  ], [categories])

  const SortHeader = ({ sortable, label }: { sortable: SortKey; label: string }) => (
    <button type="button" onClick={() => setSort(sortable)} className="flex items-center gap-1 hover:text-foreground transition-colors">
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sortKey === sortable ? 'text-violet-400' : 'text-muted-foreground/40'}`} />
    </button>
  )

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-violet-500/15 rounded-xl ring-1 ring-violet-500/20">
              <Package className="w-5 h-5 text-violet-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Produk Aktif</p>
              <p className="text-xl font-bold">{stats.totalActive}</p>
              <p className="text-[10px] text-muted-foreground">{stats.totalInactive} nonaktif</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20">
              <Tag className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Margin</p>
              <p className="text-xl font-bold text-emerald-500">{stats.avgMargin.toFixed(1)}%</p>
              <p className="text-[10px] text-muted-foreground">produk aktif</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
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
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20">
              <TrendingDown className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rugi</p>
              <p className="text-xl font-bold text-red-500">{stats.losing}</p>
              <p className="text-[10px] text-muted-foreground">HPP &gt; harga</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar + Add button */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cari nama, SKU, variation, atau kategori..."
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => v && setStatusFilter(v as 'ALL' | 'ACTIVE' | 'INACTIVE')}>
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
                  {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {canWrite && (
              <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
                <DialogTrigger render={
                  <Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">
                    <Plus className="w-4 h-4 mr-2" />Tambah Produk
                  </Button>
                } />
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{editId ? 'Edit' : 'Tambah'} Produk</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>SKU</Label>
                        <Input
                          value={form.sku}
                          onChange={e => setForm({ ...form, sku: e.target.value })}
                          placeholder="opsional, auto-unique"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Variation</Label>
                        <Input
                          value={form.variation}
                          onChange={e => setForm({ ...form, variation: e.target.value })}
                          placeholder="e.g. Hitam M"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Nama Produk *</Label>
                      <Input
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Kategori</Label>
                      <Combobox
                        value={form.category_id ? String(form.category_id) : ''}
                        onChange={v => setForm({ ...form, category_id: v ? Number(v) : null })}
                        options={categoryOptions}
                        placeholder="Pilih kategori (opsional)"
                        searchPlaceholder="Cari kategori..."
                        emptyHint={{
                          message: 'Belum ada kategori produk.',
                          actionLabel: 'Tambah kategori dulu',
                          actionHref: '/products?tab=categories',
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Harga Jual *</Label>
                        <Input
                          type="number"
                          value={form.price_default}
                          onChange={e => setForm({ ...form, price_default: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>HPP *</Label>
                        <Input
                          type="number"
                          value={form.hpp}
                          onChange={e => setForm({ ...form, hpp: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    {form.price_default > 0 && (
                      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Margin nominal</span>
                          <span className="font-semibold">{formatRupiah(form.price_default - form.hpp)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Margin %</span>
                          <span className="font-semibold">
                            {(((form.price_default - form.hpp) / form.price_default) * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Catatan</Label>
                      <Textarea
                        value={form.notes}
                        onChange={e => setForm({ ...form, notes: e.target.value })}
                        placeholder="opsional"
                        rows={2}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="prod-active"
                        checked={form.active}
                        onCheckedChange={v => setForm({ ...form, active: v === true })}
                      />
                      <Label htmlFor="prod-active" className="cursor-pointer">Aktif (bisa dipilih saat input order)</Label>
                    </div>
                    <Button
                      type="submit"
                      className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20"
                      disabled={saving}
                    >
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Simpan
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
            <p className="text-xs text-muted-foreground self-center ml-auto">
              {filtered.length} dari {products.length} produk
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortHeader sortable="name" label="Produk" /></TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-right"><SortHeader sortable="price" label="Harga" /></TableHead>
                <TableHead className="text-right"><SortHeader sortable="hpp" label="HPP" /></TableHead>
                <TableHead className="text-right"><SortHeader sortable="margin_rp" label="Margin" /></TableHead>
                <TableHead className="text-center"><SortHeader sortable="margin_pct" label="%" /></TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9} className="py-3">
                      <div className="h-4 bg-muted animate-pulse rounded w-full" />
                    </TableCell>
                  </TableRow>
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
                const cat = p.category_id ? categoryMap.get(p.category_id) : null
                return (
                  <TableRow key={p.id} className={!p.active ? 'opacity-60' : ''}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div>
                          <div>{p.name}</div>
                          {p.variation && (
                            <div className="text-[10px] text-muted-foreground">{p.variation}</div>
                          )}
                        </div>
                        {isLosing && <AlertTriangle className="w-3.5 h-3.5 text-red-500" aria-label="HPP > harga, rugi" />}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.sku || '-'}</TableCell>
                    <TableCell>
                      {cat ? (
                        <Badge variant="outline" className="text-xs">{cat.name}</Badge>
                      ) : p.category ? (
                        <span className="text-xs text-muted-foreground italic">{p.category} (legacy)</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatRupiah(p.price_default)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatRupiah(p.hpp)}</TableCell>
                    <TableCell className={`text-right font-medium ${isLosing ? 'text-red-500' : ''}`}>
                      {formatRupiah(marginRp)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={marginClass(marginPct)}>{marginPct.toFixed(1)}%</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={p.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-muted-foreground'}>
                        {p.active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite && (
                          <>
                            <Button variant="ghost" size="icon" title="Edit" onClick={() => handleEdit(p)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              title={p.active ? 'Nonaktifkan' : 'Aktifkan'}
                              onClick={() => toggleActive(p)}
                              className={p.active ? '' : 'text-emerald-500'}
                            >
                              <Power className="w-4 h-4" />
                            </Button>
                          </>
                        )}
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
            <li><strong>Nonaktifkan</strong> (Power icon) = produk tidak muncul saat input order, data lama tetap aman</li>
            <li><strong>Hapus</strong> (Trash icon, owner only) = produk + order_items terkait IKUT TERHAPUS</li>
            <li>Margin <span className="text-emerald-500">≥30% bagus</span>, <span className="text-amber-500">10–30% tipis</span>, <span className="text-red-500">&lt;10% rawan rugi</span></li>
            <li>HPP penting untuk Phase 4C profit engine + Phase 5A net profit calculation</li>
          </ul>
        </CardContent>
      </Card>
    </>
  )
}

// =============================================================
// Categories Tab
// =============================================================
function CategoriesTab({
  categories, products, loading, canWrite, isOwner, orgId, onReload,
}: {
  categories: ProductCategory[]
  products: Product[]
  loading: boolean
  canWrite: boolean
  isOwner: boolean
  orgId: number
  onReload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<CategoryForm>(emptyCategoryForm)

  const reset = () => { setForm(emptyCategoryForm); setEditId(null) }

  const handleEdit = (c: ProductCategory) => {
    setForm({
      name: c.name,
      slug: c.slug,
      description: c.description ?? '',
      display_order: c.display_order,
      active: c.active,
    })
    setEditId(c.id)
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Nama kategori wajib diisi')
    setSaving(true)
    try {
      const slug = form.slug.trim() || slugifyCategory(form.name)
      const payload = {
        name: form.name.trim(),
        slug,
        description: form.description.trim() || null,
        display_order: form.display_order || 0,
        active: form.active,
      }
      if (editId) {
        await updateCategory(supabase, editId, payload)
        toast.success('Kategori diupdate')
      } else {
        await insertCategory(supabase, orgId, payload)
        toast.success('Kategori ditambahkan')
      }
      setOpen(false)
      reset()
      onReload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal simpan', { description: msg.includes('duplicate') ? 'Slug sudah dipakai.' : msg })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (c: ProductCategory) => {
    const linked = await countProductsInCategory(supabase, c.id)
    let confirmMsg = `Hapus kategori "${c.name}"?`
    if (linked > 0) {
      confirmMsg = `⚠️ Kategori "${c.name}" dipakai ${linked} produk.\n\nKalau dihapus, produk-produk itu akan kehilangan kategori (jadi -).\n\nLanjut?`
    }
    if (!confirm(confirmMsg)) return
    try {
      await deleteCategory(supabase, c.id)
      toast.success(`Kategori "${c.name}" dihapus`)
      onReload()
    } catch (err) {
      toast.error('Gagal hapus', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const productCountByCategory = useMemo(() => {
    const m = new Map<number, number>()
    products.forEach(p => {
      if (p.category_id) m.set(p.category_id, (m.get(p.category_id) || 0) + 1)
    })
    return m
  }, [products])

  return (
    <>
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-row gap-3 items-center">
          <FolderTree className="w-5 h-5 text-violet-500" />
          <div className="flex-1">
            <p className="text-sm font-medium">Kategori Produk</p>
            <p className="text-xs text-muted-foreground">
              Group produk untuk filter + Per Produk analytics (Phase 5A)
            </p>
          </div>
          {canWrite && (
            <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
              <DialogTrigger render={
                <Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
                  <Plus className="w-4 h-4 mr-2" />Tambah Kategori
                </Button>
              } />
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editId ? 'Edit' : 'Tambah'} Kategori</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nama Kategori *</Label>
                    <Input
                      value={form.name}
                      onChange={e => {
                        setForm({
                          ...form,
                          name: e.target.value,
                          slug: editId ? form.slug : slugifyCategory(e.target.value),
                        })
                      }}
                      placeholder="e.g. Skincare"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug</Label>
                    <Input
                      value={form.slug}
                      onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, '-') })}
                      placeholder="auto dari nama"
                    />
                    <p className="text-[10px] text-muted-foreground">Auto-generated dari nama, atau custom (lowercase + dash)</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Deskripsi</Label>
                    <Textarea
                      value={form.description}
                      onChange={e => setForm({ ...form, description: e.target.value })}
                      placeholder="opsional"
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Order</Label>
                    <Input
                      type="number"
                      value={form.display_order}
                      onChange={e => setForm({ ...form, display_order: Number(e.target.value) })}
                      placeholder="0 (urut dari kecil ke besar)"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="cat-active"
                      checked={form.active}
                      onCheckedChange={v => setForm({ ...form, active: v === true })}
                    />
                    <Label htmlFor="cat-active" className="cursor-pointer">Aktif (muncul di dropdown)</Label>
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                    disabled={saving}
                  >
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Simpan
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead className="text-center">Order</TableHead>
                <TableHead className="text-center">Produk</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7} className="py-3">
                      <div className="h-4 bg-muted animate-pulse rounded w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={FolderTree}
                      title="Belum ada kategori"
                      description="Tambah kategori untuk group produk. Misal: Skincare, Fashion, Elektronik."
                    />
                  </TableCell>
                </TableRow>
              ) : categories.map(c => (
                <TableRow key={c.id} className={!c.active ? 'opacity-60' : ''}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate">{c.description || '—'}</TableCell>
                  <TableCell className="text-center text-xs">{c.display_order}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-xs">
                      {productCountByCategory.get(c.id) || 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={c.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-muted-foreground'}>
                      {c.active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => handleEdit(c)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {isOwner && (
                        <Button variant="ghost" size="icon" title="Hapus" onClick={() => handleDelete(c)} className="text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
