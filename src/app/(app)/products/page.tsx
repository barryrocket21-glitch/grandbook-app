'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Pencil, Package, Loader2 } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import type { Product } from '@/lib/types'

const supabase = createClient()

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', sku: '', price_default: 0, hpp: 0, category: '' })

  const fetch = async () => {
    setLoading(true)
    const { data } = await supabase.from('products').select('*').order('name')
    setProducts(data || [])
    setLoading(false)
  }
  useEffect(() => { fetch() }, [])

  const reset = () => { setForm({ name: '', sku: '', price_default: 0, hpp: 0, category: '' }); setEditId(null) }

  const handleEdit = (p: Product) => {
    setForm({ name: p.name, sku: p.sku || '', price_default: p.price_default, hpp: p.hpp, category: p.category || '' })
    setEditId(p.id); setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return toast.error('Nama produk wajib diisi')
    setSaving(true)
    try {
      const payload = { name: form.name, sku: form.sku || null, price_default: form.price_default, hpp: form.hpp, category: form.category || null }
      if (editId) {
        const { error } = await supabase.from('products').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Produk diupdate')
      } else {
        const { error } = await supabase.from('products').insert(payload)
        if (error) throw error
        toast.success('Produk ditambahkan')
      }
      setOpen(false); reset(); fetch()
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Master Produk</h1>
          <p className="text-muted-foreground mt-1">{products.length} produk terdaftar</p>
        </div>
        <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
          <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white" />}><Plus className="w-4 h-4 mr-2" />Tambah Produk</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Produk</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2"><Label>Nama Produk *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="space-y-2"><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Harga Jual</Label><Input type="number" value={form.price_default} onChange={e => setForm({ ...form, price_default: Number(e.target.value) })} /></div>
                <div className="space-y-2"><Label>HPP</Label><Input type="number" value={form.hpp} onChange={e => setForm({ ...form, hpp: Number(e.target.value) })} /></div>
              </div>
              <div className="space-y-2"><Label>Kategori</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></div>
              <Button type="submit" className="w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead>SKU</TableHead><TableHead>Harga Jual</TableHead><TableHead>HPP</TableHead><TableHead>Margin</TableHead><TableHead>Kategori</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : products.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Belum ada produk</TableCell></TableRow>
              ) : products.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs">{p.sku || '-'}</TableCell>
                  <TableCell>{formatRupiah(p.price_default)}</TableCell>
                  <TableCell>{formatRupiah(p.hpp)}</TableCell>
                  <TableCell><Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">{p.price_default > 0 ? ((p.price_default - p.hpp) / p.price_default * 100).toFixed(0) : 0}%</Badge></TableCell>
                  <TableCell>{p.category || '-'}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => handleEdit(p)}><Pencil className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
