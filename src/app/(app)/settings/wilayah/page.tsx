'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { MapPin, Search, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'

const supabase = createClient()
const PAGE_SIZE = 50

interface Wilayah {
  id: number
  province: string
  city: string
  subdistrict: string
  village: string
  zip: string
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\bprovinsi\b/g, ' ').replace(/\s+/g, ' ').trim()
}

export default function WilayahPage() {
  const [provinces, setProvinces] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [subdistricts, setSubdistricts] = useState<string[]>([])

  const [provinceFilter, setProvinceFilter] = useState('ALL')
  const [cityFilter, setCityFilter] = useState('ALL')
  const [subdistrictFilter, setSubdistrictFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [rows, setRows] = useState<Wilayah[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  // Load provinces once
  useEffect(() => {
    const loadProvinces = async () => {
      // Distinct provinces — pakai server-side aggregation via direct query.
      // Workaround: ambil dari sample baris (provinces ~38, jadi cukup ambil sample).
      const { data } = await supabase
        .from('master_wilayah')
        .select('province')
        .order('province')
      const unique = Array.from(new Set((data || []).map((r: any) => r.province))).sort()
      setProvinces(unique)
    }
    loadProvinces()
  }, [])

  // Load cities saat province dipilih
  useEffect(() => {
    if (provinceFilter === 'ALL') { setCities([]); setCityFilter('ALL'); return }
    const load = async () => {
      const { data } = await supabase
        .from('master_wilayah')
        .select('city')
        .eq('province', provinceFilter)
      const unique = Array.from(new Set((data || []).map((r: any) => r.city))).sort()
      setCities(unique)
      setCityFilter('ALL')
    }
    load()
  }, [provinceFilter])

  // Load subdistricts saat city dipilih
  useEffect(() => {
    if (cityFilter === 'ALL') { setSubdistricts([]); setSubdistrictFilter('ALL'); return }
    const load = async () => {
      const { data } = await supabase
        .from('master_wilayah')
        .select('subdistrict')
        .eq('province', provinceFilter)
        .eq('city', cityFilter)
      const unique = Array.from(new Set((data || []).map((r: any) => r.subdistrict))).sort()
      setSubdistricts(unique)
      setSubdistrictFilter('ALL')
    }
    load()
  }, [cityFilter, provinceFilter])

  // Load rows (paginated)
  const loadRows = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('master_wilayah').select('*', { count: 'exact' })
    if (provinceFilter !== 'ALL') q = q.eq('province', provinceFilter)
    if (cityFilter !== 'ALL') q = q.eq('city', cityFilter)
    if (subdistrictFilter !== 'ALL') q = q.eq('subdistrict', subdistrictFilter)
    if (debouncedSearch) {
      const norm = normalize(debouncedSearch)
      // OR across normalized fields + zip (zip raw match prefix)
      q = q.or(`village_normalized.ilike.%${norm}%,subdistrict_normalized.ilike.%${norm}%,zip.ilike.${debouncedSearch}%`)
    }
    q = q.order('province').order('city').order('subdistrict').order('village')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    const { data, count } = await q
    setRows((data || []) as Wilayah[])
    setTotalCount(count || 0)
    setLoading(false)
  }, [provinceFilter, cityFilter, subdistrictFilter, debouncedSearch, page])

  useEffect(() => { loadRows() }, [loadRows])

  const reset = () => {
    setProvinceFilter('ALL'); setCityFilter('ALL'); setSubdistrictFilter('ALL')
    setSearch(''); setPage(0)
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MapPin}
        title="Master Wilayah"
        description={`${totalCount.toLocaleString('id-ID')} dari 82.539 baris kode pos Indonesia`}
      />

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Provinsi</label>
              <Select value={provinceFilter} onValueChange={v => { if (v) { setProvinceFilter(v); setPage(0) } }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="w-[280px] max-h-[400px]">
                  <SelectItem value="ALL">Semua provinsi</SelectItem>
                  {provinces.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Kota / Kabupaten</label>
              <Select value={cityFilter} onValueChange={v => { if (v) { setCityFilter(v); setPage(0) } }} disabled={provinceFilter === 'ALL'}>
                <SelectTrigger><SelectValue placeholder={provinceFilter === 'ALL' ? 'Pilih provinsi dulu' : 'Pilih kota'} /></SelectTrigger>
                <SelectContent className="w-[280px] max-h-[400px]">
                  <SelectItem value="ALL">Semua kota</SelectItem>
                  {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Kecamatan</label>
              <Select value={subdistrictFilter} onValueChange={v => { if (v) { setSubdistrictFilter(v); setPage(0) } }} disabled={cityFilter === 'ALL'}>
                <SelectTrigger><SelectValue placeholder={cityFilter === 'ALL' ? 'Pilih kota dulu' : 'Pilih kecamatan'} /></SelectTrigger>
                <SelectContent className="w-[280px] max-h-[400px]">
                  <SelectItem value="ALL">Semua kecamatan</SelectItem>
                  {subdistricts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Cari</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kelurahan / kode pos" className="pl-9" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="w-3.5 h-3.5 mr-1.5" />Reset filter</Button>
            <p className="text-xs text-muted-foreground ml-auto">Hal {page + 1} dari {Math.max(1, totalPages)} • {totalCount.toLocaleString('id-ID')} hasil</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provinsi</TableHead>
                <TableHead>Kota / Kabupaten</TableHead>
                <TableHead>Kecamatan</TableHead>
                <TableHead>Kelurahan</TableHead>
                <TableHead>Kode Pos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={5}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState icon={MapPin} title="Tidak ada hasil" description="Coba ubah filter atau kata kunci pencarian." />
                  </TableCell>
                </TableRow>
              ) : rows.map(w => (
                <TableRow key={w.id}>
                  <TableCell className="text-sm">{w.province}</TableCell>
                  <TableCell className="text-sm">{w.city}</TableCell>
                  <TableCell className="text-sm">{w.subdistrict}</TableCell>
                  <TableCell className="text-sm font-medium">{w.village}</TableCell>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{w.zip}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Menampilkan {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} dari {totalCount.toLocaleString('id-ID')}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" />Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              Next<ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-3 pb-3 text-xs text-muted-foreground">
          ℹ️ Master wilayah dikelola via script <code className="px-1 py-0.5 rounded bg-muted font-mono">npm run import:wilayah</code>. Hubungi developer untuk update.
        </CardContent>
      </Card>
    </div>
  )
}
