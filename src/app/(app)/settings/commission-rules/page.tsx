'use client'
import { useState, useEffect } from 'react'
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
import type { CommissionRule, UserRole } from '@/lib/types'

const supabase = createClient()

export default function CommissionRulesPage() {
  const [rules, setRules] = useState<CommissionRule[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ role: 'advertiser' as UserRole, rule_type: 'PERCENT_REVENUE' as string | null, value: 0 })

  const fetch = async () => {
    const { data } = await supabase.from('commission_rules').select('*').eq('active', true).order('role')
    setRules(data || [])
  }
  useEffect(() => { fetch() }, [])

  const reset = () => { setForm({ role: 'advertiser', rule_type: 'PERCENT_REVENUE', value: 0 }); setEditId(null) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { role: form.role, rule_type: form.rule_type, value: form.value, active: true }
      const { error } = editId
        ? await supabase.from('commission_rules').update(payload).eq('id', editId)
        : await supabase.from('commission_rules').insert(payload)
      if (error) throw error
      toast.success(editId ? 'Rule diupdate' : 'Rule ditambahkan')
      setOpen(false); reset(); fetch()
    } catch (err: any) { toast.error('Gagal simpan', { description: err.message }) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Hapus aturan komisi ini? Tidak akan berlaku lagi untuk komisi yang dihitung setelah ini.')) return
    const { error } = await supabase.from('commission_rules').update({ active: false }).eq('id', id)
    if (error) { toast.error('Gagal hapus', { description: error.message }); return }
    toast.success('Rule dihapus'); fetch()
  }

  const roles: UserRole[] = ['advertiser', 'cs', 'admin']

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Aturan Komisi"
        description="Konfigurasi perhitungan komisi per role"
        actions={
          <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
            <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}><Plus className="w-4 h-4 mr-2" />Tambah Rule</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Aturan Komisi</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2"><Label>Role</Label><Select value={form.role} onValueChange={v => setForm({ ...form, role: v as UserRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="w-[200px]">{roles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Tipe</Label><Select value={form.rule_type} onValueChange={v => setForm({ ...form, rule_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="w-[240px]"><SelectItem value="PERCENT_REVENUE">% dari Revenue</SelectItem><SelectItem value="FLAT_PER_ORDER">Flat per Order (Rp)</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>{form.rule_type === 'PERCENT_REVENUE' ? 'Persentase (%)' : 'Nominal (Rp)'}</Label><Input type="number" step="0.01" value={form.value} onChange={e => setForm({ ...form, value: Number(e.target.value) })} /></div>
                <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Tipe</TableHead><TableHead>Nilai</TableHead><TableHead>Status Order</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {rules.map(r => (
                <TableRow key={r.id}>
                  <TableCell><Badge variant="outline">{ROLE_LABELS[r.role] || r.role}</Badge></TableCell>
                  <TableCell className="text-sm">{r.rule_type === 'PERCENT_REVENUE' ? '% Revenue' : 'Flat/Order'}</TableCell>
                  <TableCell className="font-semibold">{r.rule_type === 'PERCENT_REVENUE' ? `${r.value}%` : formatRupiah(r.value)}</TableCell>
                  <TableCell className="text-xs">{r.applies_to_status?.join(', ') || 'SELESAI'}</TableCell>
                  <TableCell className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setForm({ role: r.role as UserRole, rule_type: r.rule_type, value: r.value }); setEditId(r.id); setOpen(true) }}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDelete(r.id)}><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {rules.length === 0 && <TableRow><TableCell colSpan={5} className="p-0"><EmptyState icon={Coins} title="Belum ada aturan komisi" description="Tambah rule untuk menentukan komisi advertiser, CS, dan admin per order yang masuk." /></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
