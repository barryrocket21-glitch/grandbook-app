'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Pencil, Loader2, Receipt, Trash2, Search, TrendingDown } from 'lucide-react'
import { formatRupiah, formatDate } from '@/lib/format'
import type { Expense } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, defaultRange, type DateRange } from '@/components/ui/date-range-picker'

const supabase = createClient()

const today = () => new Date().toISOString().split('T')[0]

export default function ExpensesPage() {
  const { profile, role } = useAuth()
  const isOwner = role === 'owner'
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [range, setRange] = useState<DateRange>(defaultRange())
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [form, setForm] = useState({ expense_date: today(), category: '', description: '', amount: 0 })

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('expenses').select('*').gte('expense_date', range.from).lte('expense_date', range.to).order('expense_date', { ascending: false })
    setExpenses(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [range])

  const reset = () => {
    setForm({ expense_date: today(), category: '', description: '', amount: 0 })
    setEditId(null)
  }

  const openEdit = (e: Expense) => {
    setForm({ expense_date: e.expense_date, category: e.category, description: e.description || '', amount: e.amount })
    setEditId(e.id)
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.category || !form.amount) return toast.error('Kategori dan jumlah wajib diisi')
    setSaving(true)
    try {
      const payload: any = { expense_date: form.expense_date, category: form.category, description: form.description || null, amount: form.amount }
      if (editId) {
        const { error } = await supabase.from('expenses').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Biaya diupdate')
      } else {
        payload.created_by = profile?.id
        const { error } = await supabase.from('expenses').insert(payload)
        if (error) throw error
        toast.success('Biaya ditambahkan')
      }
      setOpen(false); reset(); load()
    } catch (err: any) { toast.error('Gagal simpan', { description: err.message }) }
    finally { setSaving(false) }
  }

  const handleDelete = async (e: Expense) => {
    if (!confirm(`Hapus biaya "${e.category}" sebesar ${formatRupiah(e.amount)} (${formatDate(e.expense_date)})?`)) return
    const { error } = await supabase.from('expenses').delete().eq('id', e.id)
    if (error) { toast.error('Gagal hapus', { description: error.message }); return }
    toast.success('Biaya dihapus')
    load()
  }

  const categories = useMemo(() => {
    const set = new Set<string>()
    expenses.forEach(e => { if (e.category) set.add(e.category) })
    return Array.from(set).sort()
  }, [expenses])

  const filtered = useMemo(() => {
    let list = expenses
    if (categoryFilter !== 'ALL') list = list.filter(e => e.category === categoryFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        e.category.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [expenses, search, categoryFilter])

  const totalExpense = filtered.reduce((s, e) => s + Number(e.amount), 0)
  const byCategory = useMemo(() => {
    return filtered.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + Number(e.amount)
      return acc
    }, {} as Record<string, number>)
  }, [filtered])

  const topCategory = useMemo(() => {
    const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1])
    return entries[0] || null
  }, [byCategory])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Biaya Operasional"
        description={`${filtered.length} entry • Total ${formatRupiah(totalExpense)}`}
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button onClick={() => { reset(); setOpen(true) }} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">
              <Plus className="w-4 h-4 mr-2" />Tambah
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><TrendingDown className="w-5 h-5 text-red-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Pengeluaran</p>
              <p className="text-xl font-bold text-red-500">{formatRupiah(totalExpense)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20"><Receipt className="w-5 h-5 text-amber-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Kategori Tertinggi</p>
              <p className="text-base font-bold">{topCategory ? topCategory[0] : '—'}</p>
              <p className="text-[10px] text-muted-foreground">{topCategory ? formatRupiah(topCategory[1]) : 'belum ada'}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-blue-500/15 rounded-xl ring-1 ring-blue-500/20"><Receipt className="w-5 h-5 text-blue-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Jumlah Kategori</p>
              <p className="text-xl font-bold">{Object.keys(byCategory).length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
            const pct = totalExpense > 0 ? (amt / totalExpense) * 100 : 0
            const isActive = categoryFilter === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(isActive ? 'ALL' : cat)}
                className={`text-left rounded-lg border bg-card p-3 transition-all hover:shadow-md ${isActive ? 'ring-2 ring-violet-500 border-violet-500/50' : 'hover:border-violet-500/30'}`}
              >
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground truncate">{cat}</p>
                <p className="text-base font-bold mt-1">{formatRupiah(amt)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(0)}% dari total</p>
              </button>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari kategori atau deskripsi..." className="pl-9" />
          </div>
          {categories.length > 0 && (
            <Select value={categoryFilter} onValueChange={v => v && setCategoryFilter(v)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent className="w-[240px]">
                <SelectItem value="ALL">Semua kategori</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={5} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState icon={Receipt} title="Belum ada biaya tercatat" description="Klik 'Tambah' untuk catat biaya operasional." />
                  </TableCell>
                </TableRow>
              ) : filtered.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">{formatDate(e.expense_date)}</TableCell>
                  <TableCell className="font-medium">{e.category}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-md truncate">{e.description || '—'}</TableCell>
                  <TableCell className="font-semibold text-right">{formatRupiah(e.amount)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(e)}><Pencil className="w-3.5 h-3.5" /></Button>
                      {isOwner && <Button variant="ghost" size="icon" title="Hapus" onClick={() => handleDelete(e)} className="text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Biaya Operasional</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2"><Label>Tanggal</Label><Input type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Kategori *</Label>
              <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Gaji, Packaging, Sewa, Utilitas, dll" required list="exp-categories" />
              <datalist id="exp-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="space-y-2"><Label>Deskripsi</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="opsional" /></div>
            <div className="space-y-2"><Label>Jumlah (Rp) *</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} required /></div>
            <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
