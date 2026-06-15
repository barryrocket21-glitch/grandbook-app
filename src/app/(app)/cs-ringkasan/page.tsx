'use client'
// =============================================================
// Ringkasan CS — 1 halaman: liat SEMUA CS langsung (gak perlu pilih),
// klik CS → breakdown per produk. Toggle Per CS / Per Produk.
// Gabungan Dashboard CS + Performa CS. Input laporan -> /cs-report.
// =============================================================
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/page-header'
import { MessageCircle, Loader2, RefreshCw, Pencil, ChevronRight, ChevronDown } from 'lucide-react'
import { formatNumber } from '@/lib/format'

const supabase = createClient()
const isoToday = () => { const d = new Date(); return d.toISOString().slice(0, 10) }
const isoOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const num = (v: unknown) => Number(v) || 0

interface CsRow { user_id: string; full_name: string; leads_reported: number; closing_reported: number; retur_rate: number; retur_count: number; total_orders: number; top_product_name: string | null }
interface ProdRow { product_id: number; name: string; leads: number; closing: number }
interface DimRow { cs_id: string; cs_name: string; product_id: number; product_name: string; platform: string; orders: number; delivered: number; retur: number }
interface MCell { o: number; d: number; r: number }
const csCell = (c: MCell | undefined, m: 'order' | 'deliv' | 'retur') => {
  const dot = <span className="text-muted-foreground/30">·</span>
  if (!c || c.o === 0) return dot
  if (m === 'order') return <span>{c.o}</span>
  if (m === 'deliv') { const v = c.o > 0 ? (c.d / c.o) * 100 : 0; return <span className={v >= 50 ? 'text-emerald-600 font-medium' : v >= 20 ? 'text-amber-600' : 'text-muted-foreground'}>{v.toFixed(0)}%</span> }
  const d = c.d + c.r; if (d === 0) return dot; const v = (c.r / d) * 100; return <span className={v >= 20 ? 'text-rose-600 font-semibold' : v >= 10 ? 'text-amber-600' : ''}>{v.toFixed(0)}%</span>
}

