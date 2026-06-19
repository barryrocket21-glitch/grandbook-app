'use client'
// =============================================================
// Stok / Inventory (#3 blueprint). Model: stok_masuk (restock manual) −
// terkirim + retur − terkomit = available. terkirim/retur/terkomit live dari
// order (retur auto-balik, kirim auto-kurang). Owner/admin.
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/ui/page-header'
import { Boxes, Loader2, RefreshCw, Plus, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errors'

const supabase = createClient()
const n = (v: unknown) => Number(v) || 0

interface Row {
  product_id: number; product_name: string; supplier_name: string | null
  stok_masuk: number; terkomit: number; terkirim: number; retur: number
  sisa: number; available: number; threshold: number; status: string
}
const STATUS_COLOR: Record<string, string> = {
  Ready: 'bg-emerald-500/10 text-emerald-600', Menipis: 'bg-amber-500/10 text-amber-600', Habis: 'bg-red-500/10 text-red-600',
}

export default function InventoryPage() {
  const { role, loading: authLoading } = useAuth()
  const canManage = role === 'owner' || role === 'admin'
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [dlg, setDlg] = useState<Row | null>(null)
  const [form, setForm] = useState({ qty: '', reason: 'RESTOCK', note: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('inventory_status')
      if (error) throw error
      setRows((data || []) as Row[])
    } catch (err) { console.warn('inventory:', err) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!dlg) return
    const qty = Number(form.qty)
    if (!qty) { toast.error('Isi jumlah'); return }
    setSaving(true)
    try {
      const { error } = await supabase.rpc('record_stock_movement', {
        p_product_id: dlg.product_id, p_qty: qty, p_reason: form.reason, p_note: form.note.trim() || null,
      })
      if (error) throw error
      toast.success(`Stok ${dlg.product_name} ${qty > 0 ? '+' : ''}${qty}`)
      setDlg(null); setForm({ qty: '', reason: 'RESTOCK', note: '' }); await load()
    } catch (err) { toast.error('Gagal catat stok', { description: getErrorMessage(err) }) } finally { setSaving(false) }
  }

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>

  const habis = rows.filter(r => r.status === 'Habis').length
  const menipis = rows.filter(r => r.status === 'Menipis').length

  return (
    <div className="space-y-4">
      <PageHeader icon={Boxes} title="Stok / Inventory"
        description="Stok Masuk (restock) − Terkirim + Retur − Terkomit = Available. Terkirim/retur/terkomit otomatis dari order."
        actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>} />

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="bg-red-500/10 text-red-600">Habis: {habis}</Badge>
        <Badge variant="outline" className="bg-amber-500/10 text-amber-600">Menipis: {menipis}</Badge>
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">Ready: {rows.length - habis - menipis}</Badge>
      </div>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Produk</TableHead><TableHead>Supplier</TableHead>
              <TableHead className="text-right">Stok Masuk</TableHead><TableHead className="text-right">Terkomit</TableHead>
              <TableHead className="text-right">Terkirim</TableHead><TableHead className="text-right">Retur</TableHead>
              <TableHead className="text-right">Sisa Fisik</TableHead><TableHead className="text-right">Available</TableHead>
              <TableHead>Status</TableHead>{canManage && <TableHead className="text-right">Aksi</TableHead>}
            </TableRow></TableHeader>
            <TableBody>
              {loading ? <TableRow><TableCell colSpan={10} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
              : rows.length === 0 ? <TableRow><TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">Belum ada produk.</TableCell></TableRow>
              : rows.map(r => (
                <TableRow key={r.product_id}>
                  <TableCell className="text-xs font-medium">{r.product_name}</TableCell>
                  <TableCell className="text-xs">{r.supplier_name || '—'}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{n(r.stok_masuk)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{n(r.terkomit)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{n(r.terkirim)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{n(r.retur)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{n(r.sisa)}</TableCell>
                  <TableCell className={`text-right text-xs tabular-nums font-semibold ${n(r.available) <= 0 ? 'text-red-600' : n(r.available) <= r.threshold ? 'text-amber-600' : 'text-emerald-600'}`}>{n(r.available)}</TableCell>
                  <TableCell><Badge variant="outline" className={`${STATUS_COLOR[r.status] || 'bg-muted'} text-[10px]`}>{r.status}</Badge></TableCell>
                  {canManage && <TableCell className="text-right"><Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setDlg(r); setForm({ qty: '', reason: 'RESTOCK', note: '' }) }}><Plus className="w-3 h-3" />Stok</Button></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Semua "Habis"? Catat <b>Stok Masuk</b> dulu (tombol Stok) pas lu beli barang dari supplier.</p>

      <Dialog open={!!dlg} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Catat Stok — {dlg?.product_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Jenis</label>
              <Select value={form.reason} onValueChange={v => setForm({ ...form, reason: v || 'RESTOCK' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RESTOCK">Restock (beli dari supplier, +)</SelectItem>
                  <SelectItem value="ADJUST">Koreksi (+/−)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Jumlah (boleh minus buat koreksi)</label>
              <Input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="100" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Catatan (opsional)</label>
              <Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="PO #123 / koreksi opname" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Batal</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
