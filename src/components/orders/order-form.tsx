'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import {
  loadProvinces, loadCities, loadSubdistricts, loadVillages, findWilayahId,
} from '@/lib/wilayah/cascade'
import {
  orderInputSchema,
  PAYMENT_METHOD_VALUES,
  normalizePhoneId,
  type OrderInputFormData,
  type PaymentMethodEnum,
} from '@/lib/schemas/settings'

const supabase = createClient()

interface ChannelLite { id: number; code: string; name: string; active: boolean }
interface ProductLite { id: number; sku: string | null; name: string; price_default: number; active: boolean; has_variants: boolean }
interface VariantLite { id: number; product_id: number; variant_name: string; variation_code: string | null; price: number; hpp: number; weight_grams: number | null; active: boolean }
interface AdvertiserLite { id: string; full_name: string; role: string; active: boolean }

export interface OrderFormDefaults {
  customer_name?: string
  customer_phone?: string
  customer_province?: string
  customer_city?: string
  customer_subdistrict?: string
  customer_village?: string
  customer_zip?: string
  customer_address_detail?: string
  wilayah_id?: number | null
  channel_id?: number | null
  shipping_cost?: number
  discount?: number
  payment_method?: PaymentMethodEnum
  cs_name?: string | null
  cs_id?: string | null
  advertiser_id?: string | null
  notes?: string
  items?: Array<{
    product_id?: number | null
    product_name_raw: string
    variation?: string | null
    qty: number
    price: number
    weight_per_unit?: number | null
  }>
}

interface OrderFormProps {
  defaults?: OrderFormDefaults
  /** Called on submit with validated data. Parent handles insert/update. */
  onSubmit: (data: OrderInputFormData) => Promise<void>
  submitLabel?: string
  submitting?: boolean
}

interface ItemRow {
  product_id: number | null
  // Phase 9: variant_id is primary FK; product_id auto-denormalized via trigger
  variant_id: number | null
  product_name_raw: string
  variation: string
  qty: number
  price: number
  weight_per_unit: number | null
}

const emptyItem = (): ItemRow => ({
  product_id: null,
  variant_id: null,
  product_name_raw: '',
  variation: '',
  qty: 1,
  price: 0,
  weight_per_unit: null,
})

