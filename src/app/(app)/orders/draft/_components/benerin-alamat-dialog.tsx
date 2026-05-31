'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import {
  Loader2, MapPin, Search, Check, AlertTriangle, ArrowRight, SkipForward, Star, Wand2, PartyPopper, Phone, Package, User,
} from 'lucide-react'
import { formatRupiah } from '@/lib/format'

const supabase = createClient()

// ── Tipe ─────────────────────────────────────────────────────────────────
interface QueueItem {
  id: number
  order_number: string
  customer_name: string
  customer_phone: string | null
  customer_address: string | null
  customer_address_detail: string | null
  customer_province: string | null
  customer_city: string | null
  customer_subdistrict: string | null
  customer_zip: string | null
  total: number
  product: string
}
interface WilayahHit { id: number; province: string; city: string; subdistrict: string; zip: string | null; score: number; source?: string }
interface Chosen { wilayah_id: number; province: string; city: string; subdistrict: string; zip: string | null }

interface Filters { status: string; search: string; dateFrom: string; dateTo: string }
interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  filters: Filters
  onDone: () => void
}

// ── Highlight bagian alamat yang cocok (hijau) ──────────────────────────────
function highlightTerms(text: string, terms: (string | null)[]): ReactNode {
  const valid = terms.filter((t): t is string => !!t && t.trim().length >= 3)
  if (!valid.length) return text
  const esc = valid.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${esc.join('|')})`, 'gi')
  return text.split(re).map((part, i) =>
    valid.some(t => t.toLowerCase() === part.toLowerCase())
      ? <mark key={i} className="bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 rounded px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  )
}

// ── Pill per-field ──────────────────────────────────────────────────────────
function FieldPill({ label, value }: { label: string; value: string | null | undefined }) {
  const ok = !!(value && String(value).trim())
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
      ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
         : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
      {ok ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      <span className="font-medium">{label}:</span>
      <span className="max-w-[120px] truncate">{ok ? value : '—'}</span>
    </span>
  )
}

// ── Search wilayah (fallback) — konteks lengkap tiap suggestion ─────────────
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
        setHits((data || []) as WilayahHit[]); setOpen(true)
      } finally { setLoading(false) }
    }, 300)
  }, [q])
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)}
          placeholder="Cari manual: kecamatan / kota / kode pos..." className="pl-8" />
        {loading && <Loader2 className="absolute right-2.5 top-2.5 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
          {hits.map(h => (
            <button key={h.id} type="button"
              onClick={() => { onPick(h); setQ(''); setHits([]); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-500" />
              <span><span className="font-medium">{h.subdistrict}</span>, {h.city}, <span className="text-muted-foreground">{h.province}</span>{h.zip ? ` · ${h.zip}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Brief #7 PART 1 — Mode fokus "Benerin Alamat". Cuma order ⚠️ (wilayah_id
 * NULL), SATU per layar. Konteks order + alamat mentah (highlight match) +
 * pill per-field + chip saran resolver 1-klik (★ = top) + search fallback.
 * Simpan&Lanjut auto-maju ke ⚠️ berikutnya. Enter = Simpan&Lanjut. Progress
 * N/total. Pilih wilayah = isi dari 1 entitas master_wilayah valid → set
 * wilayah_id (sumber tunggal kesiapan).
 */
