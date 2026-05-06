'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { ArrowLeft, User, Package, FileText, Save, Truck, Pencil, Trash2, MessageCircle, Loader2 } from 'lucide-react'
import { formatRupiah, formatDate, formatDateTime } from '@/lib/format'
import { ORDER_STATUSES, RESI_STATUSES, EKSPEDISI_LIST } from '@/lib/constants'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'

const supabase = createClient()

export default function OrderDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const { role } = useAuth()
  const [order, setOrder] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [resi, setResi] = useState('')
  const [ekspedisi, setEkspedisi] = useState('')
  const [resiStatus, setResiStatus] = useState('')
  const [savingResi, setSavingResi] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ customer_name: '', customer_phone: '', customer_city: '', customer_province: '', customer_address: '', notes: '', shipping_cost: 0, discount: 0 })
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    const fetch = async () => {
      const { data: o } = await supabase.from('orders').select('*, campaigns(campaign_name, platform), advertiser:profiles!advertiser_id(full_name), cs:profiles!cs_id(full_name), admin:profiles!admin_id(full_name)').eq('id', id).single()
      const { data: i } = await supabase.from('order_items').select('*, products(name, sku)').eq('order_id', id)
      setOrder(o); setItems(i || []); setStatus(o?.status || '')
      setResi(o?.resi ?? ''); setEkspedisi(o?.ekspedisi ?? ''); setResiStatus(o?.resi_status ?? '')
      setLoading(false)
    }
    fetch()
  }, [id])

  const updateStatus = async () => {
    const { error } = await supabase.from('orders').update({ status }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Status diupdate')
    setOrder({ ...order, status })
  }

  const openEdit = () => {
    if (!order) return
    setEditForm({
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      customer_city: order.customer_city || '',
      customer_province: order.customer_province || '',
      customer_address: order.customer_address || '',
      notes: order.notes || '',
      shipping_cost: Number(order.shipping_cost) || 0,
      discount: Number(order.discount) || 0,
    })
    setEditOpen(true)
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editForm.customer_name.trim()) return toast.error('Nama customer wajib diisi')
    setSavingEdit(true)
    try {
      const total = Number(order.subtotal) + Number(editForm.shipping_cost) - Number(editForm.discount)
      const { error } = await supabase.from('orders').update({
        customer_name: editForm.customer_name,
        customer_phone: editForm.customer_phone || null,
        customer_city: editForm.customer_city || null,
        customer_province: editForm.customer_province || null,
        customer_address: editForm.customer_address || null,
        notes: editForm.notes || null,
        shipping_cost: editForm.shipping_cost,
        discount: editForm.discount,
        total,
      }).eq('id', id)
      if (error) throw error
      toast.success('Order diupdate')
      setOrder({ ...order, ...editForm, total })
      setEditOpen(false)
    } catch (err: any) {
      toast.error('Gagal update', { description: err.message })
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!order) return
    if (!confirm(`Hapus permanen order ${order.order_number} (${order.customer_name})?\n\nSemua item, komisi, dan data analitik terkait akan IKUT TERHAPUS. Tidak bisa di-undo.`)) return
    const { error } = await supabase.from('orders').delete().eq('id', id)
    if (error) { toast.error('Gagal hapus', { description: error.message }); return }
    toast.success('Order dihapus')
    router.push('/orders/list')
  }

  const waLink = (phone: string) => `https://wa.me/${phone.replace(/[^0-9]/g, '').replace(/^0/, '62')}`

  const updateResi = async () => {
    setSavingResi(true)
    const payload: Record<string, string | null> = {
      resi: resi || null,
      ekspedisi: ekspedisi || null,
      resi_status: resiStatus || null,
    }
    if (resi && !resiStatus) payload.resi_status = 'AKTIF'
    const { error } = await supabase.from('orders').update(payload).eq('id', id)
    setSavingResi(false)
    if (error) { toast.error(error.message); return }
    toast.success('Info resi disimpan')
    setOrder({ ...order, ...payload })
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>

  if (!order) return <div className="text-center py-12 text-muted-foreground">Order tidak ditemukan</div>

  const statusInfo = ORDER_STATUSES.find(s => s.value === order.status)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" render={<Link href="/orders/list" />}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{order.order_number}</h1>
          <p className="text-muted-foreground text-sm">{formatDateTime(order.created_at)}</p>
        </div>
        <Badge variant="outline" className={`text-sm ${statusInfo?.color}`}>{statusInfo?.label}</Badge>
        {(role === 'cs' || role === 'admin' || role === 'owner') && (
          <Button variant="outline" size="sm" onClick={openEdit}><Pencil className="w-4 h-4 mr-1.5" />Edit</Button>
        )}
        {role === 'owner' && (
          <Button variant="outline" size="sm" onClick={handleDelete} className="text-red-500 border-red-500/30 hover:bg-red-500/10">
            <Trash2 className="w-4 h-4 mr-1.5" />Hapus
          </Button>
        )}
      </div>

      {/* Status Update */}
      {(role === 'cs' || role === 'owner') && (
        <Card className="border-violet-500/20">
          <CardContent className="pt-4 pb-4 flex items-center gap-3 flex-wrap">
            <Select value={status} onValueChange={v => v && setStatus(v)}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent className="w-[220px]">{ORDER_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select>
            <Button onClick={updateStatus} disabled={status === order.status} className="bg-violet-600 text-white"><Save className="w-4 h-4 mr-2" />Update Status</Button>
          </CardContent>
        </Card>
      )}

      {/* Resi / Pengiriman */}
      {(role === 'cs' || role === 'owner' || role === 'admin') && (
        <Card className="border-violet-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="w-4 h-4 text-violet-500" />
              Info Pengiriman & Resi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">No Resi</Label>
                <Input
                  value={resi}
                  onChange={e => setResi(e.target.value)}
                  placeholder="Masukkan no. resi..."
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ekspedisi</Label>
                <Select value={ekspedisi} onValueChange={v => setEkspedisi(!v || v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih ekspedisi..." /></SelectTrigger>
                  <SelectContent className="w-[260px]">
                    <SelectItem value="none">— Pilih —</SelectItem>
                    {EKSPEDISI_LIST.map(e => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status Resi</Label>
                <Select value={resiStatus} onValueChange={v => setResiStatus(!v || v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih status..." /></SelectTrigger>
                  <SelectContent className="w-[220px]">
                    <SelectItem value="none">— Pilih —</SelectItem>
                    {RESI_STATUSES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={updateResi} disabled={savingResi} size="sm" className="bg-violet-600 text-white">
              {savingResi ? 'Menyimpan...' : <><Save className="w-3.5 h-3.5 mr-1.5" />Simpan Info Resi</>}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Customer */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4 text-violet-500" />Customer</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Nama</span><span className="font-medium">{order.customer_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Telepon</span>{order.customer_phone ? <a href={waLink(order.customer_phone)} target="_blank" rel="noopener" className="text-emerald-500 hover:underline inline-flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{order.customer_phone}</a> : <span>-</span>}</div>
            <div className="flex justify-between"><span className="text-muted-foreground">Kota</span><span>{order.customer_city || '-'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Provinsi</span><span>{order.customer_province || '-'}</span></div>
            {order.customer_address && <><Separator /><p className="text-muted-foreground text-xs">{order.customer_address}</p></>}
          </CardContent>
        </Card>

        {/* Info */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4 text-violet-500" />Info Order</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Tanggal</span><span>{formatDate(order.order_date)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Pembayaran</span><Badge variant="outline">{order.payment_method}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Campaign</span><span>{order.campaigns?.campaign_name || '-'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Advertiser</span><span>{order.advertiser?.full_name || '-'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CS</span><span>{order.cs?.full_name || '-'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Admin</span><span>{order.admin?.full_name || '-'}</span></div>
            {order.notes && <><Separator /><p className="text-xs text-muted-foreground">{order.notes}</p></>}
          </CardContent>
        </Card>
      </div>

      {/* Items */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4 text-violet-500" />Item Produk</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead>Qty</TableHead><TableHead>Harga</TableHead><TableHead>Subtotal</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map(i => (
                <TableRow key={i.id}><TableCell className="font-medium">{i.products?.name}</TableCell><TableCell>{i.qty}</TableCell><TableCell>{formatRupiah(i.price)}</TableCell><TableCell className="font-semibold">{formatRupiah(i.price * i.qty)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Totals */}
      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{formatRupiah(order.subtotal)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Ongkir</span><span>{formatRupiah(order.shipping_cost)}</span></div>
          {order.discount > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Diskon</span><span className="text-red-500">-{formatRupiah(order.discount)}</span></div>}
          <Separator />
          <div className="flex justify-between text-lg font-bold"><span>Total</span><span className="text-emerald-500">{formatRupiah(order.total)}</span></div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Order {order.order_number}</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Nama Customer *</Label><Input value={editForm.customer_name} onChange={e => setEditForm({ ...editForm, customer_name: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label className="text-xs">No. WA / HP</Label><Input value={editForm.customer_phone} onChange={e => setEditForm({ ...editForm, customer_phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Kota</Label><Input value={editForm.customer_city} onChange={e => setEditForm({ ...editForm, customer_city: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Provinsi</Label><Input value={editForm.customer_province} onChange={e => setEditForm({ ...editForm, customer_province: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Alamat Lengkap</Label><Textarea value={editForm.customer_address} onChange={e => setEditForm({ ...editForm, customer_address: e.target.value })} rows={2} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Catatan Internal</Label><Textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={2} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Ongkir</Label><Input type="number" value={editForm.shipping_cost} onChange={e => setEditForm({ ...editForm, shipping_cost: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Diskon</Label><Input type="number" value={editForm.discount} onChange={e => setEditForm({ ...editForm, discount: Number(e.target.value) })} /></div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm flex justify-between">
              <span className="text-muted-foreground">Total baru</span>
              <span className="font-bold text-emerald-500">{formatRupiah(Number(order.subtotal) + editForm.shipping_cost - editForm.discount)}</span>
            </div>
            <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={savingEdit}>{savingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan Perubahan</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
