'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Pencil, Loader2, Receipt } from 'lucide-react'
import { formatRupiah, formatDate } from '@/lib/format'
import type { Expense } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'

const supabase = createClient()

export default function ExpensesPage() {
  const { profile } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [form, setForm] = useState({ expense_date: new Date().toISOString().split('T')[0], category: '', description: '', amount: 0 })

  const fetch = async () => {
    setLoading(true)
    const { data } = await supabase.from('expenses').select('*').gte('expense_date', `${month}-01`).lte('expense_date', `${month}-31`).order('expense_date', { ascending: false })
    setExpenses(data || [])
    setLoading(false)
  }
  useEffect(() => { fetch() }, [month])

  const reset = () => { setForm({ expense_date: new Date().toISOString().split('T')[0], category: '', description: '', amount: 0 }); setEditId(null) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.category || !form.amount) return toast.error('Kategori dan jumlah wajib diisi')
    setSaving(true)
    try {
      const payload = { expense_date: form.expense_date, category: form.category, description: form.description || null, amount: form.amount, created_by: profile?.id }
      if (editId) {
        const { error } = await supabase.from('expenses').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Biaya diupdate')
      } else {
        const { error } = await supabase.from('expenses').insert(payload)
        if (error) throw error
        toast.success('Biaya ditambahkan')
      }
      setOpen(false); reset(); fetch()
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const totalExpense = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const byCategory = expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + Number(e.amount); return acc }, {} as Record<string, number>)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Biaya Operasional"
        description={`Total bulan ini: ${formatRupiah(totalExpense)}`}
        actions={
          <>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" />
            <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
              <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}><Plus className="w-4 h-4 mr-2" />Tambah</DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Biaya</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2"><Label>Tanggal</Label><Input type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Kategori *</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Gaji, Packaging, Kantor, dll" required /></div>
                  <div className="space-y-2"><Label>Deskripsi</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Jumlah (Rp) *</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} required /></div>
                  <Button type="submit" className="w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {/* By Category */}
      {Object.keys(byCategory).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
            <Card key={cat}><CardContent className="pt-4 pb-4"><p className="text-xs text-muted-foreground">{cat}</p><p className="text-lg font-bold">{formatRupiah(amt)}</p></CardContent></Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Kategori</TableHead><TableHead>Deskripsi</TableHead><TableHead>Jumlah</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {expenses.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">{formatDate(e.expense_date)}</TableCell>
                  <TableCell className="font-medium">{e.category}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{e.description || '-'}</TableCell>
                  <TableCell className="font-semibold">{formatRupiah(e.amount)}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => { setForm({ expense_date: e.expense_date, category: e.category, description: e.description || '', amount: e.amount }); setEditId(e.id); setOpen(true) }}><Pencil className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
              {expenses.length === 0 && <TableRow><TableCell colSpan={5} className="p-0"><EmptyState icon={Receipt} title="Belum ada biaya tercatat" description={`Belum ada biaya operasional di bulan ${month}.`} /></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
