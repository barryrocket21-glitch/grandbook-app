'use client'
import type { SelectHTMLAttributes } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { jakartaDateString } from '@/lib/date/jakarta'
import { formatRupiah } from '@/lib/format'
import type { InboxCreateOrder } from '@/lib/schemas/inbox-resi-request'

export interface References {
  profiles: { id: number; code: string; name: string }[]
  channels: { id: number; code: string; name: string }[]
  products: { id: number; name: string; price_default: number; has_variants: boolean }[]
  variants: { id: number; product_id: number; variant_name: string; price: number }[]
  cs: { id: string; full_name: string }[]
}
export type CreateForm = Omit<InboxCreateOrder, 'paymentMethod'> & { paymentMethod: InboxCreateOrder['paymentMethod'] | '' }
export function sourceText(raw: Record<string, unknown>, ...keys: string[]) {
  return keys.map(key => raw[key]).find((value): value is string => typeof value === 'string' && !!value.trim())?.trim() ?? ''
}
export function initialCreateForm(raw: Record<string, unknown>): CreateForm {
  return {
    customerName: sourceText(raw, 'customer_name', 'receiver_name', 'recipient_name', 'Nama Penerima'),
    phone: sourceText(raw, 'customer_phone', 'recipient_phone', 'receiver_phone'),
    address: sourceText(raw, 'customer_address_detail', 'recipient_detail_address', 'customer_address'),
    externalRef: sourceText(raw, 'external_order_id', 'ref', 'Customer Reference No.'),
    attributionCode: sourceText(raw, 'attribution_code_raw'), orderDate: jakartaDateString(),
    channelId: 0, csId: null, paymentMethod: '', shippingCost: 0,
    items: [{ productId: 0, variantId: null, qty: 1, price: 0 }],
  }
}
export function Choice(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${props.className ?? ''}`} />
}

export function CreateOrderFields({ value, onChange, refs }: { value: CreateForm; onChange: (value: CreateForm) => void; refs: References }) {
  const change = <K extends keyof CreateForm>(key: K, next: CreateForm[K]) => onChange({ ...value, [key]: next })
  const itemChange = (index: number, next: Partial<CreateForm['items'][number]>) => change('items', value.items.map((item, i) => i === index ? { ...item, ...next } : item))
  const total = value.items.reduce((sum, item) => sum + item.qty * item.price, 0) + value.shippingCost
  return <div className="space-y-4 border-t pt-4">
    <p className="text-sm text-muted-foreground">Lengkapi data sesuai sumber. Order beserta item masuk Antrian dengan status Baru. Status kiriman dan pencairan diperiksa melalui rekonsil setelahnya.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="inbox-name">Nama penerima *</Label><Input id="inbox-name" value={value.customerName} maxLength={1000} onChange={e => change('customerName', e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="inbox-phone">Telepon</Label><Input id="inbox-phone" value={value.phone} maxLength={100} onChange={e => change('phone', e.target.value)} /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="inbox-address">Alamat lengkap *</Label><Textarea id="inbox-address" value={value.address} maxLength={10000} onChange={e => change('address', e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="inbox-ref">Referensi order asal</Label><Input id="inbox-ref" value={value.externalRef} maxLength={200} onChange={e => change('externalRef', e.target.value)} placeholder="Jika tersedia di sumber" /></div>
      <div className="space-y-1"><Label htmlFor="inbox-date">Tanggal order *</Label><Input type="date" id="inbox-date" value={value.orderDate} onChange={e => change('orderDate', e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="inbox-channel">Ekspedisi *</Label><Choice id="inbox-channel" value={value.channelId || ''} onChange={e => change('channelId', Number(e.target.value))}><option value="">Pilih ekspedisi</option>{refs.channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Choice></div>
      <div className="space-y-1"><Label htmlFor="inbox-payment">Pembayaran *</Label><Choice id="inbox-payment" value={value.paymentMethod} onChange={e => change('paymentMethod', e.target.value as CreateForm['paymentMethod'])}><option value="">Pilih pembayaran</option><option value="COD">COD</option><option value="TRANSFER">Transfer</option></Choice></div>
      <div className="space-y-1"><Label htmlFor="inbox-cs">CS</Label><Choice id="inbox-cs" value={value.csId ?? ''} onChange={e => change('csId', e.target.value || null)}><option value="">Belum diketahui</option>{refs.cs.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}</Choice></div>
      <div className="space-y-1"><Label htmlFor="inbox-attribution">Kode atribusi</Label><Input id="inbox-attribution" value={value.attributionCode} maxLength={1000} onChange={e => change('attributionCode', e.target.value)} placeholder="Kosongkan jika tidak ada bukti sumber" /></div>
    </div>
    {value.items.map((item, index) => {
      const product = refs.products.find(p => p.id === item.productId)
      const variants = refs.variants.filter(v => v.product_id === item.productId)
      return <div key={index} className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between"><span className="text-sm font-medium">Item {index + 1}</span>{value.items.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => change('items', value.items.filter((_, i) => i !== index))}>Hapus item {index + 1}</Button>}</div>
        <Label htmlFor={`inbox-product-${index}`}>Produk *</Label>
        <Choice id={`inbox-product-${index}`} value={item.productId || ''} onChange={e => {
          const next = refs.products.find(p => p.id === Number(e.target.value))
          itemChange(index, { productId: next?.id ?? 0, variantId: null, price: Number(next?.price_default ?? 0) })
        }}><option value="">Pilih produk</option>{refs.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Choice>
        {(product?.has_variants || variants.length > 0) && <div className="space-y-1"><Label htmlFor={`inbox-variant-${index}`}>Varian{product?.has_variants ? ' *' : ''}</Label><Choice id={`inbox-variant-${index}`} value={item.variantId ?? ''} onChange={e => {
          const next = variants.find(v => v.id === Number(e.target.value))
          itemChange(index, { variantId: next?.id ?? null, price: Number(next?.price ?? product?.price_default ?? 0) })
        }}><option value="">{product?.has_variants ? 'Pilih varian' : 'Varian standar'}</option>{variants.map(v => <option key={v.id} value={v.id}>{v.variant_name}</option>)}</Choice></div>}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label htmlFor={`inbox-qty-${index}`}>Jumlah *</Label><Input id={`inbox-qty-${index}`} type="number" min={1} max={100000} step={1} value={item.qty} onChange={e => itemChange(index, { qty: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label htmlFor={`inbox-price-${index}`}>Harga satuan (Rp) *</Label><Input id={`inbox-price-${index}`} type="number" min={0} max={999999999} value={item.price} onChange={e => itemChange(index, { price: Number(e.target.value) })} /></div>
        </div>
      </div>
    })}
    <Button type="button" variant="outline" disabled={value.items.length >= 20} onClick={() => change('items', [...value.items, { productId: 0, variantId: null, qty: 1, price: 0 }])}>Tambah item</Button>
    <div className="space-y-1"><Label htmlFor="inbox-shipping">Ongkir yang ditagihkan (Rp)</Label><Input id="inbox-shipping" type="number" min={0} max={999999999} value={value.shippingCost} onChange={e => change('shippingCost', Number(e.target.value))} /></div>
    <p className="font-medium">Total order: {formatRupiah(total)}</p>
  </div>
}
