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
import { Plus, Trash2, Save, Loader2, User, Package, Calculator, ShoppingCart } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/constants'
import type { Product, Campaign, Profile } from '@/lib/types'

export default function NewOrderPage() {
  const { profile } = useAuth()
  const supabase = createClient()
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
  const [items, setItems] = useState([{ product_id: 0, qty: 1, price: 0, name: '', hpp: 0 }])

  useEffect(() => {
    const fetch = async () => {
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
    fetch()
  }, [])

  // Auto-save draft
  useEffect(() => {
    const t = setInterval(() => {
      localStorage.setItem('order_draft', JSON.stringify({
        orderDate, customerName, customerPhone, customerCity, customerProvince,
        customerAddress, paymentMethod, campaignId, advertiserId, csId,
        shippingCost, discount, notes, items,
      }))
    }, 10000)
    return () => clearInterval(t)
  })

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
  const total = subtotal + shippingCost - discount

  const addItem = () => setItems([...items, { product_id: 0, qty: 1, price: 0, name: '', hpp: 0 }])
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerName.trim()) return toast.error('Nama customer wajib diisi')
    if (items.some(i => !i.product_id)) return toast.error('Pilih produk untuk semua item')
    setSaving(true)
    try {
      const { data: orderNum } = await supabase.rpc('generate_order_number')
      const orderNumber = orderNum || `ORD-${orderDate.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`
      const { data: order, error } = await supabase.from('orders').insert({
        order_number: orderNumber, order_date: orderDate, customer_name: customerName,
        customer_phone: customerPhone, customer_city: customerCity, customer_province: customerProvince,
        customer_address: customerAddress, subtotal, shipping_cost: shippingCost, discount, total,
        payment_method: paymentMethod, status: 'BARU',
        campaign_id: campaignId ? Number(campaignId) : null,
        advertiser_id: advertiserId || null, cs_id: csId || null, admin_id: profile?.id, notes,
      }).select().single()
      if (error) throw error
      await supabase.from('order_items').insert(items.map(i => ({
        order_id: order.id, product_id: i.product_id, qty: i.qty, price: i.price, hpp_snapshot: i.hpp,
      })))
      localStorage.removeItem('order_draft')
      toast.success('Order berhasil!', { description: orderNumber })
      setCustomerName(''); setCustomerPhone(''); setCustomerCity(''); setCustomerProvince('')
      setCustomerAddress(''); setNotes(''); setShippingCost(0); setDiscount(0)
      setItems([{ product_id: 0, qty: 1, price: 0, name: '', hpp: 0 }])
    } catch (err: any) { toast.error('Gagal', { description: err.message }) }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Input Order Baru</h1>
        <p className="text-muted-foreground mt-1">Isi form berikut untuk membuat order baru</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4 text-violet-500" />Informasi Customer</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Tanggal Order</Label><Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} /></div>
              <div className="space-y-2"><Label>Metode Pembayaran</Label><Select value={paymentMethod} onValueChange={v => v && setPaymentMethod(v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_METHODS.map(pm => <SelectItem key={pm.value} value={pm.value}>{pm.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Nama Customer *</Label><Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nama lengkap" required autoFocus /></div>
              <div className="space-y-2"><Label>No. WA / HP</Label><Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="08xxx" /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Kota</Label><Input value={customerCity} onChange={e => setCustomerCity(e.target.value)} /></div>
              <div className="space-y-2"><Label>Provinsi</Label><Input value={customerProvince} onChange={e => setCustomerProvince(e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Alamat Lengkap</Label><Textarea value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} rows={2} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4 text-violet-500" />Produk ({items.length} item)</CardTitle><Button type="button" variant="outline" size="sm" onClick={addItem}><Plus className="w-3.5 h-3.5 mr-1" />Tambah</Button></div></CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row items-start sm:items-end gap-3 p-3 rounded-lg bg-muted/50 border">
                <div className="flex-1 w-full space-y-1"><Label className="text-xs">Produk</Label><Select value={item.product_id ? String(item.product_id) : ''} onValueChange={v => updateItem(idx, 'product_id', v)}><SelectTrigger><SelectValue placeholder="Pilih produk" /></SelectTrigger><SelectContent>{products.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} - {formatRupiah(p.price_default)}</SelectItem>)}</SelectContent></Select></div>
                <div className="w-full sm:w-24 space-y-1"><Label className="text-xs">Qty</Label><Input type="number" min={1} value={item.qty} onChange={e => updateItem(idx, 'qty', Number(e.target.value))} /></div>
                <div className="w-full sm:w-36 space-y-1"><Label className="text-xs">Harga</Label><Input type="number" value={item.price} onChange={e => updateItem(idx, 'price', Number(e.target.value))} /></div>
                <div className="w-28 text-right"><p className="text-xs text-muted-foreground">Subtotal</p><p className="font-semibold text-sm">{formatRupiah(item.price * item.qty)}</p></div>
                {items.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(idx)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-violet-500" />Sumber & Assignment</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Campaign</Label><Select value={campaignId} onValueChange={v => v && setCampaignId(v)}><SelectTrigger><SelectValue placeholder="Pilih campaign" /></SelectTrigger><SelectContent>{campaigns.map(c => <SelectItem key={c.id} value={String(c.id)}>[{c.platform}] {c.campaign_name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Advertiser</Label><Select value={advertiserId} onValueChange={v => v && setAdvertiserId(v)}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{advUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>CS Handler</Label><Select value={csId} onValueChange={v => v && setCsId(v)}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{csUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent></Select></div>
          </CardContent>
        </Card>

        <Card className="border-violet-500/20">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4 text-violet-500" />Ringkasan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Catatan</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Ongkir</Label><Input type="number" value={shippingCost} onChange={e => setShippingCost(Number(e.target.value))} /></div>
              <div className="space-y-2"><Label>Diskon</Label><Input type="number" value={discount} onChange={e => setDiscount(Number(e.target.value))} /></div>
            </div>
            <Separator />
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatRupiah(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Ongkir</span><span>{formatRupiah(shippingCost)}</span></div>
              {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Diskon</span><span className="text-red-500">-{formatRupiah(discount)}</span></div>}
            </div>
            <Separator />
            <div className="flex justify-between text-lg font-bold"><span>Total</span><span className="text-emerald-500">{formatRupiah(total)}</span></div>
            <Button type="submit" size="lg" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/25" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Simpan Order
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
