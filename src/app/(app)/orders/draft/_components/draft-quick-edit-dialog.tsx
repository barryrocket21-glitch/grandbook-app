'use client'
import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Pencil, MapPin, Search } from 'lucide-react'
import type { OrderDraftEnriched } from '@/lib/types'

const supabase = createClient()

interface WilayahHit { id: number; province: string; city: string; subdistrict: string; zip: string | null; score: number }

/**
 * Brief #5 — autocomplete wilayah toleran-typo. Tiap suggestion nampilin
 * konteks LENGKAP (Kecamatan, Kota, Provinsi) biar gak salah pilih antar daerah
 * mirip. Pilih → isi province/city/subdistrict/zip dari SATU entitas wilayah
 * yang valid (bukan tebak field terpisah).
 */
function WilayahPicker({ onPick }: { onPick: (h: WilayahHit) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<WilayahHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current)
    if (q.trim().length < 2) { setHits([]); return }
    tRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await supabase.rpc('wilayah_autocomplete', { p_query: q, p_limit: 8 })
        setHits((data || []) as WilayahHit[])
        setOpen(true)
      } finally { setLoading(false) }
    }, 300)
  }, [q])

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)}
          placeholder="Ketik kecamatan/kota (mis. cakung, jaktim)..." className="pl-8" />
        {loading && <Loader2 className="absolute right-2.5 top-2.5 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
          {hits.map(h => (
            <button key={h.id} type="button"
              onClick={() => { onPick(h); setQ(`${h.subdistrict}, ${h.city}`); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
              <span><span className="font-medium">{h.subdistrict}</span>, {h.city}, <span className="text-muted-foreground">{h.province}</span>{h.zip ? ` · ${h.zip}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  draft: OrderDraftEnriched | null
  onSaved: () => void
}

/**
 * Quick Edit dialog untuk draft order. Cover field yang paling sering perlu
 * di-fix setelah paste WA (typo nama / qty / alamat / total).
 *
 * Field deep-edit (channel, supplier, dst) tetap via /orders/[id]?draft=1.
 */
export function DraftQuickEditDialog({ open, onOpenChange, draft, onSaved }: Props) {
  const [form, setForm] = useState({
    customer_name: '',
    customer_phone: '',
    customer_subdistrict: '',
    customer_city: '',
    customer_province: '',
    customer_zip: '',
    customer_address_detail: '',
    total: 0,
    shipping_cost: 0,
    customer_note: '',
    internal_note: '',
  })
  const [saving, setSaving] = useState(false)
  // Item is a separate row in order_items_draft. Load + edit qty + name.
  const [item, setItem] = useState<{ id: number; product_name_raw: string; qty: number } | null>(null)

  // Load primary item when dialog opens
  useEffect(() => {
    if (!open || !draft) {
      setItem(null)
      return
    }
    setForm({
      customer_name: draft.customer_name || '',
      customer_phone: draft.customer_phone || '',
      customer_subdistrict: '',
      customer_city: draft.customer_city || '',
      customer_province: draft.customer_province || '',
      customer_zip: '',
      customer_address_detail: '',
      total: Number(draft.total) || 0,
      shipping_cost: 0,
      customer_note: draft.customer_note || '',
      internal_note: draft.internal_note || '',
    })
    ;(async () => {
      // Fetch full draft row + first item
      const [{ data: full }, { data: items }] = await Promise.all([
        supabase.from('orders_draft').select('customer_subdistrict, customer_zip, customer_address_detail, shipping_cost, internal_note').eq('id', draft.id).single(),
        supabase.from('order_items_draft').select('id, product_name_raw, qty').eq('order_id', draft.id).order('id').limit(1),
      ])
      if (full) {
        setForm(prev => ({
          ...prev,
          customer_subdistrict: (full as { customer_subdistrict: string | null }).customer_subdistrict || '',
          customer_zip: (full as { customer_zip: string | null }).customer_zip || '',
          customer_address_detail: (full as { customer_address_detail: string | null }).customer_address_detail || '',
          shipping_cost: Number((full as { shipping_cost: number | null }).shipping_cost) || 0,
          internal_note: (full as { internal_note: string | null }).internal_note || '',
        }))
      }
      if (items && items.length > 0) {
        const it = items[0] as { id: number; product_name_raw: string; qty: number }
        setItem({ id: it.id, product_name_raw: it.product_name_raw, qty: Number(it.qty) || 1 })
      }
    })()
  }, [open, draft])

  const submit = async () => {
    if (!draft) return
    setSaving(true)
    try {
      // Update orders_draft
      const { error: draftErr } = await supabase
        .from('orders_draft')
        .update({
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim() || null,
          customer_subdistrict: form.customer_subdistrict.trim() || null,
          customer_city: form.customer_city.trim() || null,
          customer_province: form.customer_province.trim() || null,
          customer_zip: form.customer_zip.trim() || null,
          customer_address_detail: form.customer_address_detail.trim() || null,
          total: form.total,
          shipping_cost: form.shipping_cost,
          customer_note: form.customer_note.trim() || null,
          internal_note: form.internal_note.trim() || null,
        })
        .eq('id', draft.id)
      if (draftErr) throw draftErr

      // Update primary item if exists
      if (item) {
        const { error: itemErr } = await supabase
          .from('order_items_draft')
          .update({
            product_name_raw: item.product_name_raw.trim(),
            qty: item.qty,
          })
          .eq('id', item.id)
        if (itemErr) throw itemErr
      }

      toast.success('Draft ter-update', { description: `Order ${draft.order_number} disimpan.` })
      onOpenChange(false)
      onSaved()
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal simpan', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  if (!draft) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-zinc-500" />
            Edit Draft — <span className="font-mono text-sm">{draft.order_number}</span>
          </DialogTitle>
          <DialogDescription>
            Quick-fix kesalahan minor sebelum cetak resi. Edit detail (channel, supplier, advertiser) di halaman detail order.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2 text-sm">
          {/* Customer */}
          <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">Customer</div>
          <div className="space-y-1">
            <Label htmlFor="customer_name" className="text-xs">Nama *</Label>
            <Input id="customer_name" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="customer_phone" className="text-xs">No HP</Label>
            <Input id="customer_phone" value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="customer_address_detail" className="text-xs">Alamat Lengkap</Label>
            <Textarea id="customer_address_detail" value={form.customer_address_detail} onChange={e => setForm({ ...form, customer_address_detail: e.target.value })} rows={2} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs flex items-center gap-1"><MapPin className="w-3 h-3" /> Cari Wilayah (auto-isi provinsi/kota/kecamatan)</Label>
            <WilayahPicker onPick={(h) => setForm(prev => ({
              ...prev,
              customer_province: h.province,
              customer_city: h.city,
              customer_subdistrict: h.subdistrict,
              customer_zip: h.zip || prev.customer_zip,
            }))} />
            <p className="text-[10px] text-muted-foreground">Pilih dari sini biar provinsi/kota/kecamatan konsisten (1 entitas wilayah valid). Bisa juga edit manual di bawah.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="customer_subdistrict" className="text-xs">Kecamatan</Label>
            <Input id="customer_subdistrict" value={form.customer_subdistrict} onChange={e => setForm({ ...form, customer_subdistrict: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="customer_city" className="text-xs">Kota/Kab</Label>
            <Input id="customer_city" value={form.customer_city} onChange={e => setForm({ ...form, customer_city: e.target.value })} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="customer_province" className="text-xs">Provinsi</Label>
            <Input id="customer_province" value={form.customer_province} onChange={e => setForm({ ...form, customer_province: e.target.value })} />
          </div>

          {/* Produk + qty */}
          {item && (
            <>
              <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1 pt-2">Produk</div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="product_name" className="text-xs">Nama produk</Label>
                <Input id="product_name" value={item.product_name_raw} onChange={e => setItem({ ...item, product_name_raw: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="qty" className="text-xs">Qty</Label>
                <Input id="qty" type="number" min="1" value={item.qty} onChange={e => setItem({ ...item, qty: Math.max(1, parseInt(e.target.value) || 1) })} />
              </div>
            </>
          )}

          {/* Financial */}
          <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1 pt-2">Pembayaran</div>
          <div className="space-y-1">
            <Label htmlFor="total" className="text-xs">Total (Rp)</Label>
            <Input id="total" type="number" value={form.total} onChange={e => setForm({ ...form, total: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shipping_cost" className="text-xs">Ongkir (Rp)</Label>
            <Input id="shipping_cost" type="number" value={form.shipping_cost} onChange={e => setForm({ ...form, shipping_cost: parseFloat(e.target.value) || 0 })} />
          </div>

          {/* Notes */}
          <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1 pt-2">Catatan</div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="customer_note" className="text-xs">Catatan customer (warna, ukuran, dll)</Label>
            <Input id="customer_note" value={form.customer_note} onChange={e => setForm({ ...form, customer_note: e.target.value })} placeholder="e.g. Hitam 42" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="internal_note" className="text-xs">Catatan internal (CS / Admin)</Label>
            <Textarea id="internal_note" value={form.internal_note} onChange={e => setForm({ ...form, internal_note: e.target.value })} rows={2} placeholder="Catatan untuk tim, tidak ter-print ke ekspedisi" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={submit} disabled={saving || !form.customer_name.trim()} className="gap-2">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