export function OrderForm({ defaults, onSubmit, submitLabel = 'Simpan Order', submitting }: OrderFormProps) {
  const d = defaults || {}

  // Customer
  const [customerName, setCustomerName] = useState(d.customer_name || '')
  const [customerPhone, setCustomerPhone] = useState(d.customer_phone || '')

  // Wilayah cascade
  const [provinces, setProvinces] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [subdistricts, setSubdistricts] = useState<string[]>([])
  const [villages, setVillages] = useState<Array<{ village: string; zip: string; id: number }>>([])

  const [province, setProvince] = useState(d.customer_province || '')
  const [city, setCity] = useState(d.customer_city || '')
  const [subdistrict, setSubdistrict] = useState(d.customer_subdistrict || '')
  const [village, setVillage] = useState(d.customer_village || '')
  const [zip, setZip] = useState(d.customer_zip || '')
  const [wilayahId, setWilayahId] = useState<number | null>(d.wilayah_id || null)
  const [addressDetail, setAddressDetail] = useState(d.customer_address_detail || '')

  // Items
  const [items, setItems] = useState<ItemRow[]>(
    d.items && d.items.length > 0
      ? d.items.map((it) => ({
          product_id: it.product_id || null,
          variant_id: null,
          product_name_raw: it.product_name_raw,
          variation: it.variation || '',
          qty: it.qty,
          price: it.price,
          weight_per_unit: it.weight_per_unit || null,
        }))
      : [emptyItem()]
  )

  // Money
  const [shippingCost, setShippingCost] = useState(d.shipping_cost || 0)
  const [discount, setDiscount] = useState(d.discount || 0)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodEnum>(d.payment_method || 'COD')

  // Channel
  const [channels, setChannels] = useState<ChannelLite[]>([])
  const [channelId, setChannelId] = useState<string>(d.channel_id ? String(d.channel_id) : '')

  // People
  const [csName, setCsName] = useState(d.cs_name || '')
  const [advertisers, setAdvertisers] = useState<AdvertiserLite[]>([])
  const [advertiserId, setAdvertiserId] = useState(d.advertiser_id || '')
  const [notes, setNotes] = useState(d.notes || '')

  // Products + variants lookup (preloaded once)
  const [products, setProducts] = useState<ProductLite[]>([])
  const [variants, setVariants] = useState<VariantLite[]>([])

  // Initial loads
  useEffect(() => {
    const load = async () => {
      try {
        const [provs, { data: chs }, { data: prods }, { data: vars }, { data: advs }] = await Promise.all([
          loadProvinces(supabase),
          supabase.from('courier_channels').select('id, code, name, active').eq('active', true).order('code'),
          supabase.from('products').select('id, sku, name, price_default, active, has_variants').eq('active', true).order('name'),
          supabase.from('product_variants').select('id, product_id, variant_name, variation_code, price, hpp, weight_grams, active').eq('active', true).order('id'),
          supabase.from('profiles').select('id, full_name, role, active').eq('active', true).eq('role', 'advertiser').order('full_name'),
        ])
        setProvinces(provs)
        setChannels((chs || []) as ChannelLite[])
        setVariants((vars || []) as VariantLite[])
        setProducts((prods || []) as ProductLite[])
        setAdvertisers((advs || []) as AdvertiserLite[])
      } catch (err: any) {
        toast.error('Gagal load master data', { description: err.message })
      }
    }
    load()
  }, [])

  // Cascade: load cities when province changes
  useEffect(() => {
    if (!province) { setCities([]); return }
    loadCities(supabase, province).then(setCities).catch(() => setCities([]))
  }, [province])
  useEffect(() => {
    if (!province || !city) { setSubdistricts([]); return }
    loadSubdistricts(supabase, province, city).then(setSubdistricts).catch(() => setSubdistricts([]))
  }, [province, city])
  useEffect(() => {
    if (!province || !city || !subdistrict) { setVillages([]); return }
    loadVillages(supabase, province, city, subdistrict).then(setVillages).catch(() => setVillages([]))
  }, [province, city, subdistrict])

  // Auto-fill zip when village picked
  useEffect(() => {
    if (!village) return
    const v = villages.find((x) => x.village === village)
    if (v) {
      setZip((cur) => cur || v.zip)
      setWilayahId(v.id)
    }
  }, [village, villages])

  // Reset child cascades when parent changes
  const setProvinceWithReset = (v: string) => {
    setProvince(v); setCity(''); setSubdistrict(''); setVillage(''); setWilayahId(null)
  }
  const setCityWithReset = (v: string) => {
    setCity(v); setSubdistrict(''); setVillage(''); setWilayahId(null)
  }
  const setSubdistrictWithReset = (v: string) => {
    setSubdistrict(v); setVillage(''); setWilayahId(null)
  }

  // Items handlers
  const addItem = () => setItems([...items, emptyItem()])
  const removeItem = (idx: number) => {
    if (items.length === 1) {
      toast.error('Minimal 1 item')
      return
    }
    setItems(items.filter((_, i) => i !== idx))
  }
  const updateItem = (idx: number, patch: Partial<ItemRow>) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  const pickProductForItem = (idx: number, productId: string) => {
    if (!productId || productId === 'none') {
      updateItem(idx, { product_id: null, variant_id: null, variation: '' })
      return
    }
    const p = products.find((x) => String(x.id) === productId)
    if (!p) return
    // Auto-pick variant kalau cuma 1 (simple product or variable dengan 1 active variant)
    const productVariants = variants.filter(v => v.product_id === p.id)
    const autoVariant = productVariants.length === 1 ? productVariants[0] : null
    updateItem(idx, {
      product_id: p.id,
      variant_id: autoVariant?.id ?? null,
      product_name_raw: p.name,
      variation: autoVariant ? (autoVariant.variant_name === 'default' ? '' : autoVariant.variant_name) : '',
      price: autoVariant ? Number(autoVariant.price) : (items[idx].price > 0 ? items[idx].price : Number(p.price_default)),
      weight_per_unit: autoVariant?.weight_grams != null ? Number(autoVariant.weight_grams) / 1000 : items[idx].weight_per_unit,
    })
  }

  const pickVariantForItem = (idx: number, variantId: string) => {
    if (!variantId || variantId === 'none') {
      updateItem(idx, { variant_id: null, variation: '' })
      return
    }
    const v = variants.find(x => String(x.id) === variantId)
    if (!v) return
    updateItem(idx, {
      variant_id: v.id,
      variation: v.variant_name === 'default' ? '' : v.variant_name,
      price: Number(v.price),
      weight_per_unit: v.weight_grams != null ? Number(v.weight_grams) / 1000 : items[idx].weight_per_unit,
    })
  }

  const subtotal = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0), 0),
    [items]
  )
  const total = Math.max(0, subtotal + Number(shippingCost || 0) - Number(discount || 0))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Resolve wilayah_id if user filled all 4 cascade levels
    let resolvedWilayahId = wilayahId
    if (!resolvedWilayahId && province && city && subdistrict && village) {
      try {
        resolvedWilayahId = await findWilayahId(supabase, { province, city, subdistrict, village })
      } catch {}
    }

    const payload: OrderInputFormData = {
      customer_name: customerName.trim(),
      customer_phone: normalizePhoneId(customerPhone) || null,
      customer_province: province || null,
      customer_city: city || null,
      customer_subdistrict: subdistrict || null,
      customer_village: village || null,
      customer_zip: zip || null,
      customer_address_detail: addressDetail || null,
      wilayah_id: resolvedWilayahId,
      channel_id: channelId ? Number(channelId) : 0,
      subtotal,
      shipping_cost: Number(shippingCost) || 0,
      discount: Number(discount) || 0,
      total,
      payment_method: paymentMethod,
      cs_name: csName.trim() || null,
      cs_id: null,
      advertiser_id: advertiserId || null,
      notes: notes.trim() || null,
      items: items.map((it) => ({
        product_id: it.product_id,
        variant_id: it.variant_id,
        product_name_raw: it.product_name_raw.trim(),
        variation: it.variation || null,
        qty: Number(it.qty) || 1,
        price: Number(it.price) || 0,
        weight_per_unit: it.weight_per_unit,
        notes: null,
      })),
    }
    const parsed = orderInputSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal')
      return
    }
    if (province && city && subdistrict && village && !resolvedWilayahId) {
      toast.warning('Kombinasi alamat tidak dikenal di master_wilayah, alamat tetap tersimpan')
    }
    await onSubmit(parsed.data)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Customer */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <h3 className="text-sm font-semibold">1. Customer</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nama Customer *</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">No HP</Label>
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                onBlur={(e) => setCustomerPhone(normalizePhoneId(e.target.value))}
                placeholder="08xxxxxxxxxx"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Provinsi</Label>
              <Combobox
                value={province}
                onChange={setProvinceWithReset}
                options={provinces.map((p) => ({ value: p, label: p }))}
                placeholder="Pilih provinsi"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kota / Kabupaten</Label>
              <Combobox
                value={city}
                onChange={setCityWithReset}
                options={cities.map((c) => ({ value: c, label: c }))}
                placeholder={province ? 'Pilih kota' : 'Pilih provinsi dulu'}
                disabled={!province}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Kecamatan</Label>
              <Combobox
                value={subdistrict}
                onChange={setSubdistrictWithReset}
                options={subdistricts.map((s) => ({ value: s, label: s }))}
                placeholder={city ? 'Pilih kecamatan' : 'Pilih kota dulu'}
                disabled={!city}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kelurahan</Label>
              <Combobox
                value={village}
                onChange={setVillage}
                options={villages.map((v) => ({ value: v.village, label: v.village, hint: v.zip }))}
                placeholder={subdistrict ? 'Pilih kelurahan' : 'Pilih kecamatan dulu'}
                disabled={!subdistrict}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Kode Pos</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="Auto-fill dari kelurahan" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Wilayah Match</Label>
              <div className="text-xs text-muted-foreground py-2">
                {wilayahId ? <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Match: id #{wilayahId}</Badge> : <span>—</span>}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Detail Alamat</Label>
            <Textarea
              value={addressDetail}
              onChange={(e) => setAddressDetail(e.target.value)}
              rows={2}
              placeholder="Lingkungan 4 RT 12 Jl Raya..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">2. Items</h3>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="w-3.5 h-3.5 mr-1" />Tambah Item
            </Button>
          </div>
          {items.map((it, idx) => (
            <div key={idx} className="border rounded p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Item #{idx + 1}</div>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(idx)} className="text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Produk (master)</Label>
                  <Select
                    value={it.product_id ? String(it.product_id) : 'none'}
                    onValueChange={(v) => pickProductForItem(idx, v || '')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih produk atau ketik nama">
                        {(value: string | null) =>
                          !value || value === 'none' ? 'Custom (free-text)' : products.find((p) => String(p.id) === value)?.name ?? '—'
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-[300px] max-h-60">
                      <SelectItem value="none">Custom (free-text)</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Phase 9: variant picker — muncul kalau produk dipilih + ada variant >1 */}
                {it.product_id && variants.filter(v => v.product_id === it.product_id && v.variant_name !== 'default').length > 0 ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Variant *</Label>
                    <Select
                      value={it.variant_id ? String(it.variant_id) : 'none'}
                      onValueChange={(v) => pickVariantForItem(idx, v || '')}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih variant">
                          {(value: string | null) =>
                            !value || value === 'none' ? '— pilih variant —' : variants.find(v => String(v.id) === value)?.variant_name ?? '—'
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="w-[300px] max-h-60">
                        <SelectItem value="none">— pilih variant —</SelectItem>
                        {variants.filter(v => v.product_id === it.product_id).map(v => (
                          <SelectItem key={v.id} value={String(v.id)}>
                            {v.variant_name}{v.variation_code ? ` (${v.variation_code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nama Produk *</Label>
                    <Input
                      value={it.product_name_raw}
                      onChange={(e) => updateItem(idx, { product_name_raw: e.target.value })}
                      placeholder="Nama produk"
                      required
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Variation</Label>
                  <Input
                    value={it.variation}
                    onChange={(e) => updateItem(idx, { variation: e.target.value })}
                    placeholder="(optional)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Qty *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={it.qty}
                    onChange={(e) => updateItem(idx, { qty: Number(e.target.value) || 1 })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Price *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={it.price}
                    onChange={(e) => updateItem(idx, { price: Number(e.target.value) || 0 })}
                    required
                  />
                </div>
              </div>
              <div className="text-xs text-muted-foreground text-right">
                Subtotal: Rp {((it.qty || 0) * (it.price || 0)).toLocaleString('id-ID')}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Pricing & Channel */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <h3 className="text-sm font-semibold">3. Pricing & Pengiriman</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Channel Ekspedisi *</Label>
              <Combobox
                value={channelId}
                onChange={setChannelId}
                options={channels.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))}
                placeholder="Pilih channel"
                searchPlaceholder="Cari channel..."
                emptyHint={{
                  message: 'Belum ada channel ekspedisi terdaftar.',
                  actionLabel: 'Tambah di Pengaturan Channels',
                  actionHref: '/settings/courier-channels',
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Method *</Label>
              <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as PaymentMethodEnum)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="w-[200px]">
                  {PAYMENT_METHOD_VALUES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Ongkir</Label>
              <Input
                type="number"
                min={0}
                value={shippingCost}
                onChange={(e) => setShippingCost(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Diskon</Label>
              <Input
                type="number"
                min={0}
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm pt-2 border-t">
            <div>Subtotal: <span className="font-medium">Rp {subtotal.toLocaleString('id-ID')}</span></div>
            <div>Ongkir: <span className="font-medium">Rp {Number(shippingCost || 0).toLocaleString('id-ID')}</span></div>
            <div className="font-bold">Total: Rp {total.toLocaleString('id-ID')}</div>
          </div>
        </CardContent>
      </Card>

      {/* People & Notes */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <h3 className="text-sm font-semibold">4. People & Notes</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">CS Name</Label>
              <Input value={csName} onChange={(e) => setCsName(e.target.value)} placeholder="(auto-fill dari user session)" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Advertiser</Label>
              <Combobox
                value={advertiserId}
                onChange={setAdvertiserId}
                options={advertisers.map((a) => ({ value: a.id, label: a.full_name }))}
                placeholder="Pilih advertiser (opsional)"
                searchPlaceholder="Cari advertiser..."
                emptyHint={{
                  message: 'Belum ada advertiser terdaftar.',
                  actionLabel: 'Tambah di Pengaturan Users',
                  actionHref: '/settings/users',
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 bg-background/80 backdrop-blur py-3 border-t -mx-4 px-4">
        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
