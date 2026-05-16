'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2, Save, ChevronLeft, Warehouse } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  listAttributes,
  createAttribute,
  addAttributeValue,
  saveProduct,
  getProductWithVariants,
} from '@/lib/supabase/queries/variants'
import type {
  ProductAttribute,
  ProductAttributeValue,
  ProductWithVariants,
  Supplier,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const supabase = createClient()

interface VariantLocal {
  key: string                  // sorted attribute_value_ids joined, identity across regen
  variant_name: string
  variation_code: string
  price: number
  hpp: number
  weight_grams: number | null
  active: boolean
  attribute_value_ids: number[]  // ordered same as attributesUsed
  existing_id?: number | null
}

interface Props {
  /** Existing product id untuk edit mode; null/undefined untuk new. */
  productId?: number | null
}

export function ProductVariantForm({ productId }: Props) {
  const router = useRouter()
  const { profile, role, loading: authLoading } = useAuth()
  const orgId = profile?.organization_id ?? null

  const [loading, setLoading] = useState(productId ? true : false)
  const [saving, setSaving] = useState(false)

  // Form fields
  const [name, setName] = useState('')
  const [active, setActive] = useState(true)
  const [hasVariants, setHasVariants] = useState(false)

  // Simple product
  const [simplePrice, setSimplePrice] = useState<number>(0)
  const [simpleHpp, setSimpleHpp] = useState<number>(0)

  // Variable product
  const [allAttributes, setAllAttributes] = useState<ProductAttribute[]>([])
  const [attributesUsed, setAttributesUsed] = useState<ProductAttribute[]>([])  // ordered
  const [variants, setVariants] = useState<VariantLocal[]>([])

  // New attribute dialog
  const [newAttrOpen, setNewAttrOpen] = useState(false)
  const [newAttrName, setNewAttrName] = useState('')
  const [newAttrValues, setNewAttrValues] = useState('')

  // Phase 8A — supplier link (nullable; produk lama bisa belum punya)
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // Loading existing product
  useEffect(() => {
    if (!productId) return
    let cancelled = false
    ;(async () => {
      try {
        const product = await getProductWithVariants(supabase, productId)
        if (cancelled || !product) return
        setName(product.name)
        setActive(product.active)
        setHasVariants(!!product.has_variants)
        setSupplierId(product.supplier_id ?? null)
        if (!product.has_variants) {
          const v = product.variants[0]
          setSimplePrice(Number(v?.price ?? product.price_default ?? 0))
          setSimpleHpp(Number(v?.hpp ?? product.hpp ?? 0))
        } else {
          setAttributesUsed(product.attributes || [])
          const localVariants: VariantLocal[] = product.variants.map(v => {
            const valueIds = (v.attribute_values ?? [])
              .sort((a, b) => a.attribute_id - b.attribute_id)
              .map(av => av.value_id)
            return {
              key: valueIds.join('-'),
              variant_name: v.variant_name,
              variation_code: v.variation_code ?? '',
              price: Number(v.price),
              hpp: Number(v.hpp),
              weight_grams: v.weight_grams ?? null,
              active: v.active,
              attribute_value_ids: valueIds,
              existing_id: v.id,
            }
          })
          setVariants(localVariants)
        }
      } catch (err) {
        toast.error('Gagal load produk', { description: err instanceof Error ? err.message : String(err) })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [productId])

  // Load attributes catalog
  const loadAttributes = useCallback(async () => {
    if (!orgId) return
    try {
      const data = await listAttributes(supabase, orgId)
      setAllAttributes(data)
    } catch (err) {
      toast.error('Gagal load attribute', { description: err instanceof Error ? err.message : String(err) })
    }
  }, [orgId])

  useEffect(() => { loadAttributes() }, [loadAttributes])

  // Phase 8A — load active suppliers untuk dropdown.
  // Kalau supplier yang ke-link di produk udah di-disable, tetap include
  // supaya display-nya nggak hilang (user bisa lihat & ganti).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('suppliers')
          .select('*')
          .order('name')
        if (error) throw error
        if (!cancelled) setSuppliers((data || []) as Supplier[])
      } catch (err) {
        // Tabel suppliers belum ada (migration 011 belum di-apply) — skip silently
        // sehingga form tetap usable. Console only.
        console.warn('Suppliers load skipped:', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const supplierOptions = useMemo(() => {
    return suppliers.filter(s => s.active || s.id === supplierId)
  }, [suppliers, supplierId])

  // ----- Attribute picker -----
  function addExistingAttribute(attrId: number) {
    if (attributesUsed.some(a => a.id === attrId)) return
    const found = allAttributes.find(a => a.id === attrId)
    if (!found) return
    setAttributesUsed(prev => [...prev, found])
    // Regenerate combos
    regenerateCombos([...attributesUsed, found], variants)
  }

  function removeAttribute(attrId: number) {
    const newAttrs = attributesUsed.filter(a => a.id !== attrId)
    setAttributesUsed(newAttrs)
    regenerateCombos(newAttrs, variants)
  }

  async function addValueToAttribute(attribute: ProductAttribute, value: string) {
    if (!value.trim()) return
    if ((attribute.values ?? []).some(v => v.value.toLowerCase() === value.toLowerCase().trim())) {
      toast.error('Nilai sudah ada')
      return
    }
    try {
      const newVal = await addAttributeValue(supabase, attribute.id, value.trim(), (attribute.values?.length ?? 0))
      const updated = allAttributes.map(a => a.id === attribute.id
        ? { ...a, values: [...(a.values ?? []), newVal] }
        : a
      )
      setAllAttributes(updated)
      const usedUpdated = attributesUsed.map(a => a.id === attribute.id
        ? { ...a, values: [...(a.values ?? []), newVal] }
        : a
      )
      setAttributesUsed(usedUpdated)
      regenerateCombos(usedUpdated, variants)
    } catch (err) {
      toast.error('Gagal tambah nilai', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleCreateNewAttribute() {
    const trimmedName = newAttrName.trim()
    const values = newAttrValues
      .split(',').map(s => s.trim()).filter(Boolean)
    if (!trimmedName || values.length === 0) {
      toast.error('Nama atribut + minimal 1 nilai wajib')
      return
    }
    if (!orgId) return
    try {
      const created = await createAttribute(supabase, orgId, trimmedName, values)
      const fresh = await listAttributes(supabase, orgId)
      setAllAttributes(fresh)
      const createdFresh = fresh.find(a => a.id === created.id)
      if (createdFresh) {
        const next = [...attributesUsed, createdFresh]
        setAttributesUsed(next)
        regenerateCombos(next, variants)
      }
      setNewAttrOpen(false)
      setNewAttrName('')
      setNewAttrValues('')
      toast.success(`Atribut "${trimmedName}" dibuat`)
    } catch (err) {
      toast.error('Gagal buat atribut', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  // ----- Combo regeneration -----
  const regenerateCombos = useCallback((attrs: ProductAttribute[], existing: VariantLocal[]) => {
    if (attrs.length === 0 || attrs.some(a => (a.values?.length ?? 0) === 0)) {
      setVariants([])
      return
    }
    // Cartesian product
    const arrays = attrs.map(a => a.values ?? [])
    let combos: ProductAttributeValue[][] = [[]]
    for (const arr of arrays) {
      const next: ProductAttributeValue[][] = []
      for (const c of combos) for (const v of arr) next.push([...c, v])
      combos = next
    }
    // Map old by key for preservation
    const oldByKey = new Map<string, VariantLocal>()
    for (const old of existing) oldByKey.set(old.key, old)

    const newVariants: VariantLocal[] = combos.map(combo => {
      const valueIds = combo.map(v => v.id)
      const key = valueIds.join('-')
      const existing = oldByKey.get(key)
      const variant_name = combo.map(v => v.value).join(' - ')
      if (existing) {
        return { ...existing, key, variant_name, attribute_value_ids: valueIds }
      }
      return {
        key,
        variant_name,
        variation_code: '',
        price: simplePrice || 0,
        hpp: simpleHpp || 0,
        weight_grams: null,
        active: true,
        attribute_value_ids: valueIds,
        existing_id: null,
      }
    })
    setVariants(newVariants)
  }, [simplePrice, simpleHpp])

  // ----- Toggle simple/variable -----
  function toggleHasVariants(next: boolean) {
    setHasVariants(next)
    if (!next) {
      setVariants([])
      setAttributesUsed([])
    }
  }

  // ----- Update single variant field -----
  function updateVariant<K extends keyof VariantLocal>(idx: number, key: K, value: VariantLocal[K]) {
    setVariants(prev => prev.map((v, i) => i === idx ? { ...v, [key]: value } : v))
  }

  // ----- Submit -----
  async function handleSubmit() {
    if (!orgId) return
    if (!name.trim()) { toast.error('Nama produk wajib'); return }
    if (hasVariants && attributesUsed.length === 0) {
      toast.error('Pilih minimal 1 atribut untuk variable product')
      return
    }
    if (hasVariants && variants.length === 0) {
      toast.error('Belum ada variant — pastikan setiap atribut punya minimal 1 nilai')
      return
    }
    if (hasVariants) {
      for (const v of variants) {
        if (v.price <= 0) { toast.error(`Harga variant "${v.variant_name}" harus > 0`); return }
        if (v.hpp < 0) { toast.error(`HPP variant "${v.variant_name}" tidak boleh negatif`); return }
      }
    } else {
      if (simplePrice <= 0) { toast.error('Harga harus > 0'); return }
      if (simpleHpp < 0) { toast.error('HPP tidak boleh negatif'); return }
    }

    setSaving(true)
    try {
      await saveProduct(supabase, {
        id: productId ?? null,
        orgId,
        name,
        active,
        hasVariants,
        supplierId,
        simplePrice,
        simpleHpp,
        attributeIds: attributesUsed.map(a => a.id),
        variants: hasVariants
          ? variants.map(v => ({
              id: v.existing_id ?? null,
              variant_name: v.variant_name,
              variation_code: v.variation_code,
              price: v.price,
              hpp: v.hpp,
              weight_grams: v.weight_grams,
              active: v.active,
              attribute_value_ids: v.attribute_value_ids,
            }))
          : [],
      })
      toast.success(productId ? 'Produk diupdate' : 'Produk dibuat')
      router.push(`/products`)
    } catch (err) {
      toast.error('Gagal simpan', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (role !== 'owner' && role !== 'admin') {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-red-500">
            Hanya owner/admin yang bisa edit produk.
          </CardContent>
        </Card>
      </div>
    )
  }

  const availableAttrs = allAttributes.filter(a => !attributesUsed.some(u => u.id === a.id))

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <Link href="/products" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
          Kembali ke daftar produk
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{productId ? 'Edit Produk' : 'Tambah Produk'}</CardTitle>
          <CardDescription>
            Input nama produk + tentukan tipe (Simple = 1 SKU, Variable = multi-variant dengan atribut).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nama Produk *</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Sepatu Slip-on, Jaring Paranet, dll" />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox checked={active} onCheckedChange={v => setActive(v === true)} id="active" />
            <Label htmlFor="active" className="cursor-pointer">Produk aktif (tampil di pilihan order)</Label>
          </div>

          {/* Phase 8A — Supplier picker (opsional, bisa kosong) */}
          <div className="space-y-1.5">
            <Label htmlFor="supplier" className="flex items-center gap-1.5">
              <Warehouse className="size-3.5" /> Supplier (Gudang Asal)
            </Label>
            <Select
              value={supplierId !== null ? String(supplierId) : 'none'}
              onValueChange={v => setSupplierId(!v || v === 'none' ? null : Number(v))}
            >
              <SelectTrigger id="supplier" className="max-w-md">
                <SelectValue placeholder="Tidak di-link ke supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tidak di-link —</SelectItem>
                {supplierOptions.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.code ? `${s.code} — ${s.name}` : s.name}
                    {!s.active && ' (disabled)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Opsional. Untuk dropship, link produk ke supplier supaya order auto-detect gudang asal.{' '}
              <Link href="/settings/suppliers" className="text-violet-500 hover:underline">
                Kelola supplier →
              </Link>
            </p>
          </div>

          {/* Tipe radio */}
          <div className="space-y-2">
            <Label>Tipe Produk</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={!hasVariants ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleHasVariants(false)}
              >
                Simple (1 SKU)
              </Button>
              <Button
                type="button"
                variant={hasVariants ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleHasVariants(true)}
              >
                Variable (multi-variant)
              </Button>
            </div>
          </div>

          {/* SIMPLE PRODUCT */}
          {!hasVariants && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <Label>Harga jual (Rp)</Label>
                <Input type="number" min={0} value={simplePrice} onChange={e => setSimplePrice(Number(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label>HPP (Rp)</Label>
                <Input type="number" min={0} value={simpleHpp} onChange={e => setSimpleHpp(Number(e.target.value) || 0)} />
              </div>
            </div>
          )}

          {/* VARIABLE PRODUCT */}
          {hasVariants && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Atribut</Label>
                {attributesUsed.map(attr => (
                  <Card key={attr.id} className="border-violet-500/30">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{attr.name}</span>
                        <Button size="sm" variant="ghost" onClick={() => removeAttribute(attr.id)}>
                          <X className="size-3.5" /> Hapus atribut
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(attr.values ?? []).map(v => (
                          <Badge key={v.id} variant="outline" className="text-xs">
                            {v.value}
                          </Badge>
                        ))}
                        <AddValueChip attribute={attr} onAdd={(val) => addValueToAttribute(attr, val)} />
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <div className="flex gap-2">
                  {availableAttrs.length > 0 && (
                    <Select onValueChange={v => v && addExistingAttribute(Number(v))}>
                      <SelectTrigger className="max-w-xs">
                        <SelectValue placeholder="Pilih atribut existing" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableAttrs.map(a => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => setNewAttrOpen(true)}>
                    <Plus className="size-3.5 mr-1" /> Atribut baru
                  </Button>
                </div>
              </div>

              {/* Variant matrix */}
              {variants.length > 0 && (
                <div className="space-y-2">
                  <Label>Variasi Harga ({variants.length} variant)</Label>
                  {variants.map((v, idx) => (
                    <Card key={v.key} className="border-zinc-500/30">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm">{idx + 1}. {v.variant_name}</span>
                          <label className="flex items-center gap-1 text-xs cursor-pointer">
                            <Checkbox checked={v.active} onCheckedChange={ch => updateVariant(idx, 'active', ch === true)} />
                            Aktif
                          </label>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Harga (Rp)</Label>
                            <Input type="number" min={0} value={v.price} onChange={e => updateVariant(idx, 'price', Number(e.target.value) || 0)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">HPP (Rp)</Label>
                            <Input type="number" min={0} value={v.hpp} onChange={e => updateVariant(idx, 'hpp', Number(e.target.value) || 0)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Berat (gr)</Label>
                            <Input type="number" min={0} value={v.weight_grams ?? ''} onChange={e => updateVariant(idx, 'weight_grams', e.target.value === '' ? null : Number(e.target.value))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Variation Code (SKU)</Label>
                            <Input value={v.variation_code} onChange={e => updateVariant(idx, 'variation_code', e.target.value)} placeholder="opsional" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/products">
              <Button variant="outline" disabled={saving}>Batal</Button>
            </Link>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
              {productId ? 'Simpan perubahan' : 'Buat produk'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* New attribute dialog */}
      <Dialog open={newAttrOpen} onOpenChange={setNewAttrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buat atribut baru</DialogTitle>
            <DialogDescription>Misal: Ukuran (36, 37, 38), Warna (Hitam, Putih), dst.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nama Atribut</Label>
              <Input value={newAttrName} onChange={e => setNewAttrName(e.target.value)} placeholder="Ukuran" />
            </div>
            <div className="space-y-1">
              <Label>Nilai (pisah dengan koma)</Label>
              <Input value={newAttrValues} onChange={e => setNewAttrValues(e.target.value)} placeholder="36, 37, 38" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewAttrOpen(false)}>Batal</Button>
            <Button onClick={handleCreateNewAttribute}>Buat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AddValueChip({ attribute, onAdd }: { attribute: ProductAttribute; onAdd: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-violet-500 hover:underline px-2 py-0.5"
      >
        + tambah nilai
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-1">
      <Input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            if (value.trim()) { onAdd(value); setValue(''); setEditing(false) }
          } else if (e.key === 'Escape') {
            setValue(''); setEditing(false)
          }
        }}
        onBlur={() => {
          if (value.trim()) onAdd(value)
          setValue(''); setEditing(false)
        }}
        className="h-6 w-20 text-xs px-1"
        placeholder={`nilai ${attribute.name}`}
      />
    </div>
  )
}
