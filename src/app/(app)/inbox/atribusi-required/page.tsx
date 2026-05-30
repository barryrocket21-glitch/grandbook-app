'use client'
// =============================================================
// Brief #3 — /inbox/atribusi-required : antrian order yg CS / Advertiser kosong.
// Soft gate: komisi (CS) ditahan PENDING kalau cs_id kosong; advertiser di-surface
// buat analitik + batch assign. Export ekspedisi TIDAK ke-block (prinsip kunci).
// Role: owner, admin. Bulk-assign CS / ADV ke order terpilih.
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox } from '@/components/ui/combobox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserCog, ShieldAlert, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { formatRupiah, formatDate } from '@/lib/format'
import type { AttributionRequiredRow } from '@/lib/types'

const supabase = createClient()
const PAGE_SIZE = 100

type MissingFilter = 'any' | 'cs' | 'adv'
interface PersonLite { id: string; full_name: string }

export default function AtribusiRequiredPage() {
  const { role } = useAuth()
  const allowed = role === 'owner' || role === 'admin'

  const [missing, setMissing] = useState<MissingFilter>('any')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<AttributionRequiredRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [csList, setCsList] = useState<PersonLite[]>([])
  const [advList, setAdvList] = useState<PersonLite[]>([])
  const [assignCs, setAssignCs] = useState('')
  const [assignAdv, setAssignAdv] = useState('')
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('list_attribution_required', {
        p_from: null, p_to: null, p_missing: missing, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
      })
      if (error) throw error
      const rs = (data || []) as AttributionRequiredRow[]
      setRows(rs)
      setTotal(rs[0]?.total_count ? Number(rs[0].total_count) : 0)
    } catch {
      setRows([]); setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [missing, page])

  useEffect(() => { if (allowed) load() }, [load, allowed])
  useEffect(() => { setPage(0); setSelected(new Set()) }, [missing])

  useEffect(() => {
    if (!allowed) return
    supabase.from('profiles').select('id, full_name, role').in('role', ['cs', 'advertiser']).eq('active', true)
      .then(({ data }) => {
        const ppl = (data || []) as Array<PersonLite & { role: string }>
        setCsList(ppl.filter(p => p.role === 'cs'))
        setAdvList(ppl.filter(p => p.role === 'advertiser'))
      })
  }, [allowed])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const allOnPage = rows.length > 0 && rows.every(r => selected.has(r.id))
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    if (allOnPage) rows.forEach(r => next.delete(r.id))
    else rows.forEach(r => next.add(r.id))
    return next
  })
  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const applyAssign = async () => {
    if (selected.size === 0) { toast.error('Pilih order dulu'); return }
    if (!assignCs && !assignAdv) { toast.error('Pilih CS atau Advertiser untuk di-assign'); return }
    setApplying(true)
    try {
      const ids = Array.from(selected)
      const patch: Record<string, string> = {}
      if (assignCs) {
        patch.cs_id = assignCs
        patch.cs_name = csList.find(c => c.id === assignCs)?.full_name ?? ''
      }
      if (assignAdv) patch.advertiser_id = assignAdv
      // Chunk 200 biar trigger recompute komisi (per order) gak nabrak timeout.
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { error } = await supabase.from('orders').update(patch).in('id', chunk)
        if (error) throw error
      }
      toast.success(`${ids.length} order di-assign`)
      setSelected(new Set()); setAssignCs(''); setAssignAdv('')
      await load()
    } catch (err) {
      toast.error('Gagal assign', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setApplying(false)
    }
  }

  const selectedTotal = useMemo(
    () => rows.filter(r => selected.has(r.id)).reduce((s, r) => s + Number(r.total || 0), 0),
    [rows, selected]
  )

  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader icon={UserCog} title="Atribusi Required" />
        <EmptyState icon={ShieldAlert} title="Akses Dibatasi" description="Hanya owner & admin." />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={UserCog} title="Atribusi Required"
        description="Order yang CS / Advertiser-nya belum diisi. Isi atribusi → komisi CS auto cair + analitik per-advertiser akurat. Pengiriman & export tidak terpengaruh." />

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          {/* Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={missing} onValueChange={(v) => v && setMissing(v as MissingFilter)}>
              <SelectTrigger className="w-52">
                <SelectValue>
                  {(v: string | null) => v === 'cs' ? 'CS belum diisi' : v === 'adv' ? 'Advertiser belum diisi' : 'CS atau Advertiser kosong'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">CS atau Advertiser kosong</SelectItem>
                <SelectItem value="cs">CS belum diisi (tahan komisi)</SelectItem>
                <SelectItem value="adv">Advertiser belum diisi</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{total} order</span>
          </div>

          {/* Bulk assign toolbar */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-end gap-2 p-2.5 rounded-md border bg-violet-500/5">
              <div className="text-xs font-medium">{selected.size} dipilih · {formatRupiah(selectedTotal)}</div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Assign CS</label>
                <Combobox value={assignCs} onChange={setAssignCs}
                  options={csList.map(c => ({ value: c.id, label: c.full_name }))}
                  placeholder="(tetap)" searchPlaceholder="Cari CS..." />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Assign Advertiser</label>
                <Combobox value={assignAdv} onChange={setAssignAdv}
                  options={advList.map(a => ({ value: a.id, label: a.full_name }))}
                  placeholder="(tetap)" searchPlaceholder="Cari advertiser..." />
              </div>
              <Button size="sm" onClick={applyAssign} disabled={applying}>
                {applying && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Apply
              </Button>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Checkbox checked={allOnPage} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Order#</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>CS</TableHead>
                  <TableHead className="text-center">Atribusi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Memuat...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8"><EmptyState icon={UserCog} title="Bersih" description="Semua order sudah punya atribusi sesuai filter." /></TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id} className={selected.has(r.id) ? 'bg-violet-500/5' : ''}>
                    <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                    <TableCell className="text-xs">{r.order_date ? formatDate(r.order_date) : '—'}</TableCell>
                    <TableCell className="text-xs font-mono">
                      <Link href={`/orders/${r.id}`} className="hover:underline">{r.order_number}</Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.customer_name || '—'}</TableCell>
                    <TableCell className="text-right text-sm">{formatRupiah(r.total)}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline" className={STATUS_BADGE_COLOR[r.status] || ''}>{STATUS_LABEL[r.status] || r.status}</Badge></TableCell>
                    <TableCell className="text-xs">{r.cs_name || <span className="text-red-500">—</span>}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {r.missing_cs && <Badge variant="outline" className="text-[10px] bg-red-500/15 text-red-700 dark:text-red-400">CS?</Badge>}
                        {r.missing_adv && <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400">ADV?</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{total} order</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <span>Hal {page + 1} / {totalPages}</span>
              <Button variant="outline" size="icon" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
