'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserCog, Loader2, Search, RefreshCw, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errors'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah, formatDate } from '@/lib/format'
import { OrderDetailSheet } from '@/components/orders/order-detail-sheet'

const supabase = createClient()

interface Row { id: number; order_number: string; customer_name: string; customer_city: string | null; total: number; order_date: string; meta: Record<string, unknown> | null }
interface Camp { id: number; campaign_name: string; platform: string }

/**
 * Brief #15 PART 3 — Distribusi Atribusi Manual: order yang campaign_id NULL
 * (tanpa-kode 1-2 Juni / token gak ke-resolve) → pilih → assign ke campaign.
 */
export default function DistribusiPage() {
  const { role } = useAuth()
  const canManage = role === 'owner' || role === 'admin' || role === 'advertiser'
  const [rows, setRows] = useState<Row[]>([])
  const [camps, setCamps] = useState<Camp[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [campaignId, setCampaignId] = useState<string>('')
  const [resolving, setResolving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [detail, setDetail] = useState<number | null>(null) // klik baris = detail

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: ord }, { data: cs }] = await Promise.all([
        supabase.from('orders_draft').select('id, order_number, customer_name, customer_city, total, order_date, meta')
          .is('campaign_id', null).order('order_date', { ascending: false }).limit(500),
        supabase.from('campaigns').select('id, campaign_name, platform').eq('active', true).order('campaign_name'),
      ])
      setRows((ord || []) as Row[])
      setCamps((cs || []) as Camp[])
      setSelected(new Set())
    } catch (err) { console.warn('distribusi load:', err) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return q ? rows.filter(r => r.order_number.toLowerCase().includes(q) || (r.customer_name || '').toLowerCase().includes(q)) : rows
  }, [rows, search])
  const allSel = filtered.length > 0 && filtered.every(r => selected.has(r.id))
  const counts = useMemo(() => {
    let token = 0, noCode = 0, rp = 0
    for (const r of filtered) {
      if (r.meta && r.meta.atribusi_account) token++; else noCode++
      rp += Number(r.total) || 0
    }
    return { token, noCode, rp }
  }, [filtered])

  const toggleAll = () => setSelected(prev => {
    const n = new Set(prev)
    if (allSel) filtered.forEach(r => n.delete(r.id)); else filtered.forEach(r => n.add(r.id))
    return n
  })
  const toggle = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const assign = async () => {
    if (!campaignId) return toast.error('Pilih campaign dulu')
    if (selected.size === 0) return toast.error('Pilih order dulu')
    setAssigning(true)
    try {
      const { data, error } = await supabase.rpc('assign_orders_campaign', { p_ids: Array.from(selected), p_campaign_id: Number(campaignId) })
      if (error) throw error
      toast.success(`${data ?? 0} order di-assign ke campaign`)
      await load()
    } catch (err) { toast.error('Gagal assign', { description: getErrorMessage(err) }) }
    finally { setAssigning(false) }
  }

  const resolveAuto = async () => {
    setResolving(true)
    try {
      const { data, error } = await supabase.rpc('resolve_order_attribution', { p_ids: null })
      if (error) throw error
      const d = (data || {}) as { resolved?: number }
      toast.success(`Auto-resolve: ${d.resolved ?? 0} order ke-resolve dari token`)
      await load()
    } catch (err) { toast.error('Gagal resolve', { description: getErrorMessage(err) }) }
    finally { setResolving(false) }
  }

  if (!canManage) {
    return <div className="space-y-6"><PageHeader icon={UserCog} title="Distribusi Atribusi" /><Card><CardContent className="p-6 text-sm text-muted-foreground">Hanya owner/admin/advertiser.</CardContent></Card></div>
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={UserCog} title="Distribusi Atribusi (Manual)"
        description="Order yang belum punya campaign (tanpa-kode / token gak ke-resolve). Pilih → assign ke campaign."
        actions={
          <Button variant="outline" size="sm" onClick={resolveAuto} disabled={resolving} className="gap-1.5">
            {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Auto-resolve token
          </Button>
        } />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari order# / customer..." className="pl-9" />
          </div>
          <Select value={campaignId || 'none'} onValueChange={v => setCampaignId(!v || v === 'none' ? '' : v)}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Pilih campaign tujuan">{(v: string | null) => { if (!v || v === 'none') return 'Pilih campaign tujuan'; const c = camps.find(x => String(x.id) === v); return c ? `${c.campaign_name} (${c.platform})` : v }}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— pilih campaign —</SelectItem>
              {camps.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.campaign_name} ({c.platform})</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={assign} disabled={assigning || selected.size === 0 || !campaignId} className="gap-1.5 bg-zinc-600 hover:bg-zinc-700 text-white">
            {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Assign ({selected.size})
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
        </CardContent>
      </Card>

      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="font-medium">Total: {filtered.length.toLocaleString('id-ID')} order</Badge>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600">token gak resolve: {counts.token}</Badge>
          <Badge variant="outline" className="bg-zinc-500/10 text-zinc-500">no-code: {counts.noCode}</Badge>
          <Badge variant="outline">Total nilai: {formatRupiah(counts.rp)}</Badge>
          {selected.size > 0 && <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600">dipilih: {selected.size}</Badge>}
        </div>
      )}

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10"><Checkbox checked={allSel} onCheckedChange={toggleAll} /></TableHead>
              <TableHead>Tanggal</TableHead><TableHead>Order#</TableHead><TableHead>Customer</TableHead>
              <TableHead>Kota</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Token?</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Semua order udah punya campaign 🎉</TableCell></TableRow>
              ) : filtered.map(r => {
                const hasToken = !!(r.meta && r.meta.atribusi_account)
                return (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetail(r.id)}>
                    <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDate(r.order_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.order_number}</TableCell>
                    <TableCell className="text-xs">{r.customer_name}</TableCell>
                    <TableCell className="text-xs">{r.customer_city || '—'}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatRupiah(Number(r.total))}</TableCell>
                    <TableCell>{hasToken
                      ? <Badge variant="outline" className="bg-amber-500/10 text-amber-600 text-[10px]" title={String(r.meta?.product_code_full ?? '')}>token (gak ke-resolve)</Badge>
                      : <span className="text-[10px] text-muted-foreground">no-code</span>}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
      <OrderDetailSheet source={detail !== null ? 'draft' : null} id={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
