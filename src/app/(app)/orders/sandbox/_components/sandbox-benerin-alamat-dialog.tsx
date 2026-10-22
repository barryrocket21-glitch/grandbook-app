'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, Check, Loader2, MapPin, Package, Phone, Search, SkipForward, Star, User, Wand2 } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { updateSandboxOrderAddress, type SandboxOrder } from '@/lib/sandbox-orders'

const supabase = createClient()

interface WilayahHit {
  id: number
  province: string
  city: string
  subdistrict: string
  zip: string | null
  score?: number
  match_score?: number
  source?: string
}

interface Chosen {
  wilayahId: number
  province: string
  city: string
  subdistrict: string
  zip: string | null
}

interface Props {
  open: boolean
  rows: SandboxOrder[]
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

function highlightTerms(text: string, terms: (string | null | undefined)[]): ReactNode {
  const valid = terms.filter((t): t is string => !!t && t.trim().length >= 3)
  if (!valid.length) return text
  const escaped = valid.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text.split(re).map((part, i) =>
    valid.some((t) => t.toLowerCase() === part.toLowerCase())
      ? <mark key={i} className="bg-emerald-500/25 text-emerald-700 rounded px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  )
}

function FieldPill({ label, value }: { label: string; value: string | null | undefined }) {
  const ok = !!value?.trim()
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700' : 'border-amber-500/40 bg-amber-500/10 text-amber-700'}`}>
      <Check className="w-3 h-3" />
      <span className="font-medium">{label}:</span>
      <span className="max-w-[140px] truncate">{ok ? value : '-'}</span>
    </span>
  )
}

function normalizeHit(hit: WilayahHit): Chosen {
  return { wilayahId: hit.id, province: hit.province, city: hit.city, subdistrict: hit.subdistrict, zip: hit.zip ?? null }
}

function WilayahPicker({ onPick }: { onPick: (hit: WilayahHit) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WilayahHit[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.trim().length < 2) { setHits([]); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await supabase.rpc('wilayah_autocomplete', { p_query: query.trim(), p_limit: 8 })
        setHits((data || []) as WilayahHit[])
      } finally {
        setLoading(false)
      }
    }, 250)
  }, [query])

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari manual: kecamatan / kota / kode pos..." className="pl-8" />
      {loading && <Loader2 className="absolute right-2.5 top-2.5 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      {hits.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
          {hits.map((hit) => (
            <button key={hit.id} type="button" onClick={() => { onPick(hit); setQuery(''); setHits([]) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
              <span><span className="font-medium">{hit.subdistrict}</span>, {hit.city}, <span className="text-muted-foreground">{hit.province}</span>{hit.zip ? ` · ${hit.zip}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SandboxBenerinAlamatDialog({ open, rows, onOpenChange, onDone }: Props) {
  const queue = rows.filter((row) => !row.wilayahId)
  const [idx, setIdx] = useState(0)
  const [suggestions, setSuggestions] = useState<WilayahHit[]>([])
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [addrDetail, setAddrDetail] = useState('')
  const [loading, setLoading] = useState(false)
  const [fixedCount, setFixedCount] = useState(0)
  const current = queue[idx] ?? null

  useEffect(() => {
    if (!open) return
    setIdx(0)
    setFixedCount(0)
  }, [open])

  useEffect(() => {
    if (!open || !current) { setSuggestions([]); setChosen(null); return }
    setChosen(null)
    setAddrDetail(current.customerAddress || '')
    setLoading(true)
    let cancelled = false
    ;(async () => {
      try {
        const query = [current.subdistrict, current.city, current.province, current.customerAddress].filter(Boolean).join(' ')
        const { data } = await supabase.rpc('wilayah_autocomplete', { p_query: query || current.customerAddress || '', p_limit: 6 })
        if (cancelled) return
        const hits = (data || []) as WilayahHit[]
        setSuggestions(hits)
        if (hits[0]) setChosen(normalizeHit(hits[0]))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, current])

  const advance = () => setIdx((value) => value + 1)
  const close = () => {
    onOpenChange(false)
    if (fixedCount > 0) onDone()
  }

  const save = () => {
    if (!current || !chosen) return
    updateSandboxOrderAddress(current.id, {
      province: chosen.province,
      city: chosen.city,
      subdistrict: chosen.subdistrict,
      zip: chosen.zip,
      wilayahId: chosen.wilayahId,
      customerAddress: addrDetail.trim() || current.customerAddress,
    })
    setFixedCount((count) => count + 1)
    advance()
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); else onOpenChange(true) }}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto" onKeyDown={(e) => { if (e.key === 'Enter' && chosen) { e.preventDefault(); save() } }}>
        <DialogHeader><DialogTitle className="flex items-center gap-2 pr-8"><Wand2 className="w-4 h-4 text-zinc-500" />Benerin Alamat</DialogTitle></DialogHeader>
        {queue.length === 0 || !current ? (
          <div className="py-14 text-center space-y-2"><p className="font-medium">Semua alamat udah beres</p><Button onClick={close}>Tutup</Button></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1 -mt-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Order yang lagi dibenerin</span><span className="font-medium text-foreground">{Math.min(idx + 1, queue.length)} / {queue.length}</span></div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-zinc-500" style={{ width: `${Math.min(100, (idx / queue.length) * 100)}%` }} /></div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-mono text-xs text-zinc-500">{current.orderNumber}</span><span className="inline-flex items-center gap-1 font-medium"><User className="w-3.5 h-3.5" />{current.customerName}</span>{current.customerPhone && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Phone className="w-3 h-3" />{current.customerPhone}</span>}<span className="ml-auto tabular-nums font-semibold">{formatRupiah(Number(current.codAmount || 0))}</span></div>
              <div className="inline-flex items-start gap-1 text-xs text-muted-foreground"><Package className="w-3.5 h-3.5 mt-0.5" /><span>{current.productName} ({current.qty}x)</span></div>
            </div>
            <div className="space-y-1"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Alamat mentah</p><div className="rounded-md border bg-card p-2.5 text-sm leading-relaxed">{highlightTerms(current.customerAddress || '-', [chosen?.province, chosen?.city, chosen?.subdistrict, chosen?.zip])}</div></div>
            <div className="flex flex-wrap gap-1.5"><FieldPill label="Provinsi" value={chosen?.province ?? current.province} /><FieldPill label="Kota" value={chosen?.city ?? current.city} /><FieldPill label="Kecamatan" value={chosen?.subdistrict ?? current.subdistrict} /><FieldPill label="Kode Pos" value={chosen?.zip ?? current.zip} /></div>
            <div className="space-y-1.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Wand2 className="w-3 h-3" />Saran wilayah {loading && <Loader2 className="w-3 h-3 animate-spin" />}</p><div className="flex flex-col gap-1.5">{suggestions.map((hit, i) => { const active = chosen?.wilayahId === hit.id; return <button key={hit.id} type="button" onClick={() => setChosen(normalizeHit(hit))} className={`text-left rounded-md border px-2.5 py-1.5 text-sm flex items-center gap-2 ${active ? 'border-zinc-500 bg-zinc-500/10' : 'hover:bg-muted/60'}`}>{i === 0 ? <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> : <MapPin className="w-3.5 h-3.5 text-muted-foreground" />}<span className="flex-1"><span className="font-medium">{hit.subdistrict}</span>, {hit.city}, <span className="text-muted-foreground">{hit.province}</span>{hit.zip ? <span className="text-muted-foreground"> · {hit.zip}</span> : ''}</span><Badge variant="outline" className="text-[10px]">nama</Badge>{active && <Check className="w-4 h-4 text-zinc-500" />}</button> })}</div>{!loading && suggestions.length === 0 && <p className="text-xs text-muted-foreground italic">Gak ada saran otomatis, pakai pencarian manual.</p>}</div>
            <div className="space-y-1.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cari manual</p><WilayahPicker onPick={(hit) => setChosen(normalizeHit(hit))} /></div>
            <div className="space-y-1.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Alamat detail (jalan/RT/RW + patokan)</p><textarea value={addrDetail} onChange={(e) => setAddrDetail(e.target.value)} rows={2} className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500" /><p className="text-[10px] text-muted-foreground">Detail mentah + patokan disimpan apa adanya buat driver.</p></div>
            <div className="flex items-center gap-2 pt-1 sticky bottom-0 bg-background pb-1"><Button variant="ghost" size="sm" onClick={advance} className="gap-1.5 text-muted-foreground"><SkipForward className="w-3.5 h-3.5" />Lewati</Button><span className="text-[11px] text-muted-foreground ml-auto hidden sm:inline">Enter = Simpan & Lanjut</span><Button onClick={save} disabled={!chosen} className="gap-1.5 bg-zinc-600 hover:bg-zinc-700"><ArrowRight className="w-3.5 h-3.5" />Simpan & Lanjut</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