export function BenerinAlamatDialog({ open, onOpenChange, filters, onDone }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [idx, setIdx] = useState(0)
  const [loadingQueue, setLoadingQueue] = useState(false)
  const [suggestions, setSuggestions] = useState<WilayahHit[]>([])
  const [sugLoading, setSugLoading] = useState(false)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [addrDetail, setAddrDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [fixedCount, setFixedCount] = useState(0)

  const total = queue.length
  const current = queue[idx] || null
  const done = idx >= total // hanya dievaluasi di render saat total > 0

  // Muat antrian ⚠️ (wilayah_id NULL) — se-FILTER, semua draft (bukan 1 halaman)
  const loadQueue = useCallback(async () => {
    setLoadingQueue(true)
    try {
      let qb = supabase.from('orders_draft')
        .select('id, order_number, customer_name, customer_phone, customer_address, customer_address_detail, customer_province, customer_city, customer_subdistrict, customer_zip, total, order_items_draft(product_name_raw, qty)')
        .is('wilayah_id', null)
        .order('created_at', { ascending: true })
      if (filters.status && filters.status !== 'ALL') qb = qb.eq('status', filters.status)
      if (filters.dateFrom) qb = qb.gte('order_date', filters.dateFrom)
      if (filters.dateTo) qb = qb.lte('order_date', filters.dateTo)
      if (filters.search?.trim()) {
        const s = filters.search.trim().replace(/[%,]/g, '')
        qb = qb.or(`order_number.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`)
      }
      const { data, error } = await qb
      if (error) throw error
      const rows: QueueItem[] = (data || []).map((r: Record<string, unknown>) => {
        const items = (r.order_items_draft as { product_name_raw: string; qty: number }[]) || []
        const product = items.length
          ? items.map(it => `${it.product_name_raw} (${it.qty}x)`).join(', ')
          : '—'
        return {
          id: r.id as number,
          order_number: r.order_number as string,
          customer_name: r.customer_name as string,
          customer_phone: r.customer_phone as string | null,
          customer_address: r.customer_address as string | null,
          customer_address_detail: r.customer_address_detail as string | null,
          customer_province: r.customer_province as string | null,
          customer_city: r.customer_city as string | null,
          customer_subdistrict: r.customer_subdistrict as string | null,
          customer_zip: r.customer_zip as string | null,
          total: Number(r.total) || 0,
          product,
        }
      })
      setQueue(rows)
      setIdx(0)
      setFixedCount(0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal memuat antrian', { description: msg })
    } finally {
      setLoadingQueue(false)
    }
  }, [filters])

  useEffect(() => { if (open) loadQueue() }, [open, loadQueue])

  // Reset per-order + ambil saran resolver tiap pindah order
  useEffect(() => {
    if (!open || !current) { setSuggestions([]); setChosen(null); return }
    setChosen(null)
    setAddrDetail(current.customer_address_detail || current.customer_address || '')
    setSugLoading(true)
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase.rpc('suggest_draft_wilayah', { p_draft_id: current.id, p_limit: 6 })
        if (!cancelled) setSuggestions((data || []) as WilayahHit[])
      } finally {
        if (!cancelled) setSugLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, current])

  const applyPick = (h: WilayahHit) => setChosen({
    wilayah_id: h.id, province: h.province, city: h.city, subdistrict: h.subdistrict, zip: h.zip,
  })

  const advance = () => {
    if (idx + 1 >= total) { setIdx(total) } // → layar selesai
    else setIdx(i => i + 1)
  }

  const save = async () => {
    if (!current || !chosen) return
    setSaving(true)
    try {
      const { error } = await supabase.from('orders_draft').update({
        customer_province: chosen.province,
        customer_city: chosen.city,
        customer_subdistrict: chosen.subdistrict,
        customer_zip: chosen.zip || current.customer_zip || null,
        customer_address_detail: addrDetail.trim() || null,
        wilayah_id: chosen.wilayah_id,
      }).eq('id', current.id)
      if (error) throw error
      setFixedCount(c => c + 1)
      advance()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal simpan', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  const skip = () => advance()

  const close = () => {
    onOpenChange(false)
    if (fixedCount > 0) {
      onDone()
      toast.success(`${fixedCount} alamat dibenerin`, { description: 'Antrian Kerja di-refresh.' })
    }
  }

  // Enter = Simpan & Lanjut (kalau ada pilihan)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && chosen && !saving) { e.preventDefault(); save() }
  }

  const provVal = chosen?.province ?? current?.customer_province
  const cityVal = chosen?.city ?? current?.customer_city
  const subVal = chosen?.subdistrict ?? current?.customer_subdistrict
  const zipVal = chosen?.zip ?? current?.customer_zip

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close() }}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-violet-500" />
            Benerin Alamat
            {total > 0 && !done && (
              <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                {Math.min(idx + 1, total)} / {total}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Progress bar */}
        {total > 0 && (
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden -mt-1">
            <div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.min(100, (idx / total) * 100)}%` }} />
          </div>
        )}

        {loadingQueue ? (
          <div className="py-16 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Memuat antrian…
          </div>
        ) : total === 0 ? (
          <div className="py-14 text-center space-y-2">
            <PartyPopper className="w-10 h-10 mx-auto text-emerald-500" />
            <p className="font-medium">Semua alamat udah beres 🎉</p>
            <p className="text-sm text-muted-foreground">Gak ada order ⚠️ di filter sekarang.</p>
            <Button onClick={() => close()} className="mt-2">Tutup</Button>
          </div>
        ) : done ? (
          <div className="py-14 text-center space-y-2">
            <PartyPopper className="w-10 h-10 mx-auto text-emerald-500" />
            <p className="font-medium">Selesai! {fixedCount} alamat dibenerin.</p>
            <p className="text-sm text-muted-foreground">Sisanya yang di-skip masih ⚠️ — bisa diulang kapan aja.</p>
            <Button onClick={() => close()} className="mt-2">Tutup</Button>
          </div>
        ) : current && (
          <div className="space-y-4">
            {/* Konteks order */}
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-violet-500">{current.order_number}</span>
                <span className="inline-flex items-center gap-1 font-medium"><User className="w-3.5 h-3.5 text-muted-foreground" />{current.customer_name}</span>
                {current.customer_phone && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Phone className="w-3 h-3" />{current.customer_phone}</span>}
                <span className="ml-auto tabular-nums font-semibold">{formatRupiah(current.total)}</span>
              </div>
              <div className="inline-flex items-start gap-1 text-xs text-muted-foreground"><Package className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{current.product}</span></div>
            </div>

            {/* Alamat mentah + highlight match */}
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Alamat mentah</p>
              <div className="rounded-md border bg-card p-2.5 text-sm leading-relaxed">
                {highlightTerms(
                  current.customer_address_detail || current.customer_address || '—',
                  [provVal, cityVal, subVal, zipVal],
                )}
              </div>
            </div>

            {/* Pill per-field */}
            <div className="flex flex-wrap gap-1.5">
              <FieldPill label="Provinsi" value={provVal} />
              <FieldPill label="Kota" value={cityVal} />
              <FieldPill label="Kecamatan" value={subVal} />
              <FieldPill label="Kode Pos" value={zipVal} />
            </div>

            {/* Chip saran resolver */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Wand2 className="w-3 h-3" /> Saran wilayah {sugLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              </p>
              {!sugLoading && suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Gak ada saran otomatis — pakai pencarian manual di bawah.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {suggestions.map((h, i) => {
                    const active = chosen?.wilayah_id === h.id
                    return (
                      <button key={h.id} type="button" onClick={() => applyPick(h)}
                        className={`text-left rounded-md border px-2.5 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                          active ? 'border-violet-500 bg-violet-500/10' : 'hover:bg-muted/60'}`}>
                        {i === 0
                          ? <Star className="w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-400" />
                          : <MapPin className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                        <span className="flex-1">
                          <span className="font-medium">{h.subdistrict}</span>, {h.city}, <span className="text-muted-foreground">{h.province}</span>
                          {h.zip ? <span className="text-muted-foreground"> · {h.zip}</span> : ''}
                        </span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{h.source === 'kodepos' ? 'kode pos' : 'nama'}</Badge>
                        {active && <Check className="w-4 h-4 text-violet-500 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Search fallback */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cari manual</p>
              <WilayahPicker onPick={applyPick} />
            </div>

            {/* Alamat detail editable */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Alamat detail (jalan/RT/RW)</p>
              <Input value={addrDetail} onChange={e => setAddrDetail(e.target.value)} placeholder="Jl. ... RT/RW ..." />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 sticky bottom-0 bg-background pb-1">
              <Button variant="ghost" size="sm" onClick={skip} disabled={saving} className="gap-1.5 text-muted-foreground">
                <SkipForward className="w-3.5 h-3.5" /> Lewati
              </Button>
              <span className="text-[11px] text-muted-foreground ml-auto hidden sm:inline">Enter = Simpan &amp; Lanjut</span>
              <Button onClick={save} disabled={saving || !chosen} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                Simpan &amp; Lanjut
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
