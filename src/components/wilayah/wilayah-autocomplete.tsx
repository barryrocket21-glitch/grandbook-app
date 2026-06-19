'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, MapPin, X } from 'lucide-react'
import type { WilayahCandidate } from '@/lib/types'

const supabase = createClient()
const DEBOUNCE_MS = 300
const MIN_QUERY = 3

interface Props {
  /** Initial query text (e.g. existing subdistrict name) */
  initialQuery?: string
  /** Called saat user pilih salah satu hasil */
  onSelect: (wilayah: WilayahCandidate) => void
  placeholder?: string
}

/**
 * Phase 8F — Autocomplete pencarian wilayah dari master_wilayah.
 * Debounce 300ms, query >= 3 char trigger RPC search_wilayah_fuzzy.
 * Display: subdistrict, city, province, zip + score badge.
 * Pilih → callback `onSelect` dengan full WilayahCandidate.
 */
export function WilayahAutocomplete({ initialQuery = '', onSelect, placeholder = 'Ketik nama kecamatan / desa...' }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<WilayahCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.trim().length < MIN_QUERY) {
      setResults([])
      setOpen(false)
      return
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.rpc('search_wilayah_fuzzy', {
          p_query: query.trim(),
          p_limit: 15,
        })
        if (error) throw error
        setResults((data || []) as WilayahCandidate[])
        setOpen(true)
      } catch (err) {
        console.warn('search_wilayah_fuzzy error:', err)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query])

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="pl-9 pr-9"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {!loading && query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); setOpen(false) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
            aria-label="Clear"
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto bg-popover border rounded-md shadow-lg">
          {results.map(r => (
            <li
              key={r.id}
              onMouseDown={() => {
                onSelect(r)
                setQuery(`${r.subdistrict}, ${r.city}`)
                setOpen(false)
              }}
              className="px-3 py-2 text-xs cursor-pointer hover:bg-muted/60 border-b last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{r.subdistrict} <span className="text-muted-foreground">/ {r.village}</span></p>
                  <p className="text-[10px] text-muted-foreground truncate">{r.city} · {r.province} · <span className="font-mono">{r.zip}</span></p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 ${
                    r.match_score >= 95 ? 'bg-emerald-500/15 text-emerald-600' :
                    r.match_score >= 75 ? 'bg-zinc-500/15 text-zinc-600' :
                    'bg-zinc-500/15 text-muted-foreground'
                  }`}
                >
                  {r.match_score}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && results.length === 0 && !loading && query.trim().length >= MIN_QUERY && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg p-3 text-xs text-muted-foreground italic">
          Tidak ada hasil. Coba kata kunci lain (nama kecamatan biasanya lebih akurat).
        </div>
      )}
    </div>
  )
}