export default function CsRingkasanPage() {
  const { role, loading: authLoading } = useAuth()
  const canView = role === 'owner' || role === 'admin' || role === 'cs'
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preset, setPreset] = useState<'today' | 'yesterday' | 'week' | 'custom'>('today')
  const [view, setView] = useState<'cs' | 'produk' | 'matriks'>('cs')
  const [csDim, setCsDim] = useState<DimRow[]>([])
  const [matrixDim, setMatrixDim] = useState<'produk' | 'platform'>('produk')
  const [matrixMetric, setMatrixMetric] = useState<'order' | 'deliv' | 'retur'>('order')
  const [loading, setLoading] = useState(true)
  const [csRows, setCsRows] = useState<CsRow[]>([])
  const [openCs, setOpenCs] = useState<string | null>(null)
  const [drill, setDrill] = useState<ProdRow[]>([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [prodAll, setProdAll] = useState<ProdRow[]>([])

  useEffect(() => { setFrom(isoToday()); setTo(isoToday()) }, [])

  const applyPreset = (p: typeof preset) => {
    setPreset(p); setOpenCs(null)
    if (p === 'today') { setFrom(isoToday()); setTo(isoToday()) }
    else if (p === 'yesterday') { setFrom(isoOffset(-1)); setTo(isoOffset(-1)) }
    else if (p === 'week') { setFrom(isoOffset(-6)); setTo(isoToday()) }
  }

  // aggregate cs_daily_leads per produk (semua CS atau 1 CS)
  const aggProduk = useCallback(async (csId: string | null): Promise<ProdRow[]> => {
    let q = supabase.from('cs_daily_leads')
      .select('product_id, leads_count, closing_count, product:products!cs_daily_leads_product_id_fkey(name)')
      .gte('report_date', from).lte('report_date', to)
    if (csId) q = q.eq('cs_id', csId)
    const { data } = await q
    const m = new Map<number, ProdRow>()
    for (const r of (data || []) as { product_id: number; leads_count: number; closing_count: number; product: { name: string } | { name: string }[] | null }[]) {
      const nm = Array.isArray(r.product) ? r.product[0]?.name : r.product?.name
      const cur = m.get(r.product_id) || { product_id: r.product_id, name: nm || `#${r.product_id}`, leads: 0, closing: 0 }
      cur.leads += num(r.leads_count); cur.closing += num(r.closing_count)
      m.set(r.product_id, cur)
    }
    return [...m.values()].sort((a, b) => b.closing - a.closing)
  }, [from, to])

  const load = useCallback(async () => {
    if (!from || !to || !canView) return
    setLoading(true); setOpenCs(null)
    try {
      const [{ data: cs }, prod, { data: dim }] = await Promise.all([
        supabase.rpc('team_cs_summary', { p_date_from: from, p_date_to: to }),
        aggProduk(null),
        supabase.rpc('analytics_cs_dimension', { p_from: from, p_to: to }),
      ])
      setCsRows(((cs || []) as CsRow[]).filter(r => num(r.leads_reported) > 0 || num(r.closing_reported) > 0)
        .sort((a, b) => num(b.closing_reported) - num(a.closing_reported)))
      setProdAll(prod)
      setCsDim((dim || []) as DimRow[])
    } catch (err) { console.warn('cs-ringkasan:', err) } finally { setLoading(false) }
  }, [from, to, canView, aggProduk])
  useEffect(() => { void load() }, [load])

  const openDrill = async (csId: string) => {
    if (openCs === csId) { setOpenCs(null); return }
    setOpenCs(csId); setDrillLoading(true)
    try { setDrill(await aggProduk(csId)) } finally { setDrillLoading(false) }
  }

  const totals = useMemo(() => {
    const lead = csRows.reduce((s, r) => s + num(r.leads_reported), 0)
    const close = csRows.reduce((s, r) => s + num(r.closing_reported), 0)
    return { lead, close, rate: lead > 0 ? (close * 100) / lead : 0 }
  }, [csRows])

  // Pivot CS×(produk/platform) buat view Matriks
  const csMatrix = useMemo(() => {
    const colSet = new Set<string>()
    const m = new Map<string, { name: string; cells: Record<string, MCell>; total: MCell }>()
    for (const r of csDim) {
      const ck = matrixDim === 'produk' ? r.product_name : r.platform
      colSet.add(ck)
      if (!m.has(r.cs_name)) m.set(r.cs_name, { name: r.cs_name, cells: {}, total: { o: 0, d: 0, r: 0 } })
      const row = m.get(r.cs_name)!
      const cell = row.cells[ck] || { o: 0, d: 0, r: 0 }
      cell.o += num(r.orders); cell.d += num(r.delivered); cell.r += num(r.retur)
      row.cells[ck] = cell
      row.total.o += num(r.orders); row.total.d += num(r.delivered); row.total.r += num(r.retur)
    }
    let cols = [...colSet]
    if (matrixDim === 'platform') {
      const ORD = ['META', 'GOOGLE', 'TIKTOK', 'SNACK']
      cols = [...ORD.filter(p => colSet.has(p)), ...cols.filter(p => !ORD.includes(p)).sort()]
    } else cols.sort()
    const rows = [...m.values()].sort((a, b) => b.total.o - a.total.o)
    return { cols, rows }
  }, [csDim, matrixDim])

  const rate = (l: number, c: number) => l > 0 ? (c * 100) / l : 0
  const rateBadge = (r: number) => <Badge variant="outline" className={`text-[11px] ${r >= 50 ? 'bg-emerald-500/10 text-emerald-600' : r >= 25 ? 'bg-amber-500/10 text-amber-600' : 'bg-zinc-500/10 text-zinc-500'}`}>{r.toFixed(1)}%</Badge>

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>
  if (!canView) return <Card className="max-w-md mx-auto mt-8"><CardContent className="pt-6 text-center text-sm text-muted-foreground">Ringkasan CS untuk owner, admin & CS.</CardContent></Card>

  const medal = ['🥇', '🥈', '🥉']

  return (
    <div className="space-y-4">
      <PageHeader icon={MessageCircle} title="Ringkasan CS"
        description="Lead, closing, close rate, dan retur per CS. Retur% merah = ≥20% (bahaya). Klik CS → breakdown per produk."
        actions={
          <div className="flex gap-2">
            <Link href="/performa"><Button variant="outline" size="sm" className="gap-1.5">Performa Detail →</Button></Link>
            <Link href="/cs-report"><Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"><Pencil className="w-3.5 h-3.5" /> Input Laporan</Button></Link>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
          </div>
        } />

      <Card><CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {([['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['week', '7 Hari']] as [typeof preset, string][]).map(([k, l]) => (
            <button key={k} onClick={() => applyPreset(k)} className={`px-3 h-8 text-sm rounded ${preset === k ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>{l}</button>
          ))}
        </div>
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset('custom') }} className="h-8 rounded-md border bg-background px-2 text-sm" />
        <span className="text-muted-foreground text-sm">s/d</span>
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset('custom') }} className="h-8 rounded-md border bg-background px-2 text-sm" />
        <div className="inline-flex rounded-md border p-0.5 ml-auto">
          <button onClick={() => setView('cs')} className={`px-3 h-8 text-sm rounded ${view === 'cs' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>Per CS</button>
          <button onClick={() => setView('produk')} className={`px-3 h-8 text-sm rounded ${view === 'produk' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>Per Produk</button>
          <button onClick={() => setView('matriks')} className={`px-3 h-8 text-sm rounded ${view === 'matriks' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>Matriks</button>
        </div>
      </CardContent></Card>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Lead</p><p className="text-2xl font-bold text-blue-600">{formatNumber(totals.lead)}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Closing</p><p className="text-2xl font-bold text-emerald-600">{formatNumber(totals.close)}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Close Rate</p><p className="text-2xl font-bold text-violet-600">{totals.rate.toFixed(1)}%</p></CardContent></Card>
      </div>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          : view === 'cs' ? (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8"></TableHead><TableHead>CS</TableHead>
                <TableHead className="text-right">Lead</TableHead><TableHead className="text-right">Closing</TableHead>
                <TableHead className="text-center">Close Rate</TableHead>
                <TableHead className="text-right" title="% retur dari order final (DITERIMA+RETUR). ≥20% = bahaya merah">Retur% ⚠</TableHead>
                <TableHead className="text-right">Jml Retur</TableHead>
                <TableHead>Produk Top</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {csRows.length === 0 ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Belum ada laporan CS di periode ini.</TableCell></TableRow>
                : csRows.map((r, i) => {
                  const rt = rate(num(r.leads_reported), num(r.closing_reported))
                  const open = openCs === r.user_id
                  return (
                    <Fragment key={r.user_id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => openDrill(r.user_id)}>
                        <TableCell>{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}</TableCell>
                        <TableCell className="font-medium text-sm">{medal[i] || ''} {r.full_name}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{formatNumber(num(r.leads_reported))}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-medium">{formatNumber(num(r.closing_reported))}</TableCell>
                        <TableCell className="text-center">{rateBadge(rt)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-semibold">
                          {(() => { const rr = num(r.retur_rate); return <span className={rr >= 20 ? 'text-rose-600' : rr >= 10 ? 'text-amber-600' : 'text-muted-foreground'}>{rr.toFixed(1)}%</span> })()}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{num(r.retur_count) || '—'}</TableCell>
                        <TableCell className="text-sm">{r.top_product_name || '—'}</TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="bg-muted/30">
                          <TableCell></TableCell>
                          <TableCell colSpan={7} className="py-2">
                            {drillLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : drill.length === 0 ? <span className="text-xs text-muted-foreground">Gak ada breakdown produk.</span> : (
                              <div className="space-y-1">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Breakdown per produk — {r.full_name}</div>
                                {drill.map(p => (
                                  <div key={p.product_id} className="flex items-center gap-3 text-xs">
                                    <span className="w-40 truncate font-medium">{p.name}</span>
                                    <span className="tabular-nums text-muted-foreground">{p.leads} lead</span>
                                    <span className="tabular-nums">{p.closing} closing</span>
                                    {rateBadge(rate(p.leads, p.closing))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          ) : view === 'produk' ? (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Produk</TableHead><TableHead className="text-right">Lead</TableHead>
                <TableHead className="text-right">Closing</TableHead><TableHead className="text-center">Close Rate</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {prodAll.length === 0 ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">Belum ada data.</TableCell></TableRow>
                : prodAll.map(p => (
                  <TableRow key={p.product_id}>
                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatNumber(p.leads)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums font-medium">{formatNumber(p.closing)}</TableCell>
                    <TableCell className="text-center">{rateBadge(rate(p.leads, p.closing))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border p-0.5 text-xs">
                  <button onClick={() => setMatrixDim('produk')} className={`px-2.5 h-7 rounded ${matrixDim === 'produk' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>CS × Produk</button>
                  <button onClick={() => setMatrixDim('platform')} className={`px-2.5 h-7 rounded ${matrixDim === 'platform' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>CS × Platform</button>
                </div>
                <div className="inline-flex rounded-md border p-0.5 text-xs">
                  {([['order', 'Order'], ['deliv', 'Terkirim%'], ['retur', 'Retur%']] as ['order' | 'deliv' | 'retur', string][]).map(([k, l]) => (
                    <button key={k} onClick={() => setMatrixMetric(k)} className={`px-2.5 h-7 rounded ${matrixMetric === k ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>{l}</button>
                  ))}
                </div>
              </div>
              {csMatrix.rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Belum ada data order ber-CS di periode ini.</p> : (
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse min-w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 sticky left-0 bg-card z-10">CS</th>
                        {csMatrix.cols.map(c => <th key={c} className="text-right p-2 whitespace-nowrap font-medium">{c === '(tanpa platform)' ? '(tanpa)' : c}</th>)}
                        <th className="text-right p-2 font-semibold border-l">TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csMatrix.rows.map(row => (
                        <tr key={row.name} className="border-b hover:bg-muted/30">
                          <td className="p-2 font-medium sticky left-0 bg-card z-10 whitespace-nowrap">{row.name}</td>
                          {csMatrix.cols.map(c => <td key={c} className="text-right p-2 tabular-nums">{csCell(row.cells[c], matrixMetric)}</td>)}
                          <td className="text-right p-2 tabular-nums font-semibold border-l">{csCell(row.total, matrixMetric)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Klik baris CS → breakdown per produk. <b>Matriks</b>: Terkirim% = terkirim÷order (makin tinggi makin <i>cocok</i> produk/platform itu buat CS); Retur% rendah = bagus. Close Rate = closing ÷ lead.</p>
    </div>
  )
}
