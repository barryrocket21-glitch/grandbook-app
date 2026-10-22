'use client'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Loader2, MapPin, Search, Check, AlertTriangle, ArrowRight, SkipForward, Star, Wand2, PartyPopper, Phone, Package, User,
} from 'lucide-react'
import { formatRupiah } from '@/lib/format'


// ── Tipe ─────────────────────────────────────────────────────────────────
interface QueueItem {
  id: number
  order_number: string
  updated_at: string
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
interface Chosen { draft_id: number; wilayah_id: number; province: string; city: string; subdistrict: string; zip: string | null }

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
  const listId = useId()
  const [activeIndex, setActiveIndex] = useState(0)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<WilayahHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setHits([])
    setOpen(false)
    setError('')
    setLoading(false)
    setActiveIndex(0)
    if (q.trim().length < 2) return
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/orders/address-review/autocomplete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, limit: 8 }), signal: controller.signal,
        })
        if (!response.ok) throw new Error('Pencarian wilayah gagal. Coba lagi.')
        const data = await response.json()
        if (controller.signal.aborted) return
        setHits(data || []); setOpen(true)
      } catch (error) {
        if (!controller.signal.aborted) setError(getErrorMessage(error))
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q])

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open, listId])
  const pick = (hit: WilayahHit) => {
    onPick(hit); setQ(''); setHits([]); setOpen(false)
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)}
          role="combobox" aria-label="Cari wilayah" aria-autocomplete="list" aria-expanded={open && hits.length > 0}
          aria-controls={listId} aria-activedescendant={open && hits[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) { e.stopPropagation(); return }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault(); e.stopPropagation(); setOpen(true)
              setActiveIndex(i => Math.max(0, Math.min(hits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
            } else if (e.key === 'Enter' && (q.trim() || open || loading)) {
              e.preventDefault(); e.stopPropagation()
              if (!e.repeat && !loading && open && hits[activeIndex]) pick(hits[activeIndex])
            } else if (e.key === 'Escape' && open) {
              e.preventDefault(); e.stopPropagation(); setOpen(false)
            }
          }}
          placeholder="Cari manual: kecamatan / kota / kode pos..." className="pl-8" />
        {loading && <Loader2 className="absolute right-2.5 top-2.5 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      {error && <p role="alert" className="text-xs text-destructive mt-1">{error}</p>}
      {open && !loading && hits.length === 0 && <p className="text-xs text-muted-foreground mt-1">Wilayah belum ditemukan. Coba nama kecamatan, kota, atau kode pos.</p>}
      {open && hits.length > 0 && (
        <div id={listId} role="listbox" aria-label="Hasil pencarian wilayah" className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
          {hits.map((h, index) => (
            <button key={h.id} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={activeIndex === index}
              onMouseEnter={() => setActiveIndex(index)} onClick={() => pick(h)}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 flex items-start gap-1.5 ${activeIndex === index ? 'bg-muted/60' : ''}`}>
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
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
  const dialogRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)
  const focusSave = useRef(false)
  const suggestionRequests = useRef(new Map<string, { promise: Promise<WilayahHit[]>; controller: AbortController; ready: boolean }>())
  const [includeComplete, setIncludeComplete] = useState(false)
  const [queueError, setQueueError] = useState('')
  const queueRequest = useRef(0)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [idx, setIdx] = useState(0)
  const [loadingQueue, setLoadingQueue] = useState(false)
  const [suggestions, setSuggestions] = useState<WilayahHit[]>([])
  const [sugLoading, setSugLoading] = useState(false)
  const manualPick = useRef(false)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [autoPicked, setAutoPicked] = useState(false)  // ★ dominan ke-pilih otomatis
  const [addrDetail, setAddrDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [fixedCount, setFixedCount] = useState(0)

  const total = queue.length
  const current = queue[idx] || null
  const done = idx >= total // hanya dievaluasi di render saat total > 0

  useEffect(() => () => {
    for (const request of suggestionRequests.current.values()) request.controller.abort()
    suggestionRequests.current.clear()
  }, [open, includeComplete])

  const getSuggestions = useCallback((draft: QueueItem) => {
    const key = `${draft.id}:${draft.updated_at}`
    const cached = suggestionRequests.current.get(key)
    if (cached) return cached.promise
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const entry = { controller, ready: false, promise: Promise.resolve([] as WilayahHit[]) }
    entry.promise = fetch('/api/orders/address-review/suggestions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: draft.id, limit: 6 }), signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Saran wilayah gagal dimuat. Coba pencarian manual atau buka ulang antrean.')
      const hits = await response.json() as WilayahHit[]
      entry.ready = true
      return hits
    }).catch(error => {
      if (suggestionRequests.current.get(key) === entry) suggestionRequests.current.delete(key)
      throw error
    })
      .finally(() => clearTimeout(timer))
    suggestionRequests.current.set(key, entry)
    return entry.promise
  }, [])

  // Muat antrian ⚠️ (wilayah_id NULL) — se-FILTER, semua draft (bukan 1 halaman)
  const loadQueue = useCallback(async () => {
    const requestId = ++queueRequest.current
    setLoadingQueue(true)
    setQueueError('')
    setQueue([])
    try {
      const response = await fetch('/api/orders/address-review/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...filters, includeComplete }),
      })
      if (!response.ok) throw new Error('Antrean alamat gagal dimuat. Coba buka kembali.')
      const rows = await response.json() as QueueItem[]
      if (requestId !== queueRequest.current) return
      setQueue(rows)
      setIdx(0)
      setFixedCount(0)
    } catch (err) {
      const msg = getErrorMessage(err)
      if (requestId === queueRequest.current) setQueueError(msg)
      toast.error('Gagal memuat antrian', { description: msg })
    } finally {
      if (requestId === queueRequest.current) setLoadingQueue(false)
    }
  }, [filters, includeComplete])

  // Muat antrian SEKALI saat dialog dibuka. JANGAN re-run pas loadQueue identity
  // berubah (parent re-render dari polling 30s) — itu yang bikin progress reset
  // ke order 1 tiap 30 detik. filters di-snapshot saat buka (modal, user gak
  // ubah filter di bawahnya).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) loadQueue(); return () => { queueRequest.current++ } }, [open, includeComplete])

  // Reset per-order + ambil saran resolver HANYA pas order BENERAN ganti (key by
  // id, BUKAN object ref). Kalau parent re-render & queue ke-rebuild dengan objek
  // baru utk order yang SAMA, ini gak re-fire → pilihan user (chosen) + input
  // search gak ke-reset sendiri. Itu akar "refresh sendiri" pas ngetik/milih.
  const currentId = current?.id ?? null
  useEffect(() => {
    if (!open || currentId == null) { setSuggestions([]); setChosen(null); setAutoPicked(false); return }
    manualPick.current = false
    setChosen(null)
    setSuggestions([])
    setAutoPicked(false)
    setAddrDetail(current?.customer_address_detail || current?.customer_address || '')
    setSugLoading(true)
    let cancelled = false
    ;(async () => {
      try {
        const hits = await getSuggestions(current!)
        if (cancelled) return
        setSuggestions(hits)
        // PRE-SELECT ★ HANYA kalau dominan: skor top tinggi (≥90 = ter-korroborasi)
        // DAN jauh di atas kandidat kedua (gap ≥15). Ambigu (mis. Kapuas Hulu vs
        // Kapuas, skornya mepet) → JANGAN pre-select → admin milih sadar.
        const top = hits[0]
        const dominant = !!top && top.source !== 'fuzzy' && top.score >= 90 && (hits.length === 1 || top.score - (hits[1]?.score ?? 0) >= 15)
        if (dominant && !manualPick.current) {
          const focused = document.activeElement
          focusSave.current = focused === dialogRef.current || focused === saveRef.current || focused === document.body
          setChosen({ draft_id: currentId, wilayah_id: top.id, province: top.province, city: top.city, subdistrict: top.subdistrict, zip: top.zip })
          setAutoPicked(true)
        }
        // Warm only the next draft version; server still guards updated_at on save.
        if (queue[idx + 1]) void getSuggestions(queue[idx + 1]).catch(() => {})
      } catch (error) {
        if (!cancelled) toast.error('Saran wilayah gagal dimuat', { description: getErrorMessage(error) })
      } finally {
        if (!cancelled) setSugLoading(false)
      }
    })()
    return () => {
      cancelled = true
      const key = `${currentId}:${current?.updated_at}`
      const request = suggestionRequests.current.get(key)
      if (request && !request.ready) { request.controller.abort(); suggestionRequests.current.delete(key) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentId])

  useEffect(() => {
    if (chosen && chosen.draft_id === currentId && focusSave.current && !saving) {
      focusSave.current = false
      saveRef.current?.focus({ preventScroll: true })
    }
  }, [chosen, currentId, saving])

  const applyPick = (h: WilayahHit) => {
    if (currentId == null || savingRef.current) return
    manualPick.current = true
    focusSave.current = true
    setChosen({ draft_id: currentId, wilayah_id: h.id, province: h.province, city: h.city, subdistrict: h.subdistrict, zip: h.zip })
    setAutoPicked(false)  // pilihan manual menggantikan auto-select
  }

  const advance = () => {
    if (idx + 1 >= total) { setIdx(total) } // → layar selesai
    else setIdx(i => i + 1)
  }

  const save = async () => {
    if (!current || !chosen || chosen.draft_id !== current.id || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const response = await fetch('/api/orders/address-review/save', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: current.id, expectedUpdatedAt: current.updated_at, wilayahId: chosen.wilayah_id, province: chosen.province, city: chosen.city, subdistrict: chosen.subdistrict, zip: chosen.zip || current.customer_zip || '', detail: addrDetail.trim() }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Gagal simpan alamat')
      }
      setFixedCount(c => c + 1)
      advance()
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal simpan', { description: msg })
    } finally {
      savingRef.current = false
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
    if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing || !(e.target instanceof HTMLElement)) return
    if (e.target.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return
    if (e.repeat || savingRef.current) { e.preventDefault(); return }
    if (e.target.closest('button') && !e.ctrlKey && !e.metaKey) return
    if (chosen?.draft_id === currentId) { e.preventDefault(); void save() }
  }

  const provVal = chosen?.province ?? current?.customer_province
  const cityVal = chosen?.city ?? current?.customer_city
  const subVal = chosen?.subdistrict ?? current?.customer_subdistrict
  const zipVal = chosen?.zip ?? current?.customer_zip

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close() }}>
      <DialogContent ref={dialogRef} initialFocus={dialogRef} className="sm:max-w-2xl max-h-[92vh] overflow-y-auto" onKeyDown={onKeyDown}>
        <DialogHeader>
          {/* pr-8 → judul gak ketabrak tombol X di pojok kanan */}
          <DialogTitle className="flex items-center gap-2 pr-8">
            <Wand2 className="w-4 h-4 text-zinc-500 shrink-0" />
            Benerin Alamat
          </DialogTitle>
        </DialogHeader>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeComplete} disabled={saving || loadingQueue}
            onChange={e => { if (fixedCount > 0) onDone(); setIncludeComplete(e.target.checked) }} />
          Tampilkan juga alamat terisi untuk diedit
        </label>
        <p className="text-xs text-muted-foreground">Maksimal 200 order sesuai filter. Gunakan pencarian di Antrian Kerja untuk memilih order tertentu.</p>
        {/* Progress — counter punya baris sendiri (gak nabrak X) + bar tipis */}
        {total > 0 && !done && (
          <div className="space-y-1 -mt-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Order ⚠️ yang lagi dibenerin</span>
              <span className="tabular-nums font-medium text-foreground">{Math.min(idx + 1, total)} / {total}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-zinc-500 transition-all" style={{ width: `${Math.min(100, (idx / total) * 100)}%` }} />
            </div>
          </div>
        )}

        {loadingQueue ? (
          <div className="py-16 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Memuat antrian…
          </div>
        ) : queueError ? (
          <p role="alert" className="py-8 text-sm text-destructive">{queueError}</p>
        ) : total === 0 ? (
          <div className="py-14 text-center space-y-2">
            <PartyPopper className="w-10 h-10 mx-auto text-emerald-500" />
            <p className="font-medium">Tidak ada alamat dalam antrean ini</p>
            <p className="text-sm text-muted-foreground">Tidak ada order yang cocok dengan filter pemeriksaan sekarang.</p>
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
                <span className="font-mono text-xs text-zinc-500">{current.order_number}</span>
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
                  current.customer_address || current.customer_address_detail || '—',
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
              {autoPicked && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> ★ teratas dipilih otomatis (yakin) — tekan <kbd className="px-1 rounded bg-muted text-[10px]">Enter</kbd> buat konfirmasi, atau ganti di bawah.
                </p>
              )}
              {!sugLoading && suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Gak ada saran otomatis — pakai pencarian manual di bawah.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {suggestions.map((h, i) => {
                    const active = chosen?.wilayah_id === h.id
                    return (
                      <button key={h.id} type="button" onClick={() => applyPick(h)}
                        className={`text-left rounded-md border px-2.5 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                          active ? 'border-zinc-500 bg-zinc-500/10' : 'hover:bg-muted/60'}`}>
                        {i === 0
                          ? <Star className="w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-400" />
                          : <MapPin className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                        <span className="flex-1">
                          <span className="font-medium">{h.subdistrict}</span>, {h.city}, <span className="text-muted-foreground">{h.province}</span>
                          {h.zip ? <span className="text-muted-foreground"> · {h.zip}</span> : ''}
                        </span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{h.source === 'kodepos' ? 'kode pos' : 'nama'}</Badge>
                        {active && <Check className="w-4 h-4 text-zinc-500 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Search fallback */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cari manual</p>
              <WilayahPicker key={current.id} onPick={applyPick} />
            </div>

            {/* Alamat detail editable — SIMPAN patokan/landmark, jangan dihapus */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Alamat detail (jalan/RT/RW + patokan)
              </p>
              <textarea
                value={addrDetail}
                onChange={e => setAddrDetail(e.target.value)}
                rows={2}
                placeholder="Jl. ... RT/RW ... (+ patokan, mis. 'depan warung Bu Siti')"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
              <p className="text-[10px] text-muted-foreground">Enter untuk baris baru; Ctrl/⌘ + Enter untuk simpan dan lanjut. Detail dan patokan tetap disimpan.</p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 sticky bottom-0 bg-background pb-1">
              <Button variant="ghost" size="sm" onClick={skip} disabled={saving} className="gap-1.5 text-muted-foreground">
                <SkipForward className="w-3.5 h-3.5" /> Lewati
              </Button>
              <span className="text-[11px] text-muted-foreground ml-auto hidden sm:inline">Enter = Simpan &amp; Lanjut</span>
              <Button ref={saveRef} onClick={save} disabled={saving || !chosen || chosen.draft_id !== currentId} className="gap-1.5 bg-zinc-600 hover:bg-zinc-700">
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
