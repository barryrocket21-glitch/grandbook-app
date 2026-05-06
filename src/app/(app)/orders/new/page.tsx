'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Plus, Trash2, Save, Loader2, User, Package, Calculator } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/constants'
import type { Product, Campaign, Profile } from '@/lib/types'

const supabase = createClient()

const emptyItem = () => ({ product_id: 0, qty: 1, price: 0, name: '', hpp: 0 })

export default function NewOrderPage() {
  const { profile } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [csUsers, setCsUsers] = useState<Profile[]>([])
  const [advUsers, setAdvUsers] = useState<Profile[]>([])
  const [saving, setSaving] = useState(false)

  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerCity, setCustomerCity] = useState('')
  const [customerProvince, setCustomerProvince] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('COD')
  const [campaignId, setCampaignId] = useState('')
  const [advertiserId, setAdvertiserId] = useState('')
  const [csId, setCsId] = useState('')
  const [shippingCost, setShippingCost] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([emptyItem()])

  useEffect(() => {
    const fetchAll = async () => {
      const [p, c, cs, adv] = await Promise.all([
        supabase.from('products').select('*').eq('active', true).order('name'),
        supabase.from('campaigns').select('*').eq('active', true),
        supabase.from('profiles').select('*').eq('role', 'cs').eq('active', true),
        supabase.from('profiles').select('*').eq('role', 'advertiser').eq('active', true),
      ])
      setProducts(p.data || [])
      setCampaigns(c.data || [])
      setCsUsers(cs.data || [])
      setAdvUsers(adv.data || [])
    }
    fetchAll()
  }, [])

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
  const total = subtotal + shippingCost - discount

  const addItem = () => setItems([...items, emptyItem()])
  const removeItem = (i: number) => items.length > 1 && setItems(items.filter((_, idx) => idx !== i))

  const updateItem = (idx: number, field: string, val: any) => {
    const n = [...items]
    if (field === 'product_id') {
      const p = products.find(p => p.id === Number(val))
      if (p) n[idx] = { ...n[idx], product_id: p.id, price: p.price_default, name: p.name, hpp: p.hpp }
    } else {
      (n[idx] as any)[field] = val
    }
    setItems(n)
  }

  const resetForm = () => {
    setCustomerName(''); setCustomerPhone(''); setCustomerCity(''); setCustomerProvince('')
    setCustomerAddress(''); setNotes(''); setShippingCost(0); setDiscount(0)
    setItems([emptyItem()])
  }

  // Cek phone deduplication — return order_id asal kalau ada match di 7 hari terakhir
  const findDuplicate = async (phone: string): Promise<{ id: number; order_number: string; cs_id: string | null } | null> => {
    if (!phone || phone.length < 6) return null
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const cutoff = sevenDaysAgo.toISOString().split('T')[0]
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, cs_id')
      .eq('customer_phone', phone)
      .gte('order_date', cutoff)
      .is('duplicate_of', null)
      .order('order_date', { ascending: false })
      .limit(1)
    return data && data.length > 0 ? data[0] : null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerName.trim()) return toast.error('Nama customer wajib diisi')
    if (items.some(i => !i.product_id)) return toast.error('Pilih produk untuk semua item')
    setSaving(true)
    try {
      // Phone dedup check
      let duplicateOf: number | null = null
      if (customerPhone) {
        const dup = await findDuplicate(customerPhone)
        if (dup) {
          const sameCs = dup.cs_id === (csId || null)
          const msg = sameCs
            ? `Customer ${customerPhone} sudah pernah order di 7 hari terakhir (${dup.order_number}). Lanjut create order ini sebagai duplicate (tidak dihitung untuk komisi/CR)?`
            : `Customer ${customerPhone} sudah pernah dihandle CS lain di 7 hari terakhir (${dup.order_number}). Lanjut?`
          if (!confirm(msg)) {
            setSaving(false)
            return
          }
          duplicateOf = dup.id
        }
      }

      const { data: orderNum } = await supabase.rpc('generate_order_number')
      const orderNumber = orderNum || `ORD-${orderDate.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`
      const { data: order, error } = await supabase.from('orders').insert({
        order_number: orderNumber, order_date: orderDate, customer_name: customerName,
        customer_phone: customerPhone, customer_city: customerCity, customer_province: customerProvince,
        customer_address: customerAddress, subtotal, shipping_cost: shippingCost, discount, total,
        payment_method: paymentMethod, status: 'BARU',
        campaign_id: campaignId ? Number(campaignId) : null,
        advertiser_id: advertiserId || null, cs_id: csId || null, admin_id: profile?.id, notes,
        duplicate_of: duplicateOf,
      }).select().single()
      if (error) throw error
      const { error: itemErr } = await supabase.from('order_items').insert(items.map(i => ({
        order_id: order.id, product_id: i.product_id, qty: i.qty, price: i.price, hpp_snapshot: i.hpp,
      })))
      if (itemErr) throw itemErr
      if (duplicateOf) {
        toast.warning('Order tersimpan sebagai duplicate', { description: `Tidak dihitung untuk komisi/CR. Original: ${orderNumber}` })
      } else {
        toast.success('Order berhasil!', { description: orderNumber })
      }
      resetForm()
    } catch (err: any) {
      toast.error('Gagal simpan order', { description: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Input Order Baru</h1>
        <p className="text-muted-foreground mt-1 text-sm">Pilih sumber order di kanan, lalu isi data customer dan produk</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Customer + Products */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4 text-violet-500" />Informasi Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nama Customer *</Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nama lengkap" required />
                </div>
                <div className="space-y-2">
                  <Label>No. WA / HP</Label>
                  <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="08xxx" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Kota</Label><Input value={customerCity} onChange={e => setCustomerCity(e.target.value)} /></div>
                <div className="space-y-2"><Label>Provinsi</Label><Input value={customerProvince} onChange={e => setCustomerProvince(e.target.value)} /></div>
              </div>
              <div className="space-y-2">
                <Label>Alamat Lengkap</Label>
                <Textarea value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} rows={2} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4 text-violet-500" />Produk ({items.length} item)</CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={addItem}><Plus className="w-3.5 h-3.5 mr-1" />Tambah</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 p-3 rounded-lg bg-muted/50 border">
                  <div className="col-span-12 sm:col-span-5 space-y-1">
                    <Label className="text-xs">Produk</Label>
                    <Select value={item.product_id ? String(item.product_id) : ''} onValueChange={v => updateItem(idx, 'product_id', v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pilih produk">
                          {(value: string) => products.find(p => String(p.id) === value)?.name ?? 'Pilih produk'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="w-[400px]">
                        {products.length === 0
                          ? <div className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada produk aktif</div>
                          : products.map(p => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              <span className="font-medium">{p.name}</span>
                              <span className="ml-2 text-muted-foreground">{formatRupiah(p.price_default)}</span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3 sm:col-span-2 space-y-1">
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" min={1} value={item.qty} onChange={e => updateItem(idx, 'qty', Number(e.target.value))} />
                  </div>
                  <div className="col-span-5 sm:col-span-2 space-y-1">
                    <Label className="text-xs">Harga</Label>
                    <Input type="number" value={item.price} onChange={e => updateItem(idx, 'price', Number(e.target.value))} />
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-right space-y-1">
                    <Label className="text-xs text-muted-foreground">Subtotal</Label>
                    <p className="font-semibold text-sm h-9 flex items-center justify-end">{formatRupiah(item.price * item.qty)}</p>
                  </div>
                  <div className="col-span-1 flex items-end">
                    {items.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(idx)} className="text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Catatan Internal</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Catatan untuk tim CS / admin (opsional)" />
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Sticky order details + summary */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-4 space-y-4">
            <Card className="border-violet-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Detail Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tanggal</Label>
                    <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Pembayaran</Label>
                    <Select value={paymentMethod} onValueChange={v => v && setPaymentMethod(v)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent className="w-[180px]">
                        {PAYMENT_METHODS.map(pm => <SelectItem key={pm.value} value={pm.value}>{pm.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Campaign</Label>
                  <Select value={campaignId} onValueChange={v => v && setCampaignId(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pilih campaign">
                        {(value: string) => {
                          const c = campaigns.find(c => String(c.id) === value)
                          return c ? <span className="truncate"><span className="text-xs text-violet-400 mr-1">[{c.platform}]</span>{c.campaign_name}</span> : 'Pilih campaign'
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-[320px]">
                      {campaigns.length === 0
                        ? <div className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada campaign aktif</div>
                        : campaigns.map(c => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            <span className="text-xs text-violet-400 mr-1">[{c.platform}]</span>
                            {c.campaign_name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Advertiser</Label>
                  <Select value={advertiserId} onValueChange={v => v && setAdvertiserId(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pilih advertiser">
                        {(value: string) => advUsers.find(u => u.id === value)?.full_name ?? 'Pilih advertiser'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-[280px]">
                      {advUsers.length === 0
                        ? <div className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada advertiser</div>
                        : advUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">CS Handler</Label>
                  <Select value={csId} onValueChange={v => v && setCsId(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pilih CS">
                        {(value: string) => csUsers.find(u => u.id === value)?.full_name ?? 'Pilih CS'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-[280px]">
                      {csUsers.length === 0
                        ? <div className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada CS</div>
                        : csUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card className="border-violet-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4 text-violet-500" />Ringkasan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ongkir</Label>
                    <Input type="number" value={shippingCost} onChange={e => setShippingCost(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Diskon</Label>
                    <Input type="number" value={discount} onChange={e => setDiscount(Number(e.target.value))} />
                  </div>
                </div>

                <Separator />

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatRupiah(subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Ongkir</span><span>{formatRupiah(shippingCost)}</span></div>
                  {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Diskon</span><span className="text-red-500">-{formatRupiah(discount)}</span></div>}
                </div>

                <Separator />

                <div className="flex justify-between items-baseline">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-bold text-emerald-500">{formatRupiah(total)}</span>
                </div>

                <Button type="submit" size="lg" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/25" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Simpan Order
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  )
}
